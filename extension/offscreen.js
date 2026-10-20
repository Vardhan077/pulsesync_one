let mediaRecorder = null;
let tabStream = null;
let micStream = null;
let audioContext = null;
let analyser = null;
let levelTimer = null;
let pendingChunkWrites = Promise.resolve();
let chunkWriteError = null;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target && message.target !== 'offscreen') return false;

  if (message.type === 'PULSESYNC_OFFSCREEN_START') {
    start(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        report('error', error.message);
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  if (message.type === 'PULSESYNC_OFFSCREEN_STOP') {
    stop()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

async function start(config) {
  await stop();
  report('capturing', null);

  try {
    // 1. Capture browser tab audio
    tabStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: config.streamId,
        },
      },
      video: false,
    });

    // 2. Try capturing local microphone audio
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    } catch (micError) {
      console.warn('[PulseSync] Microphone capture failed or denied:', micError);
    }

    // 3. Set up AudioContext for mixing
    audioContext = new AudioContext({ sampleRate: 16000 }); // Whisper standard is 16kHz
    const destination = audioContext.createMediaStreamDestination();

    const tabSource = audioContext.createMediaStreamSource(tabStream);
    tabSource.connect(destination);
    tabSource.connect(audioContext.destination); // Playback to user's speakers/headphones

    let micSource = null;
    if (micStream) {
      micSource = audioContext.createMediaStreamSource(micStream);
      micSource.connect(destination);
    }

    // 4. Connect Analyser Node for level rendering
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    tabSource.connect(analyser);
    if (micSource) {
      micSource.connect(analyser);
    }
    startAudioLevelReporting();

    // 5. Initialize MediaRecorder on mixed stream
    let mimeType = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'audio/webm';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = ''; // Let the browser fall back
      }
    }

    const recorderOptions = mimeType ? { mimeType } : undefined;
    mediaRecorder = new MediaRecorder(destination.stream, recorderOptions);
    pendingChunkWrites = Promise.resolve();
    chunkWriteError = null;

    mediaRecorder.ondataavailable = (event) => {
      if (!event.data || event.data.size <= 0) return;
      const chunkBlob = event.data;
      // Append synchronously to a serialized write chain so stop() can await every chunk,
      // including the final dataavailable event fired by MediaRecorder.stop().
      pendingChunkWrites = pendingChunkWrites.then(async () => {
        const arrayBuffer = await chunkBlob.arrayBuffer();
        const base64String = arrayBufferToBase64(arrayBuffer);
        const acknowledgement = await chrome.runtime.sendMessage({
          type: 'PULSESYNC_AUDIO_CHUNK',
          payload: { chunk: base64String, timestamp: Date.now() },
        });
        if (!acknowledgement?.ok) throw new Error(acknowledgement?.error || 'Audio chunk persistence was not acknowledged.');
      }).catch((error) => {
        chunkWriteError = chunkWriteError || error;
        console.error('[PulseSync] Audio chunk persistence failed:', error);
      });
    };

    // Slice recorder chunks every 3 seconds for solid buffering
    mediaRecorder.start(3000);
    report('recording', null);

  } catch (error) {
    console.error('[PulseSync] Local recording failed to start:', error);
    await stop();
    throw error;
  }
}

async function stop() {
  clearInterval(levelTimer);
  levelTimer = null;

  const recorder = mediaRecorder;
  let stopError = null;
  if (recorder && recorder.state !== 'inactive') {
    try {
      await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => reject(new Error('Timed out waiting for MediaRecorder to finalize the last audio chunk.')), 15000);
        recorder.addEventListener('stop', () => { clearTimeout(timeoutId); resolve(); }, { once: true });
        recorder.addEventListener('error', (event) => { clearTimeout(timeoutId); reject(event.error || new Error('MediaRecorder failed while stopping.')); }, { once: true });
        try { recorder.stop(); } catch (error) { clearTimeout(timeoutId); reject(error); }
      });
    } catch (error) { stopError = error; }
  }
  try { await pendingChunkWrites; } catch (error) { stopError = stopError || error; }
  if (chunkWriteError) stopError = stopError || chunkWriteError;
  mediaRecorder = null;

  if (tabStream) {
    tabStream.getTracks().forEach((track) => track.stop());
    tabStream = null;
  }

  if (micStream) {
    micStream.getTracks().forEach((track) => track.stop());
    micStream = null;
  }

  if (analyser) {
    analyser.disconnect();
    analyser = null;
  }

  if (audioContext) {
    await audioContext.close().catch(() => {});
    audioContext = null;
  }

  report(stopError ? 'error' : 'idle', stopError ? (stopError.message || 'Audio recording could not be finalized safely.') : null);
  if (stopError) throw stopError;
}

function report(status, error) {
  chrome.runtime.sendMessage({
    type: 'PULSESYNC_STATUS',
    payload: { status, error, startedAt: status === 'idle' ? null : undefined },
  });
}

function startAudioLevelReporting() {
  const bins = new Uint8Array(analyser.frequencyBinCount);
  levelTimer = setInterval(() => {
    if (!analyser) return;
    analyser.getByteFrequencyData(bins);
    const level = bins.reduce((sum, value) => sum + value, 0) / bins.length / 255;
    chrome.runtime.sendMessage({
      type: 'PULSESYNC_STATUS',
      payload: { audioLevel: Number((level * 2).toFixed(3)) }, // Scaled slightly for visual popup response
    });
  }, 300);
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
