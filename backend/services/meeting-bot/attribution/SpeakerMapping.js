/**
 * SpeakerMapping.js
 * 
 * Maps stream-level or acoustic speaker identifiers to canonical participant records
 * with source provenance tracking (platform native, transcript, diarization fallback, manual).
 */

export class SpeakerMapping {
  /**
   * @param {Object} params
   * @param {string} [params.id]
   * @param {string} params.meetingId
   * @param {string} params.speakerId - e.g. "speaker_0", "csrc_382918", "zoom_user_1001"
   * @param {string} params.participantId - Canonical participant ID
   * @param {string} [params.displayName]
   * @param {number} [params.confidence=1.0]
   * @param {string} [params.source='platform_native'] - 'google_meet_csrc' | 'zoom_user_id' | 'teams_participant' | 'platform_transcript' | 'pyannote' | 'manual'
   * @param {string} [params.createdAt]
   * @param {string} [params.updatedAt]
   */
  constructor(params = {}) {
    this.id = params.id || `map_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    this.meetingId = params.meetingId;
    this.speakerId = params.speakerId;
    this.participantId = params.participantId;
    this.displayName = params.displayName || null;
    this.confidence = typeof params.confidence === 'number' ? params.confidence : 1.0;
    this.source = params.source || 'platform_native';
    this.createdAt = params.createdAt || new Date().toISOString();
    this.updatedAt = params.updatedAt || new Date().toISOString();
  }

  update(participantId, displayName, source = 'manual', confidence = 1.0) {
    this.participantId = participantId;
    if (displayName) this.displayName = displayName;
    this.source = source;
    this.confidence = confidence;
    this.updatedAt = new Date().toISOString();
  }

  toJSON() {
    return {
      id: this.id,
      meetingId: this.meetingId,
      speakerId: this.speakerId,
      participantId: this.participantId,
      displayName: this.displayName,
      confidence: this.confidence,
      source: this.source,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }
}

export default SpeakerMapping;
