import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeetingBotWorker } from '../workers/MeetingBotWorker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTests() {
  console.log('\n======================================================');
  console.log('   PulseSync Meeting Bot Live Transcript Test Suite   ');
  console.log('======================================================\n');

  const testDbPath = path.join(__dirname, 'test_transcript_db.json');
  fs.writeFileSync(testDbPath, JSON.stringify({
    meetings: [],
    speakers: [],
    segments: [],
    analytics: [],
    meeting_bot_jobs: [],
    meeting_bot_logs: [],
  }, null, 2));

  const readDb = () => JSON.parse(fs.readFileSync(testDbPath, 'utf8'));
  const writeDb = (data) => fs.writeFileSync(testDbPath, JSON.stringify(data, null, 2));

  const worker = new MeetingBotWorker({
    useFallbackDb: true,
    readFallbackDb: readDb,
    writeFallbackDb: writeDb,
    uploadsDir: path.join(__dirname, '../uploads'),
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  });

  // Test 1: _ensureMeetingRecord with live transcript segments
  console.log('• Testing: _ensureMeetingRecord persists live captured dialogue segments...');
  const jobId = crypto.randomUUID();
  const job = {
    id: jobId,
    provider: 'google_meet',
    meeting_url: 'https://meet.google.com/test-room',
    meeting_title: 'Live Transcript Test Sync',
    status: 'CAPTURING',
    consent_state: 'granted',
  };

  const sampleLiveSegments = [
    { id: 'seg_1', speaker: 'Vardhan', text: 'Hello everyone, welcome to PulseSync sales intelligence demonstration.', start: 0, end: 5.5, confidence: 0.98 },
    { id: 'seg_2', speaker: 'Prospect Lead', text: 'Thanks Vardhan! We are looking to automate our meeting action items and CRM notes.', start: 6.0, end: 12.0, confidence: 0.96 },
    { id: 'seg_3', speaker: 'Vardhan', text: 'PulseSync handles that automatically with live diarization and CRM sync.', start: 12.5, end: 18.0, confidence: 0.97 },
  ];

  const meetingId = await worker._ensureMeetingRecord(job, '/media/test.webm', sampleLiveSegments);
  assert.ok(meetingId, 'Expected valid meeting ID to be created');

  const dbData = readDb();
  const createdMeeting = dbData.meetings.find(m => m.id === meetingId);
  assert.strictEqual(createdMeeting.status, 'completed', 'Meeting status should be completed');
  assert.strictEqual(createdMeeting.workflow_state, 'transcript_review', 'Meeting workflow_state should be transcript_review');
  assert.strictEqual(createdMeeting.duration_seconds, 18, 'Duration should match max segment end time (18s)');

  // Verify speakers
  const meetingSpeakers = dbData.speakers.filter(s => s.meeting_id === meetingId);
  assert.strictEqual(meetingSpeakers.length, 2, 'Should create exactly 2 unique speakers');
  assert.ok(meetingSpeakers.some(s => s.name === 'Vardhan'), 'Expected Vardhan speaker record');
  assert.ok(meetingSpeakers.some(s => s.name === 'Prospect Lead'), 'Expected Prospect Lead speaker record');

  // Verify segments
  const meetingSegments = dbData.segments.filter(s => s.meeting_id === meetingId);
  assert.strictEqual(meetingSegments.length, 3, 'Should create exactly 3 transcript segments');
  assert.strictEqual(meetingSegments[0].speaker_name, 'Vardhan');
  assert.strictEqual(meetingSegments[0].text, 'Hello everyone, welcome to PulseSync sales intelligence demonstration.');
  assert.strictEqual(meetingSegments[1].speaker_name, 'Prospect Lead');

  // Verify analytics
  const meetingAnalytics = dbData.analytics.filter(a => a.meeting_id === meetingId);
  assert.strictEqual(meetingAnalytics.length, 2, 'Should generate analytics for both speakers');
  const vardhanAnalytics = meetingAnalytics.find(a => a.speaker_name === 'Vardhan');
  assert.ok(vardhanAnalytics.talk_time_seconds > 0, 'Vardhan should have positive talk time');
  assert.ok(vardhanAnalytics.words_per_minute > 0, 'Vardhan should have calculated WPM');

  console.log('• Testing: _ensureMeetingRecord persists live captured dialogue segments... PASSED');

  // Clean up
  try { fs.unlinkSync(testDbPath); } catch (_) {}

  console.log('\n------------------------------------------------------');
  console.log('   All Transcript Capture & Storage Tests PASSED!     ');
  console.log('------------------------------------------------------\n');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
