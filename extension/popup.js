const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const dashboardBtn = document.getElementById('dashboardBtn');
const statusText = document.getElementById('statusText');
const roomText = document.getElementById('roomText');
const errorText = document.getElementById('errorText');
const pulse = document.getElementById('pulse');
const audioMeter = document.getElementById('audioMeter');
const tokenServerUrl = document.getElementById('tokenServerUrl');
const roomName = document.getElementById('roomName');
const apiToken = document.getElementById('apiToken');
const consentConfirmed = document.getElementById('consentConfirmed');
const timerDisplay = document.getElementById('timerDisplay');

let timerInterval = null;
let currentStartedAt = null;

init();

startBtn.addEventListener('click', async () => {
  setLoading(true);
  errorText.textContent = '';
  
  if (!consentConfirmed.checked) { errorText.textContent = 'Confirm participant recording consent before starting capture.'; setLoading(false); return; }
  await chrome.storage.local.set({
    tokenServerUrl: tokenServerUrl.value.trim(),
    roomName: roomName.value.trim(),
    apiToken: apiToken.value.trim(),
  });

  const response = await chrome.runtime.sendMessage({
    type: 'PULSESYNC_START',
    payload: {
      tokenServerUrl: tokenServerUrl.value.trim(),
      room: roomName.value.trim(),
      apiToken: apiToken.value.trim(),
      consentConfirmed: consentConfirmed.checked,
    },
  });

  setLoading(false);
  handleResponse(response);
});

stopBtn.addEventListener('click', async () => {
  setLoading(true);
  const response = await chrome.runtime.sendMessage({ type: 'PULSESYNC_STOP' });
  setLoading(false);
  handleResponse(response);
});

dashboardBtn.addEventListener('click', async () => {
  await chrome.storage.local.set({
    tokenServerUrl: tokenServerUrl.value.trim(),
    roomName: roomName.value.trim(),
    apiToken: apiToken.value.trim(),
  });
  // Open the post-call React analytics dashboard
  await chrome.tabs.create({
    url: 'http://localhost:5173',
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'PULSESYNC_STATE_CHANGED') {
    renderState(message.payload);
  }
});

async function init() {
  const stored = await chrome.storage.local.get(['tokenServerUrl', 'roomName', 'apiToken']);
  tokenServerUrl.value = stored.tokenServerUrl || 'http://localhost:3001';
  roomName.value = stored.roomName || 'Daily Sync';
  apiToken.value = stored.apiToken || '';
  consentConfirmed.checked = false;
  
  const response = await chrome.runtime.sendMessage({ type: 'PULSESYNC_GET_STATE' });
  if (response?.state) {
    renderState(response.state);
  }
}

function handleResponse(response) {
  if (!response?.ok) {
    errorText.textContent = response?.error || 'PulseSync could not complete the request.';
  }
  if (response?.state) {
    renderState(response.state);
  }
}

function renderState(state) {
  const status = state.status || 'idle';
  statusText.textContent = label(status);
  roomText.textContent = state.room || roomName.value || 'Unlabeled Session';
  pulse.className = `pulse ${status}`;
  
  // Disable start button when capturing, recording, compiling, or uploading
  startBtn.disabled = ['capturing', 'recording', 'compiling', 'uploading'].includes(status);
  stopBtn.disabled = !['capturing', 'recording'].includes(status);
  
  errorText.textContent = state.error || '';
  audioMeter.value = Number(state.audioLevel || 0);

  // Timer logic
  if (['capturing', 'recording'].includes(status) && state.startedAt) {
    currentStartedAt = state.startedAt;
    startTimer();
  } else {
    stopTimer();
    if (status === 'idle') {
      timerDisplay.textContent = '00:00';
    } else if (status === 'compiling') {
      timerDisplay.textContent = 'BUILD';
    } else if (status === 'uploading') {
      timerDisplay.textContent = 'UPLD';
    } else if (status === 'success') {
      timerDisplay.textContent = 'DONE';
    }
  }
}

function startTimer() {
  if (timerInterval) return;
  
  const updateTimer = () => {
    if (!currentStartedAt) return;
    const elapsedMs = Date.now() - currentStartedAt;
    const totalSeconds = Math.floor(elapsedMs / 1000);
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    timerDisplay.textContent = `${minutes}:${seconds}`;
  };

  updateTimer();
  timerInterval = setInterval(updateTimer, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  currentStartedAt = null;
}

function setLoading(loading) {
  if (loading) {
    startBtn.classList.add('loading');
    stopBtn.classList.add('loading');
  } else {
    startBtn.classList.remove('loading');
    stopBtn.classList.remove('loading');
  }
}

function label(status) {
  const labels = {
    idle: 'Ready to Record',
    capturing: 'Initializing Audio...',
    recording: 'Recording Live...',
    compiling: 'Compiling Audio...',
    uploading: 'Uploading Ingestion Pipeline...',
    success: 'Successfully Uploaded!',
    error: 'Execution Failed',
  };
  return labels[status] || status;
}
