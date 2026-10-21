/**
 * upload_and_search_api_test.js
 * End-to-end HTTP verification of:
 * 1. Automatic duplicate audio filename handling during upload via POST /api/meetings/upload
 * 2. GET /api/meetings advanced query filtering (search, playbook, stage, confidence, dates)
 */

import { spawn } from 'node:child_process';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_PORT = 3198;
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

// Generate valid WAV audio buffer for test uploads
function createValidWavBuffer(durationSeconds = 1) {
  const sampleRate = 8000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = sampleRate * durationSeconds * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt subchunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data subchunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
}

async function run() {
  console.log('\n======================================================');
  console.log('   PulseSync Safe Upload & Search API Verification     ');
  console.log('======================================================\n');

  const testDbPath = path.join(__dirname, '.tmp-upload-search-test-db.json');
  const testUploadsDir = path.join(__dirname, '.tmp-upload-search-uploads');
  fs.mkdirSync(testUploadsDir, { recursive: true });

  const serverEnv = {
    ...process.env,
    PORT: String(TEST_PORT),
    MEETING_BOT_MODE: 'mock',
    LOG_LEVEL: 'silent',
    NODE_ENV: 'test',
    ALLOW_JSON_FALLBACK: 'true',
    PULSESYNC_API_TOKEN: TEST_API_TOKEN,
    DATABASE_URL: 'postgresql://pulsesync_test:pulsesync_test@127.0.0.1:65431/pulsesync_test',
    FALLBACK_DB_PATH: testDbPath,
    UPLOADS_DIR: testUploadsDir,
  };

  const serverProcess = spawn('node', ['backend/server.js'], {
    cwd: path.resolve(__dirname, '../..'),
    env: serverEnv,
    stdio: 'pipe',
  });

  try {
    await waitForServer();
    console.log(`✓ Test server active on port ${TEST_PORT}\n`);

    const wavBuffer = createValidWavBuffer(1);

    const testBase = `North_Daniel_test_${Date.now()}`;
    const dotsBase = `North.Daniel.call_${Date.now()}`;

    // ── TEST 1: First upload ──
    process.stdout.write(`• Testing first upload of "${testBase}.wav"... `);
    const form1 = new FormData();
    form1.append('audio', new Blob([wavBuffer], { type: 'audio/wav' }), `${testBase}.wav`);
    form1.append('consent_status', 'granted');

    const res1 = await apiFetch(`${BASE_URL}/api/meetings/upload`, {
      method: 'POST',
      body: form1,
    });
    assert.strictEqual(res1.status, 200);
    const data1 = await res1.json();
    assert.strictEqual(data1.ok, true);
    assert.strictEqual(data1.filename, `${testBase}.wav`);
    assert.strictEqual(data1.original_filename, `${testBase}.wav`);
    assert.ok(data1.meetingId);
    console.log(`\x1b[32mPASSED\x1b[0m (saved as ${testBase}.wav)`);

    // ── TEST 2: Second upload of identical filename (conflict resolution) ──
    process.stdout.write(`• Testing second duplicate upload of "${testBase}.wav"... `);
    const form2 = new FormData();
    form2.append('audio', new Blob([wavBuffer], { type: 'audio/wav' }), `${testBase}.wav`);
    form2.append('title', testBase); // Client sends default derived title
    form2.append('consent_status', 'granted');

    const res2 = await apiFetch(`${BASE_URL}/api/meetings/upload`, {
      method: 'POST',
      body: form2,
    });
    assert.strictEqual(res2.status, 200);
    const data2 = await res2.json();
    assert.strictEqual(data2.ok, true);
    assert.strictEqual(data2.filename, `${testBase}(1).wav`);
    assert.strictEqual(data2.original_filename, `${testBase}.wav`);
    assert.notStrictEqual(data1.meetingId, data2.meetingId, 'Meeting IDs must be distinct UUIDs');

    // Verify title in DB reflects the unique numbered name
    const m2Res = await apiFetch(`${BASE_URL}/api/meetings/${data2.meetingId}`);
    assert.strictEqual(m2Res.status, 200);
    const m2Data = await m2Res.json();
    assert.strictEqual(m2Data.meeting?.title, `${testBase}(1)`, 'Meeting title should reflect unique candidate without duplicate confusion');
    console.log(`\x1b[32mPASSED\x1b[0m (saved as ${testBase}(1).wav)`);

    // ── TEST 3: Third upload of identical filename ──
    process.stdout.write(`• Testing third duplicate upload of "${testBase}.wav"... `);
    const form3 = new FormData();
    form3.append('audio', new Blob([wavBuffer], { type: 'audio/wav' }), `${testBase}.wav`);
    form3.append('consent_status', 'granted');

    const res3 = await apiFetch(`${BASE_URL}/api/meetings/upload`, {
      method: 'POST',
      body: form3,
    });
    assert.strictEqual(res3.status, 200);
    const data3 = await res3.json();
    assert.strictEqual(data3.filename, `${testBase}(2).wav`);
    console.log(`\x1b[32mPASSED\x1b[0m (saved as ${testBase}(2).wav)`);

    // ── TEST 4: Multiple dots in filename: North.Daniel.call.wav ──
    process.stdout.write(`• Testing upload with multiple dots "${dotsBase}.wav"... `);
    const formDots1 = new FormData();
    formDots1.append('audio', new Blob([wavBuffer], { type: 'audio/wav' }), `${dotsBase}.wav`);
    formDots1.append('consent_status', 'granted');

    const resDots1 = await apiFetch(`${BASE_URL}/api/meetings/upload`, {
      method: 'POST',
      body: formDots1,
    });
    assert.strictEqual((await resDots1.json()).filename, `${dotsBase}.wav`);

    const formDots2 = new FormData();
    formDots2.append('audio', new Blob([wavBuffer], { type: 'audio/wav' }), `${dotsBase}.wav`);
    formDots2.append('consent_status', 'granted');

    const resDots2 = await apiFetch(`${BASE_URL}/api/meetings/upload`, {
      method: 'POST',
      body: formDots2,
    });
    assert.strictEqual((await resDots2.json()).filename, `${dotsBase}(1).wav`);
    console.log(`\x1b[32mPASSED\x1b[0m (saved as ${dotsBase}(1).wav)`);

    // ── TEST 5: GET /api/meetings search and filtering ──
    process.stdout.write('• Testing GET /api/meetings search filtering by title... ');
    const searchRes = await apiFetch(`${BASE_URL}/api/meetings?search=${testBase}`);
    assert.strictEqual(searchRes.status, 200);
    const searchItems = await searchRes.json();
    assert.strictEqual(searchItems.length, 3, `Expected exactly 3 matching items, got ${searchItems.length}`);
    for (const m of searchItems) {
      assert.ok(
        (m.title || '').includes(testBase) || (m.audio_url || '').includes(testBase),
        'All filtered records must match search term'
      );
    }
    console.log('\x1b[32mPASSED\x1b[0m');

    process.stdout.write('• Testing GET /api/meetings filtering by stage... ');
    const allRes = await apiFetch(`${BASE_URL}/api/meetings`);
    const allMeetings = await allRes.json();
    assert.ok(allMeetings.length > 0);
    const presentStages = Array.from(new Set(allMeetings.map(m => (m.workflow_state || 'uploaded').toLowerCase())));
    const stageQuery = presentStages.join(',');
    const stageRes = await apiFetch(`${BASE_URL}/api/meetings?stage=${stageQuery}`);
    assert.strictEqual(stageRes.status, 200);
    const stageItems = await stageRes.json();
    assert.ok(stageItems.length > 0);
    assert.ok(stageItems.every(m => presentStages.includes((m.workflow_state || 'uploaded').toLowerCase())));
    console.log('\x1b[32mPASSED\x1b[0m');

    process.stdout.write('• Testing GET /api/meetings date range filtering... ');
    const today = new Date().toISOString().split('T')[0];
    const dateRes = await apiFetch(`${BASE_URL}/api/meetings?start_date=${today}&end_date=${today}`);
    assert.strictEqual(dateRes.status, 200);
    const dateItems = await dateRes.json();
    assert.ok(dateItems.length >= 3, 'Should match recently uploaded meetings from today');
    console.log('\x1b[32mPASSED\x1b[0m');

    process.stdout.write('• Testing GET /api/meetings confidence bounds... ');
    const confRes = await apiFetch(`${BASE_URL}/api/meetings?min_confidence=0&max_confidence=100`);
    assert.strictEqual(confRes.status, 200);
    console.log('\x1b[32mPASSED\x1b[0m');

    console.log('\n------------------------------------------------------');
    console.log('   All Safe Upload & Search API Tests PASSED!          ');
    console.log('------------------------------------------------------\n');
  } finally {
    serverProcess.kill();
    try { fs.rmSync(testUploadsDir, { recursive: true, force: true }); } catch {}
    try { if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath); } catch {}
  }
}

run().catch(err => {
  console.error('API Verification failed:', err);
  process.exit(1);
});
