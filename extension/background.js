const OFFSCREEN_URL = 'offscreen.html';
const DEFAULT_ROOM = 'pulsesync-meeting';

let state = {
  status: 'idle',
  room: DEFAULT_ROOM,
  error: null,
  startedAt: null,
  audioLevel: 0,
  tokenServerUrl: 'http://localhost:3001',
  apiToken: '',
  consentConfirmed: false,
};

const DB_NAME = 'PulseSyncDB';
const STORE_NAME = 'audio_chunks';

// Database helpers for Service Worker chunk caching
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { autoIncrement: true });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function clearChunks() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { const error = tx.error || new Error('Failed to clear stored audio chunks.'); db.close(); reject(error); };
    tx.onabort = () => { const error = tx.error || new Error('Audio chunk cleanup was aborted.'); db.close(); reject(error); };
  });
}

async function saveChunk(chunk) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add(chunk);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { const error = tx.error || new Error('Failed to store audio chunk.'); db.close(); reject(error); };
    tx.onabort = () => { const error = tx.error || new Error('Audio chunk storage was aborted.'); db.close(); reject(error); };
  });
}

async function getAllChunks() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    let chunks = [];
    request.onsuccess = () => { chunks = request.result || []; };
    request.onerror = () => { const error = request.error || new Error('Failed to read audio chunks.'); db.close(); reject(error); };
    tx.oncomplete = () => { db.close(); resolve(chunks); };
    tx.onerror = () => { const error = tx.error || new Error('Failed to read audio chunks.'); db.close(); reject(error); };
    tx.onabort = () => { const error = tx.error || new Error('Audio chunk read was aborted.'); db.close(); reject(error); };
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  if (message.type === 'PULSESYNC_START') {
    startCapture(message.payload || {})
      .then((nextState) => sendResponse({ ok: true, state: nextState }))
      .catch((error) => {
        updateState({ status: 'error', error: error.message });
        sendResponse({ ok: false, error: error.message, state });
      });
    return true;
  }

  if (message.type === 'PULSESYNC_STOP') {
    stopCapture()
      .then((nextState) => sendResponse({ ok: true, state: nextState }))
      .catch((error) => {
        updateState({ status: 'error', error: error.message });
        sendResponse({ ok: false, error: error.message, state });
      });
    return true;
  }

  if (message.type === 'PULSESYNC_GET_STATE') {
    sendResponse({ ok: true, state });
    return false;
  }

  if (message.type === 'PULSESYNC_STATUS') {
    updateState(message.payload || {});
    sendResponse({ ok: true, state });
    return false;
  }

  if (message.type === 'PULSESYNC_AUDIO_CHUNK') {
    if (typeof message.payload?.chunk !== 'string' || !message.payload.chunk) {
      sendResponse({ ok: false, error: 'Audio chunk payload is empty or invalid.' });
      return false;
    }
    saveChunk(message.payload.chunk)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error('[PulseSync] Failed to store audio chunk locally:', err);
        sendResponse({ ok: false, error: 'Failed to persist an audio chunk. Stop and retry the recording.' });
      });
    return true;
  }

  return false;
});

async function startCapture(options) {
  if (options.consentConfirmed !== true) throw new Error('Explicit participant consent confirmation is required before recording.');
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) throw new Error('No active tab available for capture.');

  await ensureOffscreenDocument();
  await clearChunks(); // Purge old stale records

  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: activeTab.id });
  const room = normalizeRoom(options.room || DEFAULT_ROOM);
  
  updateState({
    status: 'capturing',
    room,
    error: null,
    startedAt: Date.now(),
    tokenServerUrl: options.tokenServerUrl || 'http://localhost:3001',
    apiToken: options.apiToken || '',
    consentConfirmed: options.consentConfirmed === true,
  });

  await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'PULSESYNC_OFFSCREEN_START',
    payload: {
      streamId,
      room,
      tokenServerUrl: state.tokenServerUrl,
    },
  });

  return state;
}

async function stopCapture() {
  if (state.status === 'idle') return state;

  updateState({ status: 'compiling' });

  // 1. Stop the recorder and wait for its final dataavailable event + IndexedDB commit.
  try {
    const stopAck = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'PULSESYNC_OFFSCREEN_STOP' });
    if (stopAck?.ok === false) throw new Error(stopAck.error || 'Could not finalize the recording safely.');
  } catch (stopError) {
    updateState({ status: 'error', error: stopError.message || 'Could not finalize the recording safely.' });
    await closeOffscreenDocument();
    throw stopError;
  }

  try {
    // 2. Fetch all local chunks from IndexedDB
    const base64Chunks = await getAllChunks();
    if (base64Chunks.length === 0) {
      throw new Error('No audio chunks were captured. Please ensure audio is playing in the tab.');
    }

    // 3. Rebuild binary recording Blob
    const uint8Arrays = base64Chunks.map(base64ToUint8Array);
    const audioBlob = new Blob(uint8Arrays, { type: 'audio/webm' });

    updateState({ status: 'uploading' });

    // 4. Assemble multipart form upload
    const formData = new FormData();
    formData.append('audio', audioBlob, `meeting_${Date.now()}.webm`);
    formData.append('title', state.room || 'PulseSync Meeting');
    formData.append('capture_source', 'extension');
    formData.append('consent_status', state.consentConfirmed ? 'granted' : 'unknown');

    // 5. Send to ingestion API
    const response = await fetch(`${trimSlash(state.tokenServerUrl)}/api/meetings/upload`, {
      method: 'POST',
      headers: state.apiToken ? { Authorization: `Bearer ${state.apiToken}` } : {},
      body: formData,
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(errBody.message || `Ingestion API returned status ${response.status}`);
    }

    const result = await response.json();
    console.log('[PulseSync] Meeting upload complete, job registered:', result);

    updateState({ status: 'success', startedAt: null, audioLevel: 0 });
    await clearChunks(); // Success - clear buffers

    // Back to idle after showing success status briefly
    setTimeout(() => {
      if (state.status === 'success') {
        updateState({ status: 'idle', error: null });
      }
    }, 4000);

  } catch (error) {
    console.error('[PulseSync] Compilation or Ingestion upload failed:', error);
    updateState({ status: 'error', error: error.message });
    throw error;
  } finally {
    await closeOffscreenDocument();
  }

  return state;
}

async function ensureOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });

  if (contexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA'],
    justification: 'PulseSync AI mixes browser tab audio + local mic and records locally in the background.',
  });
}

async function closeOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });

  if (contexts.length > 0) {
    await chrome.offscreen.closeDocument();
  }
}

function updateState(patch) {
  state = { ...state, ...patch };
  chrome.runtime.sendMessage({ type: 'PULSESYNC_STATE_CHANGED', payload: state }).catch(() => {});
}

function normalizeRoom(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || DEFAULT_ROOM;
}

function trimSlash(value) {
  return String(value || '').replace(/\/$/, '');
}

function base64ToUint8Array(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
