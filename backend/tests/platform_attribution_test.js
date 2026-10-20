/**
 * platform_attribution_test.js
 * 
 * Comprehensive automated verification test suite for PulseSync AI's
 * Multi-Platform Meeting Bot & Platform-Native Speaker Attribution architecture.
 * 
 * Tests:
 * 1. Google Meet Virtual Streams & CSRC Dynamic Stream Switching (4 participants across 3 virtual streams)
 * 2. Zoom RTMS WebSocket Ingestion & Real-Time Fragment Stitching
 * 3. Microsoft Teams Active-Speaker Event & Roster Resolution
 * 4. Priority Attribution Waterfall & Manual Override (CSRC > user_id > metadata > diarization fallback > manual)
 * 5. RoleResolver Identity/Role Decoupling (Workspace domains, CRM contacts, Conversational cues)
 * 6. Dual-Transcript Reconciliation without Duplicate Lines
 * 7. End-to-End Worker Execution with Grounded Buyer vs Rep Commitment Partitioning
 */

import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ParticipantIdentity } from '../services/meeting-bot/attribution/ParticipantIdentity.js';
import { ParticipantRegistry } from '../services/meeting-bot/attribution/ParticipantRegistry.js';
import { SpeakerAttributionEngine } from '../services/meeting-bot/attribution/SpeakerAttributionEngine.js';
import { RoleResolver } from '../services/meeting-bot/attribution/RoleResolver.js';
import { GoogleMeetProvider } from '../services/meeting-bot/providers/GoogleMeetProvider.js';
import { ZoomProvider } from '../services/meeting-bot/providers/ZoomProvider.js';
import { ZoomRtmsAdapter } from '../services/meeting-bot/providers/ZoomRtmsAdapter.js';
import { MicrosoftTeamsProvider } from '../services/meeting-bot/providers/MicrosoftTeamsProvider.js';
import { defaultProviderRegistry } from '../services/meeting-bot/providers/ProviderRegistry.js';
import { BotJobState, JobStateMachine } from '../services/meeting-bot/JobStateMachine.js';
import { MeetingBotWorker } from '../workers/MeetingBotWorker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const UPLOADS_DIR = path.join(ROOT_DIR, 'backend/uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

let passedTests = 0;
let totalTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    Error: ${err.message}`);
    throw err;
  }
}

async function testAsync(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    Error: ${err.message}`);
    throw err;
  }
}

console.log('\n================================================================');
console.log('PulseSync AI — Platform-Native Speaker Attribution Test Suite');
console.log('================================================================\n');

// ── 1. Google Meet CSRC Dynamic Virtual Stream Switching ─────────────────────
console.log('Test Suite 1: Google Meet CSRC Dynamic Virtual Stream Switching');

test('Google Meet Provider extracts and validates meeting spaces', () => {
  const provider = new GoogleMeetProvider();
  assert.strictEqual(provider.validateMeetingUrl('https://meet.google.com/abc-defg-hij'), true);
  assert.strictEqual(provider.validateMeetingUrl('https://meet.google.com/invalid-url'), false);
  const meta = provider.extractMeetingMetadata('https://meet.google.com/abc-defg-hij');
  assert.strictEqual(meta.valid, true);
  assert.strictEqual(meta.meetingId, 'abc-defg-hij');
});

test('Google Meet resolves true participant via CSRC and does NOT bind SSRC permanently', () => {
  const meetProvider = new GoogleMeetProvider();
  const registry = new ParticipantRegistry('meet_test_101');

  // Register 4 participants
  const partA = registry.registerParticipant({
    displayName: 'Vardhan (Sales Rep)',
    platform: 'google_meet',
    metadata: { csrc: 1001 }
  });
  const partB = registry.registerParticipant({
    displayName: 'Sarah Connor (Buyer)',
    platform: 'google_meet',
    metadata: { csrc: 1002 }
  });
  const partC = registry.registerParticipant({
    displayName: 'Dave Miller (Architect)',
    platform: 'google_meet',
    metadata: { csrc: 1003 }
  });
  const partD = registry.registerParticipant({
    displayName: 'Elena Rostova (CFO)',
    platform: 'google_meet',
    metadata: { csrc: 1004 }
  });

  const dummyAudio = Buffer.alloc(160, 0);

  // Packet 1: SSRC 501 carrying CSRC 1001 (Participant A)
  const chunk1 = meetProvider.handleRtpPacket({
    ssrc: 501,
    csrc: 1001,
    timestamp: 1000,
    payload: dummyAudio
  }, registry);
  assert.strictEqual(chunk1.participantId, partA.id);
  assert.strictEqual(chunk1.displayName, 'Vardhan (Sales Rep)');

  // Packet 2: Meet multiplexer dynamically switches SSRC 501 to CSRC 1004 (Participant D)
  const chunk2 = meetProvider.handleRtpPacket({
    ssrc: 501,
    csrc: 1004,
    timestamp: 2000,
    payload: dummyAudio
  }, registry);
  assert.strictEqual(chunk2.participantId, partD.id, 'Must resolve to Participant D via CSRC, not Participant A');
  assert.strictEqual(chunk2.displayName, 'Elena Rostova (CFO)');

  // Packet 3: Virtual stream SSRC 502 carrying CSRC 1002 (Participant B)
  const chunk3 = meetProvider.handleRtpPacket({
    ssrc: 502,
    csrc: 1002,
    timestamp: 3000,
    payload: dummyAudio
  }, registry);
  assert.strictEqual(chunk3.participantId, partB.id);

  // Packet 4: Virtual stream SSRC 503 carrying CSRC 1003 (Participant C)
  const chunk4 = meetProvider.handleRtpPacket({
    ssrc: 503,
    csrc: 1003,
    timestamp: 4000,
    payload: dummyAudio
  }, registry);
  assert.strictEqual(chunk4.participantId, partC.id);
});

// ── 2. Zoom RTMS Ingestion & Transcript Fragment Stitching ────────────────────
console.log('\nTest Suite 2: Zoom RTMS Ingestion & Transcript Fragment Stitching');

test('Zoom Provider reports RTMS per-participant media capabilities', async () => {
  const provider = new ZoomProvider({ mode: 'mock' });
  const caps = await provider.getCapabilities();
  assert.strictEqual(caps.status, 'mock');
  assert.strictEqual(caps.features.perParticipantAudio, true);
  assert.strictEqual(caps.features.participantAttributedTranscript, true);
});

test('Zoom RTMS Adapter ingests per-participant L16 PCM audio tagged with user_id', () => {
  const registry = new ParticipantRegistry('zoom_test_201');
  const rtms = new ZoomRtmsAdapter({ meetingId: 'zoom_test_201', registry });

  let emittedChunk = null;
  rtms.on('attributed_audio', (chunk) => {
    emittedChunk = chunk;
  });

  const pcmBytes = Buffer.alloc(320, 1);
  const chunk = rtms.handleAudioFrame({
    user_id: '16778240',
    user_name: 'Sarah Connor',
    timestamp: 1690000000,
    audioData: pcmBytes,
    durationMs: 100
  });

  assert.strictEqual(chunk.displayName, 'Sarah Connor');
  assert.strictEqual(chunk.codec, 'pcm_16le');
  assert.strictEqual(chunk.sampleRate, 16000);
  assert.strictEqual(chunk.source, 'zoom_rtms');
  assert.strictEqual(emittedChunk, chunk);

  // Verify participant registered in registry
  const participant = registry.resolveZoomUser('16778240');
  assert.ok(participant);
  assert.strictEqual(participant.displayName, 'Sarah Connor');
});

test('Zoom RTMS Adapter stitches live transcript fragments into cohesive utterances', () => {
  const registry = new ParticipantRegistry('zoom_test_202');
  const rtms = new ZoomRtmsAdapter({ meetingId: 'zoom_test_202', registry });

  let emittedSegment = null;
  rtms.on('attributed_segment', (seg) => {
    emittedSegment = seg;
  });

  // Fragment 1
  rtms.handleTranscriptFragment({
    user_id: '16778240',
    user_name: 'Sarah Connor',
    start_time: 12.0,
    end_time: 13.2,
    data: 'our security team',
    is_final: false
  });

  // Fragment 2
  rtms.handleTranscriptFragment({
    user_id: '16778240',
    user_name: 'Sarah Connor',
    start_time: 13.2,
    end_time: 15.0,
    data: 'requires SOC2 Type II compliance',
    is_final: true // final fragment flushes buffer
  });

  assert.ok(emittedSegment, 'Must emit stitched AttributedTranscriptSegment');
  assert.strictEqual(emittedSegment.displayName, 'Sarah Connor');
  assert.strictEqual(emittedSegment.text, 'our security team requires SOC2 Type II compliance');
  assert.strictEqual(emittedSegment.startTime, 12.0);
  assert.strictEqual(emittedSegment.endTime, 15.0);
  assert.strictEqual(emittedSegment.attributionSource, 'platform_transcript');
});

// ── 3. Microsoft Teams Active-Speaker Events & Roster ────────────────────────
console.log('\nTest Suite 3: Microsoft Teams Active-Speaker Events & Roster');

test('Microsoft Teams Provider maps Calling Bot active speaker events', () => {
  const teamsProvider = new MicrosoftTeamsProvider();
  const registry = new ParticipantRegistry('teams_test_301');

  let activeStarted = false;
  let activeStopped = false;

  registry.on('speaker_started', () => { activeStarted = true; });
  registry.on('speaker_stopped', () => { activeStopped = true; });

  // Speaker starts speaking
  const participant = teamsProvider.handleActiveSpeakerEvent({
    participantId: 'aad-user-884920',
    displayName: 'David Miller',
    isSpeaking: true
  }, registry);

  assert.ok(participant);
  assert.strictEqual(participant.displayName, 'David Miller');
  assert.strictEqual(activeStarted, true);
  assert.strictEqual(registry.getActiveSpeakers().length, 1);

  // Speaker stops speaking
  teamsProvider.handleActiveSpeakerEvent({
    participantId: 'aad-user-884920',
    displayName: 'David Miller',
    isSpeaking: false
  }, registry);

  assert.strictEqual(activeStopped, true);
  assert.strictEqual(registry.getActiveSpeakers().length, 0);
});

// ── 4. Priority Attribution Waterfall & Manual Override ──────────────────────
console.log('\nTest Suite 4: Priority Attribution Waterfall & Manual Override');

test('Attribution engine enforces priority: Native > Transcript > Metadata > Diarization > Manual', () => {
  const registry = new ParticipantRegistry('waterfall_test_401');
  const engine = new SpeakerAttributionEngine({ participantRegistry: registry });

  const p1 = registry.registerParticipant({
    displayName: 'Vardhan',
    email: 'vardhan@pulsesync.ai',
    platform: 'google_meet',
    metadata: { csrc: 9901 }
  });

  const p2 = registry.registerParticipant({
    displayName: 'Sarah Connor',
    email: 'sarah@acme.com',
    platform: 'zoom',
    platformParticipantId: 'zoom_777'
  });

  // Level 1: Google Meet CSRC
  const resMeet = engine.attributeSource({ csrc: 9901 });
  assert.strictEqual(resMeet.source, 'google_meet_csrc');
  assert.strictEqual(resMeet.participant.id, p1.id);

  // Level 2: Zoom RTMS user_id
  const resZoom = engine.attributeSource({ zoomUserId: 'zoom_777' });
  assert.strictEqual(resZoom.source, 'zoom_user_id');
  assert.strictEqual(resZoom.participant.id, p2.id);

  // Level 3: Platform metadata / name matching
  const resMeta = engine.attributeSource({ displayName: 'Sarah Connor' });
  assert.strictEqual(resMeta.source, 'platform_metadata');
  assert.strictEqual(resMeta.participant.id, p2.id);

  // Level 4: Diarization fallback (unknown speaker tag)
  const resDiar = engine.attributeSource({ speakerTag: 'speaker_4' });
  assert.strictEqual(resDiar.source, 'diarization_fallback');
  assert.strictEqual(resDiar.participant, null);

  // Level 5: Manual Override locks in priority
  registry.recordSpeakerMapping('speaker_4', p1.id, 'manual', 1.0);
  const resManual = engine.attributeSource({ speakerTag: 'speaker_4' });
  assert.strictEqual(resManual.source, 'manual');
  assert.strictEqual(resManual.participant.id, p1.id);
});

// ── 5. RoleResolver Identity/Role Decoupling ──────────────────────────────────
console.log('\nTest Suite 5: RoleResolver Identity/Role Decoupling');

test('RoleResolver identifies Sales Rep, Buyer, and Stakeholders from domain and cues', () => {
  const resolver = new RoleResolver({
    internalDomains: ['pulsesync.ai', 'pulsesync.com'],
    defaultInternalOrg: 'PulseSync'
  });

  // Rep test: pulsesync.ai internal domain
  const rep = new ParticipantIdentity({
    displayName: 'Vardhan',
    email: 'vardhan@pulsesync.ai',
    isHost: true
  });
  const repRole = resolver.resolveRole(rep);
  assert.strictEqual(repRole.role, 'sales_rep');
  assert.strictEqual(repRole.organization, 'PulseSync');
  assert.strictEqual(repRole.confidence, 0.95);

  // Buyer test: external company domain
  const buyer = new ParticipantIdentity({
    displayName: 'Sarah Connor',
    email: 'sarah@acmecorp.com',
    isHost: false
  });
  const buyerRole = resolver.resolveRole(buyer, { crmAccountName: 'Acme Corporation' });
  assert.strictEqual(buyerRole.role, 'buyer');
  assert.strictEqual(buyerRole.organization, 'Acme Corporation');

  // Conversational cues test
  const unknownPart = new ParticipantIdentity({
    displayName: 'Dave',
    email: null
  });
  const cueRole = resolver.resolveRole(unknownPart, {
    transcriptSnippet: "We have an allocated budget of $80,000 for this project."
  });
  assert.strictEqual(cueRole.role, 'buyer');
  assert.strictEqual(cueRole.confidence, 0.70);
});

// ── 6. Dual-Transcript Reconciliation ─────────────────────────────────────────
console.log('\nTest Suite 6: Dual-Transcript Reconciliation');

test('Reconciles platform transcript attribution with STT text without duplicate lines', () => {
  const registry = new ParticipantRegistry('recon_test_601');
  const pBuyer = registry.registerParticipant({
    displayName: 'Sarah Connor',
    platform: 'zoom',
    platformParticipantId: '2001',
    role: 'buyer',
    organization: 'Acme Corp'
  });
  registry.mapZoomUser('2001', pBuyer.id);

  const engine = new SpeakerAttributionEngine({ participantRegistry: registry });

  const platformSegments = [
    {
      zoomUserId: '2001',
      displayName: 'Sarah Connor',
      startTime: 5.0,
      endTime: 10.0,
      text: 'our team needs hubspot sync'
    }
  ];

  const sttSegments = [
    {
      speaker: 'SPEAKER_01',
      startTime: 5.1,
      endTime: 9.8,
      text: 'Our team definitely requires seamless native HubSpot synchronization.'
    }
  ];

  const reconciled = engine.reconcileDualTranscripts(platformSegments, sttSegments);
  assert.strictEqual(reconciled.length, 1, 'Must avoid duplicate lines');
  assert.strictEqual(reconciled[0].displayName, 'Sarah Connor');
  assert.strictEqual(reconciled[0].role, 'buyer');
  assert.strictEqual(reconciled[0].text, 'Our team definitely requires seamless native HubSpot synchronization.');
  assert.strictEqual(reconciled[0].transcriptionSource, 'hybrid_stt_platform_attributed');
});

// ── 7. End-to-End Worker & Grounded Prompt Generation ────────────────────────
console.log('\nTest Suite 7: End-to-End Worker & Grounded Prompt Generation');

await testAsync('MeetingBotWorker attributes participants, saves mappings, and generates grounded prompts', async () => {
  let fallbackData = {
    meeting_bot_jobs: [],
    meetings: [],
    speakers: [],
    segments: [],
    analytics: [],
    meeting_participants: [],
    speaker_mappings: [],
  };

  const worker = new MeetingBotWorker({
    pool: null,
    useFallbackDb: true,
    readFallbackDb: () => fallbackData,
    writeFallbackDb: (d) => { fallbackData = d; },
    triggerJobProcessor: async () => {},
    uploadsDir: UPLOADS_DIR,
  });

  // Schedule mock job
  const job = await worker.createJob({
    provider: 'google_meet',
    mode: 'mock',
    meeting_url: 'https://meet.google.com/xyz-uvwx-rst',
    meeting_title: 'Enterprise Architecture & Procurement Sync',
    bot_participant_name: 'PulseSync Assistant'
  });

  assert.strictEqual(job.status, BotJobState.SCHEDULED);

  // Execute job workflow
  await worker._executeJobWorkflow(job.id);

  const updatedJob = await worker.getJob(job.id);
  assert.strictEqual(updatedJob.status, BotJobState.READY_FOR_REVIEW);
  assert.strictEqual(updatedJob.attribution_status, 'completed');
  assert.ok(updatedJob.participant_count >= 3);

  // Verify meeting_participants in fallback DB
  const participants = await worker.getMeetingParticipants(updatedJob.meeting_id);
  assert.ok(participants.length >= 3);
  const vardhan = participants.find(p => p.display_name === 'Vardhan');
  const sarah = participants.find(p => p.display_name === 'Sarah Connor');
  const dave = participants.find(p => p.display_name === 'Dave Miller');

  assert.ok(vardhan, 'Vardhan must be registered as participant');
  assert.strictEqual(vardhan.role, 'sales_rep');
  assert.strictEqual(vardhan.organization, 'PulseSync');

  assert.ok(sarah, 'Sarah Connor must be registered as participant');
  assert.strictEqual(sarah.role, 'buyer');
  assert.strictEqual(sarah.organization, 'Acme Corp');

  assert.ok(dave, 'Dave Miller must be registered as participant');
  assert.strictEqual(dave.role, 'buyer');

  // Verify speaker mappings
  const mappings = await worker.getSpeakerMappings(updatedJob.meeting_id);
  assert.ok(mappings.length >= 3);

  // Verify segments formatted for LLM grounding
  const segments = fallbackData.segments.filter(s => s.meeting_id === updatedJob.meeting_id);
  assert.ok(segments.length >= 4);
  assert.strictEqual(segments[0].speaker_name, 'Vardhan');
  assert.strictEqual(segments[0].role, 'sales_rep');

  // Test manual remapping
  const remapRes = await worker.remapSpeaker(updatedJob.meeting_id, 'Dave Miller', sarah.id);
  assert.strictEqual(remapRes.ok, true);
  assert.strictEqual(remapRes.displayName, 'Sarah Connor');

  const updatedMappings = await worker.getSpeakerMappings(updatedJob.meeting_id);
  const remapped = updatedMappings.find(m => m.speaker_id === 'Dave Miller');
  assert.strictEqual(remapped.participant_id, sarah.id);
  assert.strictEqual(remapped.source, 'manual');
});

console.log('\n----------------------------------------------------------------');
console.log(`Summary: All ${passedTests}/${totalTests} automated tests passed successfully!`);
console.log('----------------------------------------------------------------\n');
