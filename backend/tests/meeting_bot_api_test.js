/**
 * meeting_bot_api_test.js
 * Spawns the PulseSync backend server on a test port (3099) and runs full HTTP end-to-end tests:
 * - GET /api/meeting-providers
 * - POST /api/meeting-providers/detect-url
 * - POST /api/meeting-bots (scheduling a bot)
 * - GET /api/meeting-bots (listing bot jobs)
 * - GET /api/meeting-bots/:id/status (checking progress)
 * - GET /api/meeting-bots/:id/logs (verifying activity logs)
 * - POST /api/meeting-bots/:id/cancel (cancellation)
 * - POST /api/meeting-bots/:id/retry (retrying)
 * - Legacy endpoints (/api/capture/bots, /api/capture/bots/schedule)
 * - Audio validation (POST /api/meetings/upload with invalid file rejection)
 */

import { spawn } from 'node:child_process';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_PORT = 3099;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const TEST_API_TOKEN = 'pulsesync-test-api-token-0123456789-ABCD';

async function apiFetch(url, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${TEST_API_TOKEN}`);
  return fetch(url, { ...init, headers });
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer() {
  const maxRetries = 30;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return true;
    } catch {
      await sleep(300);
    }
  }
  throw new Error('Server did not start within timeout');
}

async function run() {
  console.log('\n======================================================');
  console.log('   PulseSync Meeting Bot REST API E2E Verification    ');
  console.log('======================================================\n');

  const serverEnv = {
    ...process.env,
    PORT: String(TEST_PORT),
    MEETING_BOT_MODE: 'mock',
    LOG_LEVEL: 'silent',
    NODE_ENV: 'test',
    ALLOW_JSON_FALLBACK: 'true',
    PULSESYNC_API_TOKEN: TEST_API_TOKEN,
    DATABASE_URL: 'postgresql://pulsesync_test:pulsesync_test@127.0.0.1:65431/pulsesync_test',
    FALLBACK_DB_PATH: path.join(__dirname, '.tmp-meeting-bot-api-db.json'),
  };

  const serverProcess = spawn('node', ['backend/server.js'], {
    cwd: path.resolve(__dirname, '../..'),
    env: serverEnv,
    stdio: 'pipe',
  });

  serverProcess.stderr.on('data', data => {
    // console.error('[Server Error]:', data.toString());
  });

  try {
    await waitForServer();
    console.log(`✓ Server active on port ${TEST_PORT}\n`);

    // API endpoints are protected even when local JSON demo mode is explicitly enabled.
    const unauthenticatedRes = await fetch(`${BASE_URL}/api/meeting-providers`);
    assert.strictEqual(unauthenticatedRes.status, 401);

    // 1. Test Provider List & Capabilities
    process.stdout.write('• Testing GET /api/meeting-providers... ');
    const provRes = await apiFetch(`${BASE_URL}/api/meeting-providers`);
    assert.strictEqual(provRes.status, 200);
    const provData = await provRes.json();
    assert.strictEqual(provData.length, 3);
    const providers = provData.map(p => p.provider);
    assert.ok(providers.includes('google_meet'));
    assert.ok(providers.includes('zoom'));
    assert.ok(providers.includes('microsoft_teams'));
    console.log('\x1b[32mPASSED\x1b[0m');

    // 2. Test URL Auto-Detection Endpoint
    process.stdout.write('• Testing POST /api/meeting-providers/detect-url... ');
    const detectRes = await apiFetch(`${BASE_URL}/api/meeting-providers/detect-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://meet.google.com/xyz-abcd-efg' }),
    });
    assert.strictEqual(detectRes.status, 200);
    const detectData = await detectRes.json();
    assert.strictEqual(detectData.valid, true);
    assert.strictEqual(detectData.provider, 'google_meet');

    const zoomDetect = await apiFetch(`${BASE_URL}/api/meeting-providers/detect-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://zoom.us/j/987654321?pwd=test' }),
    });
    const zoomData = await zoomDetect.json();
    assert.strictEqual(zoomData.valid, true);
    assert.strictEqual(zoomData.provider, 'zoom');

    const teamsDetect = await apiFetch(`${BASE_URL}/api/meeting-providers/detect-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://teams.microsoft.com/l/meetup-join/abc/0' }),
    });
    const teamsData = await teamsDetect.json();
    assert.strictEqual(teamsData.valid, true);
    assert.strictEqual(teamsData.provider, 'microsoft_teams');
    console.log('\x1b[32mPASSED\x1b[0m');

    // 3. Test Bot Job Scheduling
    process.stdout.write('• Testing POST /api/meeting-bots (schedule Google Meet bot)... ');
    const createRes = await apiFetch(`${BASE_URL}/api/meeting-bots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'google_meet',
        meeting_url: 'https://meet.google.com/abc-defg-hij',
        meeting_title: 'API Test Discovery Call',
        consent_state: 'granted',
        mode: 'mock',
        bot_participant_name: 'PulseSync Test Bot',
      }),
    });
    assert.strictEqual(createRes.status, 201);
    const createData = await createRes.json();
    assert.strictEqual(createData.ok, true);
    assert.ok(createData.job?.id);
    const createdJobId = createData.job.id;
    console.log('\x1b[32mPASSED\x1b[0m');

    // 3b. Test Scheduling Zoom Bot
    process.stdout.write('• Testing POST /api/meeting-bots (schedule Zoom bot)... ');
    const zoomCreateRes = await apiFetch(`${BASE_URL}/api/meeting-bots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'zoom',
        meeting_url: 'https://us04web.zoom.us/j/79397280510?pwd=uHBb9xvsxGxfCtOzUm38oYQTuXguVk.1',
        meeting_title: 'Zoom Architecture Sync',
        consent_state: 'granted',
        mode: 'realtime',
        bot_participant_name: 'PulseSync Zoom Bot',
      }),
    });
    assert.strictEqual(zoomCreateRes.status, 201);
    const zoomCreateData = await zoomCreateRes.json();
    assert.strictEqual(zoomCreateData.ok, true);
    assert.ok(zoomCreateData.job?.id);
    assert.strictEqual(zoomCreateData.job.provider, 'zoom');
    console.log('\x1b[32mPASSED\x1b[0m');

    // 4. Test Bot Job Listing & Detail
    process.stdout.write('• Testing GET /api/meeting-bots & GET /api/meeting-bots/:id... ');
    const listRes = await apiFetch(`${BASE_URL}/api/meeting-bots`);
    assert.strictEqual(listRes.status, 200);
    const listData = await listRes.json();
    assert.ok(listData.some(j => j.id === createdJobId));

    const getRes = await apiFetch(`${BASE_URL}/api/meeting-bots/${createdJobId}`);
    assert.strictEqual(getRes.status, 200);
    const getData = await getRes.json();
    assert.strictEqual(getData.id, createdJobId);
    assert.strictEqual(getData.provider, 'google_meet');
    console.log('\x1b[32mPASSED\x1b[0m');

    // 5. Test Live Lifecycle Progression & Logs
    process.stdout.write('• Testing bot lifecycle progression & GET /api/meeting-bots/:id/logs... ');
    // Wait for mock worker to progress through states
    await sleep(4000);

    const statusRes = await apiFetch(`${BASE_URL}/api/meeting-bots/${createdJobId}/status`);
    assert.strictEqual(statusRes.status, 200);
    const statusData = await statusRes.json();
    assert.ok(statusData.status);

    const logsRes = await apiFetch(`${BASE_URL}/api/meeting-bots/${createdJobId}/logs`);
    assert.strictEqual(logsRes.status, 200);
    const logsData = await logsRes.json();
    assert.ok(logsData.length > 0);
    console.log(`\x1b[32mPASSED\x1b[0m (${logsData.length} logs captured)`);

    // 6. Test Bot Cancellation & Retry
    process.stdout.write('• Testing POST /api/meeting-bots/:id/cancel & retry... ');
    const futureJobRes = await apiFetch(`${BASE_URL}/api/meeting-bots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'zoom',
        meeting_url: 'https://zoom.us/j/1234567890',
        meeting_title: 'Future Scheduled Zoom Call',
        scheduled_start: new Date(Date.now() + 3600000).toISOString(),
        consent_state: 'granted',
      }),
    });
    const futureJobData = await futureJobRes.json();
    const futureJobId = futureJobData.job.id;

    const cancelRes = await apiFetch(`${BASE_URL}/api/meeting-bots/${futureJobId}/cancel`, { method: 'POST' });
    assert.strictEqual(cancelRes.status, 200);

    const retryRes = await apiFetch(`${BASE_URL}/api/meeting-bots/${futureJobId}/retry`, { method: 'POST' });
    assert.strictEqual(retryRes.status, 200);
    const retryData = await retryRes.json();
    assert.strictEqual(retryData.status, 'SCHEDULED');
    console.log('\x1b[32mPASSED\x1b[0m');

    // 7. Test Legacy Endpoints Backwards-Compatibility
    process.stdout.write('• Testing legacy GET & POST /api/capture/bots... ');
    const legacyList = await apiFetch(`${BASE_URL}/api/capture/bots`);
    assert.strictEqual(legacyList.status, 200);
    const legacyJobs = await legacyList.json();
    assert.ok(Array.isArray(legacyJobs));

    const legacySchedule = await apiFetch(`${BASE_URL}/api/capture/bots/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'google_meet',
        meeting_url: 'https://meet.google.com/xyz-test-url',
        title: 'Legacy Call',
        consent_status: 'granted',
      }),
    });
    assert.strictEqual(legacySchedule.status, 201);
    console.log('\x1b[32mPASSED\x1b[0m');

    // 8. Test Audio Validation Rejection
    process.stdout.write('• Testing audio validation rejection on empty audio... ');
    const emptyFormData = new FormData();
    const emptyBlob = new Blob([], { type: 'audio/webm' });
    emptyFormData.append('audio', emptyBlob, 'empty.webm');
    emptyFormData.append('title', 'Empty Audio Test');

    const uploadRes = await apiFetch(`${BASE_URL}/api/meetings/upload`, {
      method: 'POST',
      body: emptyFormData,
    });
    // Should reject with 400 Bad Request and error code
    assert.strictEqual(uploadRes.status, 400);
    const uploadErr = await uploadRes.json();
    assert.strictEqual(uploadErr.error, 'EMPTY_AUDIO');
    console.log('\x1b[32mPASSED\x1b[0m');

    console.log('\n------------------------------------------------------');
    console.log('   All 8 API & End-to-End Verification Tests PASSED!  ');
    console.log('------------------------------------------------------\n');
  } finally {
    serverProcess.kill();
    try { fs.rmSync(serverEnv.FALLBACK_DB_PATH, { force: true }); } catch { /* test cleanup best-effort */ }
  }
}

run().catch(err => {
  console.error('API Test runner crashed:', err);
  process.exit(1);
});
