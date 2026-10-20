/**
 * SpeakerAttributionEngine.js
 * 
 * Core speaker attribution engine implementing a priority waterfall:
 * 1. Platform Native Attribution (Google Meet CSRC, Zoom RTMS user_id, Teams speaker events)
 * 2. Platform Transcript Attribution (Platform-native transcripts with participant tags)
 * 3. Platform Metadata Attribution (Roster matching & email correlation)
 * 4. Diarization Attribution (pyannote acoustic clustering fallback)
 * 5. Manual Attribution (User manual override in Review Center)
 * 
 * Also handles dual-transcript reconciliation without duplicate lines.
 */

import { AttributedTranscriptSegment } from './AttributedTranscriptSegment.js';

export class SpeakerAttributionEngine {
  /**
   * @param {Object} options
   * @param {import('./ParticipantRegistry.js').ParticipantRegistry} options.participantRegistry
   * @param {import('./RoleResolver.js').RoleResolver} [options.roleResolver]
   */
  constructor(options = {}) {
    this.participantRegistry = options.participantRegistry;
    this.roleResolver = options.roleResolver;
    this.segments = []; // Array<AttributedTranscriptSegment>
  }

  /**
   * Attribute an audio chunk or event to a participant
   * @param {Object} packet
   * @param {string|number} [packet.csrc] - Google Meet CSRC
   * @param {string|number} [packet.zoomUserId] - Zoom user_id
   * @param {string} [packet.teamsUserId] - Teams user ID
   * @param {string} [packet.speakerTag] - Generic speaker tag e.g. "speaker_0"
   * @param {string} [packet.displayName]
   * @returns {{ participant: import('./ParticipantIdentity.js').ParticipantIdentity|null, source: string, confidence: number }}
   */
  attributeSource(packet = {}) {
    // 1. Check manual mapping override first
    if (packet.speakerTag && this.participantRegistry) {
      const existingMapping = this.participantRegistry.getSpeakerMapping(packet.speakerTag);
      if (existingMapping && existingMapping.source === 'manual') {
        const participant = this.participantRegistry.getParticipant(existingMapping.participantId);
        if (participant) {
          return { participant, source: 'manual', confidence: 1.0 };
        }
      }
    }

    // 2. Platform Native: Google Meet CSRC
    if (packet.csrc && this.participantRegistry) {
      const participant = this.participantRegistry.resolveCsrc(packet.csrc);
      if (participant) {
        return { participant, source: 'google_meet_csrc', confidence: 0.99 };
      }
    }

    // 3. Platform Native: Zoom RTMS user_id
    if (packet.zoomUserId && this.participantRegistry) {
      const participant = this.participantRegistry.resolveZoomUser(packet.zoomUserId);
      if (participant) {
        return { participant, source: 'zoom_user_id', confidence: 1.0 };
      }
    }

    // 4. Platform Native: Teams user ID
    if (packet.teamsUserId && this.participantRegistry) {
      const participant = this.participantRegistry.resolveTeamsUser(packet.teamsUserId);
      if (participant) {
        return { participant, source: 'teams_participant', confidence: 0.98 };
      }
    }

    // 5. Platform Metadata / Name matching
    if (packet.displayName && this.participantRegistry) {
      const participant = this.participantRegistry.findParticipantByName(packet.displayName);
      if (participant) {
        return { participant, source: 'platform_metadata', confidence: 0.90 };
      }
    }

    // 6. Existing automatic speaker mapping lookup
    if (packet.speakerTag && this.participantRegistry) {
      const mapping = this.participantRegistry.getSpeakerMapping(packet.speakerTag);
      if (mapping) {
        const participant = this.participantRegistry.getParticipant(mapping.participantId);
        if (participant) {
          return { participant, source: mapping.source, confidence: mapping.confidence };
        }
      }
    }

    // 7. Fallback: Diarization / Unknown
    return {
      participant: null,
      source: 'diarization_fallback',
      confidence: 0.50
    };
  }

  /**
   * Ingest and attribute a transcript utterance
   * @param {Object} rawSegment
   * @returns {AttributedTranscriptSegment}
   */
  processTranscriptSegment(rawSegment) {
    const { participant, source, confidence } = this.attributeSource({
      csrc: rawSegment.csrc,
      zoomUserId: rawSegment.zoomUserId || rawSegment.user_id,
      teamsUserId: rawSegment.teamsUserId || rawSegment.participant_id,
      speakerTag: rawSegment.speaker || rawSegment.speakerId,
      displayName: rawSegment.displayName || rawSegment.user_name || rawSegment.speaker_name
    });

    let participantId = participant ? participant.id : (rawSegment.participantId || `unknown_${rawSegment.speaker || '0'}`);
    let displayName = participant ? participant.displayName : (rawSegment.displayName || rawSegment.user_name || `Speaker ${rawSegment.speaker || '1'}`);
    let role = participant ? participant.role : (rawSegment.role || 'unknown');
    let organization = participant ? participant.organization : (rawSegment.organization || null);

    const segment = new AttributedTranscriptSegment({
      id: rawSegment.id || `seg_${this.segments.length + 1}`,
      meetingId: rawSegment.meetingId || (this.participantRegistry ? this.participantRegistry.meetingId : null),
      participantId,
      speakerId: rawSegment.speaker || rawSegment.speakerId || participantId,
      displayName,
      role,
      organization,
      startTime: typeof rawSegment.startTime === 'number' ? rawSegment.startTime : (rawSegment.start || 0),
      endTime: typeof rawSegment.endTime === 'number' ? rawSegment.endTime : (rawSegment.end || 0),
      text: rawSegment.text || '',
      words: rawSegment.words || [],
      confidence: rawSegment.confidence || 0.95,
      attributionSource: source,
      attributionConfidence: confidence,
      transcriptionSource: rawSegment.transcriptionSource || (source.startsWith('zoom') || source.startsWith('google') ? 'platform_native_transcript' : 'whisper'),
      metadata: rawSegment.metadata || {}
    });

    this.segments.push(segment);
    return segment;
  }

  /**
   * Reconcile dual transcripts: platform real-time transcript + Whisper STT
   * Merges STT text accuracy with platform-native speaker attribution without line duplication.
   * @param {Array<Object>} platformTranscriptSegments
   * @param {Array<Object>} sttSegments
   * @returns {Array<AttributedTranscriptSegment>}
   */
  reconcileDualTranscripts(platformTranscriptSegments = [], sttSegments = []) {
    // If only platform transcript is available
    if ((!sttSegments || sttSegments.length === 0) && platformTranscriptSegments.length > 0) {
      this.segments = platformTranscriptSegments.map(s => this.processTranscriptSegment(s));
      return this.segments;
    }

    // If only STT segments are available
    if ((!platformTranscriptSegments || platformTranscriptSegments.length === 0) && sttSegments.length > 0) {
      this.segments = sttSegments.map(s => this.processTranscriptSegment(s));
      return this.segments;
    }

    // When both exist: Match STT segments with overlapping platform native segments to get true participant
    const reconciled = [];
    for (let i = 0; i < sttSegments.length; i++) {
      const stt = sttSegments[i];
      const sttStart = typeof stt.startTime === 'number' ? stt.startTime : (stt.start || 0);
      const sttEnd = typeof stt.endTime === 'number' ? stt.endTime : (stt.end || sttStart + 2);

      // Find overlapping platform segment
      let bestMatch = null;
      let maxOverlap = 0;

      for (const plat of platformTranscriptSegments) {
        const platStart = typeof plat.startTime === 'number' ? plat.startTime : (plat.start || 0);
        const platEnd = typeof plat.endTime === 'number' ? plat.endTime : (plat.end || platStart + 2);

        const overlapStart = Math.max(sttStart, platStart);
        const overlapEnd = Math.min(sttEnd, platEnd);
        const overlap = Math.max(0, overlapEnd - overlapStart);

        if (overlap > maxOverlap) {
          maxOverlap = overlap;
          bestMatch = plat;
        }
      }

      // If good overlap found, take participant attribution from platform, text from STT
      if (bestMatch && maxOverlap > 0.3) {
        const attributed = this.processTranscriptSegment({
          ...stt,
          csrc: bestMatch.csrc,
          zoomUserId: bestMatch.zoomUserId || bestMatch.user_id,
          teamsUserId: bestMatch.teamsUserId || bestMatch.participant_id,
          displayName: bestMatch.displayName || bestMatch.user_name,
          transcriptionSource: 'hybrid_stt_platform_attributed'
        });
        reconciled.push(attributed);
      } else {
        // Fallback to STT with acoustic diarization
        const attributed = this.processTranscriptSegment({
          ...stt,
          transcriptionSource: 'whisper'
        });
        reconciled.push(attributed);
      }
    }

    this.segments = reconciled;
    return reconciled;
  }

  /**
   * Apply manual reassignment for a speaker
   * @param {string} speakerId
   * @param {string} targetParticipantId
   */
  remapSpeaker(speakerId, targetParticipantId) {
    if (!this.participantRegistry) return;
    const targetParticipant = this.participantRegistry.getParticipant(targetParticipantId);
    if (!targetParticipant) {
      throw new Error(`Participant with ID ${targetParticipantId} not found in registry`);
    }

    // Save manual mapping with top priority
    this.participantRegistry.recordSpeakerMapping(speakerId, targetParticipantId, 'manual', 1.0);

    // Update existing segments
    for (const segment of this.segments) {
      if (segment.speakerId === speakerId) {
        segment.participantId = targetParticipant.id;
        segment.displayName = targetParticipant.displayName;
        segment.role = targetParticipant.role;
        segment.organization = targetParticipant.organization;
        segment.attributionSource = 'manual';
        segment.attributionConfidence = 1.0;
      }
    }
  }

  getSegments() {
    return this.segments;
  }

  /**
   * Generate grounded prompt lines for AI extraction engine
   */
  getFormattedPromptText() {
    return this.segments.map(s => s.formatPromptLine()).join('\n');
  }

  toJSON() {
    return {
      segmentCount: this.segments.length,
      segments: this.segments.map(s => s.toJSON())
    };
  }
}

export default SpeakerAttributionEngine;
