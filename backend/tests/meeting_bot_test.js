/**
 * meeting_bot_test.js
 * Comprehensive test suite verifying:
 * 1. Provider URL validation & metadata extraction (Google Meet, Zoom, Microsoft Teams).
 * 2. Provider capabilities and credential status introspection.
 * 3. AudioNormalizer validation (reject empty/corrupted, validate valid audio).
 * 4. JobStateMachine transitions and status metadata.
 * 5. Asynchronous worker lifecycle, activity logging, cancellation, and retries.
 * 6. End-to-end Express API integration tests.
 */

import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import modules to test
import { defaultProviderRegistry } from '../services/meeting-bot/providers/ProviderRegistry.js';
import { GoogleMeetProvider } from '../services/meeting-bot/providers/GoogleMeetProvider.js';
import { ZoomProvider } from '../services/meeting-bot/providers/ZoomProvider.js';
import { MicrosoftTeamsProvider } from '../services/meeting-bot/providers/MicrosoftTeamsProvider.js';
import { AudioNormalizer } from '../services/meeting-bot/AudioNormalizer.js';
import { BotJobState, JobStateMachine } from '../services/meeting-bot/JobStateMachine.js';
import { ConversationCapture } from '../services/meeting-bot/ConversationCapture.js';
import { MeetingBotWorker } from '../workers/MeetingBotWorker.js';

let passedTests = 0;
let failedTests = 0;

async function runTest(name, fn) {
  process.stdout.write(`• Testing: ${name}... `);
  try {
    await fn();
    console.log(`\x1b[32mPASSED\x1b[0m`);
    passedTests++;
  } catch (err) {
    console.log(`\x1b[31mFAILED\x1b[0m`);
    console.error(err);
    failedTests++;
  }
}

async function runAllTests() {
  console.log('\n======================================================');
  console.log('   PulseSync Meeting Bot System Verification Suite   ');
  console.log('======================================================\n');

  // ── TEST 1: URL Detection & Provider Validation ─────────────────────────────
  await runTest('Google Meet URL validation & metadata', () => {
    const provider = new GoogleMeetProvider();
    assert.strictEqual(provider.validateMeetingUrl('https://meet.google.com/abc-defg-hij'), true);
    assert.strictEqual(provider.validateMeetingUrl('https://meet.google.com/abc-defg-hij?authuser=0'), true);
    assert.strictEqual(provider.validateMeetingUrl('https://meet.google.com/lookup/custom123'), true);
    assert.strictEqual(provider.validateMeetingUrl('https://zoom.us/j/123456789'), false);
    assert.strictEqual(provider.validateMeetingUrl('https://invalid.url/abc'), false);

    const meta = provider.extractMeetingMetadata('https://meet.google.com/abc-defg-hij');
    assert.strictEqual(meta.valid, true);
    assert.strictEqual(meta.meetingId, 'abc-defg-hij');
  });

  await runTest('Zoom URL validation & metadata', () => {
    const provider = new ZoomProvider();
    assert.strictEqual(provider.validateMeetingUrl('https://zoom.us/j/98765432101'), true);
    assert.strictEqual(provider.validateMeetingUrl('https://us02web.zoom.us/j/98765432101?pwd=securePassWord'), true);
    assert.strictEqual(provider.validateMeetingUrl('https://myco.zoom.us/w/123456789'), true);
    assert.strictEqual(provider.validateMeetingUrl('https://meet.google.com/abc-defg-hij'), false);

    const meta = provider.extractMeetingMetadata('https://us02web.zoom.us/j/98765432101?pwd=securePassWord');
    assert.strictEqual(meta.valid, true);
    assert.strictEqual(meta.meetingId, '98765432101');
    assert.strictEqual(meta.passcode, 'securePassWord');
  });

  await runTest('Microsoft Teams URL validation & metadata', () => {
    const provider = new MicrosoftTeamsProvider();
    const teamsUrl = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abcdef%40thread.v2/0?context=%7B%22Tid%22%3A%22tenant-id-123%22%7D';
    assert.strictEqual(provider.validateMeetingUrl(teamsUrl), true);
    assert.strictEqual(provider.validateMeetingUrl('https://teams.live.com/meet/123456789'), true);
    assert.strictEqual(provider.validateMeetingUrl('https://zoom.us/j/123456789'), false);

    const meta = provider.extractMeetingMetadata(teamsUrl);
    assert.strictEqual(meta.valid, true);
    assert.ok(meta.meetingId.includes('tenant-id-123'));
  });

  await runTest('ProviderRegistry auto-detection across all platforms', () => {
    const meetRes = defaultProviderRegistry.detectProviderFromUrl('https://meet.google.com/xyz-uvwx-rst');
    assert.strictEqual(meetRes.valid, true);
    assert.strictEqual(meetRes.provider, 'google_meet');

    const zoomRes = defaultProviderRegistry.detectProviderFromUrl('https://zoom.us/j/123456789');
    assert.strictEqual(zoomRes.valid, true);
    assert.strictEqual(zoomRes.provider, 'zoom');

    const teamsRes = defaultProviderRegistry.detectProviderFromUrl('https://teams.microsoft.com/l/meetup-join/thread123/0');
    assert.strictEqual(teamsRes.valid, true);
    assert.strictEqual(teamsRes.provider, 'microsoft_teams');

    const invalidRes = defaultProviderRegistry.detectProviderFromUrl('https://randomwebsite.com/meeting');
    assert.strictEqual(invalidRes.valid, false);
    assert.strictEqual(invalidRes.provider, null);
  });

  // ── TEST 2: Provider Capabilities & Honest Readiness Reporting ─────────────
  await runTest('Provider capabilities introspection (Mock & Live reporting)', async () => {
    const allCaps = await defaultProviderRegistry.getAllCapabilities();
    assert.strictEqual(allCaps.length, 3);

    const meetCap = allCaps.find(c => c.provider === 'google_meet');
    const zoomCap = allCaps.find(c => c.provider === 'zoom');
    const teamsCap = allCaps.find(c => c.provider === 'microsoft_teams');

    assert.ok(meetCap);
    assert.ok(zoomCap);
    assert.ok(teamsCap);
    assert.ok(meetCap.supportedModes.includes('realtime'));
    assert.ok(meetCap.supportedModes.includes('post_meeting_artifact'));
    assert.ok(['ready', 'mock', 'developer_preview', 'requires_auth'].includes(meetCap.status));
    assert.ok(['ready', 'mock', 'requires_auth'].includes(zoomCap.status));
    assert.ok(['ready', 'mock', 'requires_auth', 'requires_admin_consent'].includes(teamsCap.status));
  });

  // ── TEST 3: Audio Normalization & Validation ────────────────────────────────
  await runTest('AudioNormalizer validates valid WAV and rejects empty/corrupted', () => {
    const testDir = path.join(__dirname, 'temp_test_audio');
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

    const validWavPath = path.join(testDir, 'sample_valid.wav');
    AudioNormalizer.generateTestWav(validWavPath, 2);

    const validRes = AudioNormalizer.validateAudioFile(validWavPath);
    assert.strictEqual(validRes.valid, true);
    assert.strictEqual(validRes.format, 'wav');
    assert.ok(validRes.sizeBytes > 1000);

    // Empty audio check
    const emptyPath = path.join(testDir, 'empty.wav');
    fs.writeFileSync(emptyPath, Buffer.alloc(0));
    const emptyRes = AudioNormalizer.validateAudioFile(emptyPath);
    assert.strictEqual(emptyRes.valid, false);
    assert.strictEqual(emptyRes.error, 'EMPTY_AUDIO');

    // Corrupted audio check (< 64 bytes)
    const corruptPath = path.join(testDir, 'corrupt.wav');
    fs.writeFileSync(corruptPath, Buffer.from('RIFF_TOO_SHORT'));
    const corruptRes = AudioNormalizer.validateAudioFile(corruptPath);
    assert.strictEqual(corruptRes.valid, false);
    assert.strictEqual(corruptRes.error, 'CORRUPTED_AUDIO');

    // A sufficiently large file with no recognized media signature must also be rejected.
    const invalidHeaderPath = path.join(testDir, 'invalid-header.webm');
    fs.writeFileSync(invalidHeaderPath, Buffer.alloc(256, 0x41));
    const invalidHeaderRes = AudioNormalizer.validateAudioFile(invalidHeaderPath);
    assert.strictEqual(invalidHeaderRes.valid, false);
    assert.strictEqual(invalidHeaderRes.error, 'INVALID_AUDIO_HEADER');

    // Cleanup test files
    try {
      fs.unlinkSync(validWavPath);
      fs.unlinkSync(emptyPath);
      fs.unlinkSync(corruptPath);
      fs.unlinkSync(invalidHeaderPath);
      fs.rmdirSync(testDir);
    } catch (_) {}
  });

  // ── TEST 4: Job State Machine Lifecycle Transitions ────────────────────────
  await runTest('JobStateMachine validates correct lifecycle progression', () => {
    assert.strictEqual(JobStateMachine.canTransition(BotJobState.SCHEDULED, BotJobState.WAITING_FOR_MEETING), true);
    assert.strictEqual(JobStateMachine.canTransition(BotJobState.WAITING_FOR_MEETING, BotJobState.JOINING), true);
    assert.strictEqual(JobStateMachine.canTransition(BotJobState.JOINING, BotJobState.JOINED), true);
    assert.strictEqual(JobStateMachine.canTransition(BotJobState.JOINED, BotJobState.CAPTURING), true);
    assert.strictEqual(JobStateMachine.canTransition(BotJobState.CAPTURING, BotJobState.PROCESSING), true);
    assert.strictEqual(JobStateMachine.canTransition(BotJobState.PROCESSING, BotJobState.TRANSCRIBING), true);
    assert.strictEqual(JobStateMachine.canTransition(BotJobState.TRANSCRIBING, BotJobState.DIARIZING), true);
    assert.strictEqual(JobStateMachine.canTransition(BotJobState.DIARIZING, BotJobState.EXTRACTING), true);
    assert.strictEqual(JobStateMachine.canTransition(BotJobState.EXTRACTING, BotJobState.READY_FOR_REVIEW), true);

    // Invalid jumps should be blocked
    assert.strictEqual(JobStateMachine.canTransition(BotJobState.SCHEDULED, BotJobState.READY_FOR_REVIEW), false);
    assert.strictEqual(JobStateMachine.canTransition(BotJobState.WAITING_ROOM, BotJobState.EXTRACTING), false);

    // Status metadata inspection
    const metaCapturing = JobStateMachine.getMeta(BotJobState.CAPTURING);
    assert.strictEqual(metaCapturing.isActive, true);
    assert.strictEqual(metaCapturing.label, 'Capturing');

    const metaReady = JobStateMachine.getMeta(BotJobState.READY_FOR_REVIEW);
    assert.strictEqual(metaReady.isTerminal, true);
  });

  // ── TEST 5: Normalized ConversationCapture Model ────────────────────────────
  await runTest('Normalized ConversationCapture object contract', () => {
    const capture = new ConversationCapture({
      source: 'google_meet_bot',
      provider: 'google_meet',
      mode: 'realtime',
      title: 'Enterprise Sync',
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      mediaSource: { type: 'file', path: '/uploads/sample.wav', mimeType: 'audio/wav', durationSeconds: 60 },
      participants: [{ name: 'PulseSync AI', role: 'assistant', isBot: true }],
      consentState: 'granted',
    });

    assert.strictEqual(capture.source, 'google_meet_bot');
    assert.strictEqual(capture.provider, 'google_meet');
    assert.strictEqual(capture.mediaSource.durationSeconds, 60);
    const json = capture.toJSON();
    assert.strictEqual(json.consentState, 'granted');
  });

  // ── TEST 6: MeetingBotWorker Queue, Lifecycle & Structured Logging ─────────
  await runTest('MeetingBotWorker executes full async lifecycle in mock mode', async () => {
    const testUploads = path.join(__dirname, 'worker_test_uploads');
    if (!fs.existsSync(testUploads)) fs.mkdirSync(testUploads, { recursive: true });

    let fakeDb = {
      meeting_bot_jobs: [],
      meeting_bot_logs: [],
      meetings: [],
    };

    let processedMeetingId = null;

    const worker = new MeetingBotWorker({
      pool: null,
      useFallbackDb: true,
      readFallbackDb: () => fakeDb,
      writeFallbackDb: (data) => { fakeDb = data; },
      triggerJobProcessor: (mId) => { processedMeetingId = mId; },
      uploadsDir: testUploads,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    // Create a job scheduled for immediate execution
    const job = await worker.createJob({
      provider: 'google_meet',
      mode: 'mock',
      meeting_url: 'https://meet.google.com/abc-defg-hij',
      meeting_title: 'Worker Verification Meeting',
      consent_state: 'granted',
      scheduled_start: new Date().toISOString(),
    });

    assert.strictEqual(job.status, BotJobState.SCHEDULED);
    assert.strictEqual(job.provider, 'google_meet');

    // Run execution
    await worker._executeJobWorkflow(job.id);

    // Verify job reached READY_FOR_REVIEW
    const completedJob = await worker.getJob(job.id);
    if (completedJob.status !== BotJobState.READY_FOR_REVIEW) {
      console.log('completedJob error:', completedJob.error_code, completedJob.error_message);
    }
    assert.strictEqual(completedJob.status, BotJobState.READY_FOR_REVIEW);
    assert.ok(completedJob.joined_at);
    assert.ok(completedJob.meeting_ended_at);
    assert.strictEqual(completedJob.transcript_status, 'completed');
    assert.strictEqual(completedJob.extraction_status, 'completed');
    assert.ok(completedJob.meeting_id);
    assert.strictEqual(processedMeetingId, completedJob.meeting_id);

    // Verify structured chronological activity logs
    const logs = await worker.getJobLogs(job.id);
    assert.ok(logs.length >= 6, `Expected at least 6 log entries, found ${logs.length}`);
    const stages = logs.map(l => l.stage);
    assert.ok(stages.includes('SCHEDULED'));
    assert.ok(stages.includes('JOINING'));
    assert.ok(stages.includes('JOINED'));
    assert.ok(stages.includes('CAPTURING'));
    assert.ok(stages.includes('PROCESSING'));
    assert.ok(stages.includes('READY_FOR_REVIEW'));

    // Test Job Cancellation
    const cancelJob = await worker.createJob({
      provider: 'zoom',
      meeting_url: 'https://zoom.us/j/123456789',
      meeting_title: 'To Be Cancelled',
      scheduled_start: new Date(Date.now() + 600000).toISOString(),
    });
    const cancelRes = await worker.cancelJob(cancelJob.id);
    assert.strictEqual(cancelRes.status, BotJobState.CANCELLED);
    const refreshedCancel = await worker.getJob(cancelJob.id);
    assert.strictEqual(refreshedCancel.status, BotJobState.CANCELLED);

    // Test Job Retry
    const retryRes = await worker.retryJob(cancelJob.id);
    assert.strictEqual(retryRes.status, BotJobState.SCHEDULED);

    // Cleanup generated mock audio in testUploads
    try {
      const files = fs.readdirSync(testUploads);
      for (const f of files) fs.unlinkSync(path.join(testUploads, f));
      fs.rmdirSync(testUploads);
    } catch (_) {}
  });

  // Summary
  console.log('\n------------------------------------------------------');
  console.log(`Results: ${passedTests} passed, ${failedTests} failed`);
  console.log('------------------------------------------------------\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAllTests().catch(err => {
  console.error('Test suite runner crashed:', err);
  process.exit(1);
});
