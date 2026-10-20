/**
 * AttributedTranscriptSegment.js
 * 
 * Canonical transcript segment format preserving speaker identity,
 * attribution source provenance, confidence metrics, and prompt formatting.
 */

export class AttributedTranscriptSegment {
  /**
   * @param {Object} params
   * @param {string} [params.id]
   * @param {string} params.meetingId
   * @param {string} params.participantId
   * @param {string} [params.speakerId]
   * @param {string} params.displayName
   * @param {string} [params.role='unknown']
   * @param {string} [params.organization]
   * @param {number} params.startTime - Seconds into meeting (float)
   * @param {number} params.endTime - Seconds into meeting (float)
   * @param {string} params.text
   * @param {Array<Object>} [params.words=[]]
   * @param {number} [params.confidence=0.95]
   * @param {string} [params.attributionSource='platform_native'] - 'platform_native' | 'platform_transcript' | 'platform_metadata' | 'diarization' | 'manual'
   * @param {number} [params.attributionConfidence=1.0]
   * @param {string} [params.transcriptionSource='platform_native_transcript'] - 'platform_native_transcript' | 'whisper' | 'live_captions'
   * @param {Object} [params.metadata={}]
   */
  constructor(params = {}) {
    this.id = params.id || `seg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    this.meetingId = params.meetingId;
    this.participantId = params.participantId;
    this.speakerId = params.speakerId || params.participantId;
    this.displayName = params.displayName || 'Unknown Speaker';
    this.role = params.role || 'unknown';
    this.organization = params.organization || null;
    this.startTime = typeof params.startTime === 'number' ? params.startTime : 0.0;
    this.endTime = typeof params.endTime === 'number' ? params.endTime : this.startTime;
    this.text = (params.text || '').trim();
    this.words = params.words || [];
    this.confidence = typeof params.confidence === 'number' ? params.confidence : 0.95;
    this.attributionSource = params.attributionSource || 'platform_native';
    this.attributionConfidence = typeof params.attributionConfidence === 'number' ? params.attributionConfidence : 1.0;
    this.transcriptionSource = params.transcriptionSource || 'platform_native_transcript';
    this.metadata = params.metadata || {};
  }

  formatTimestamp() {
    const totalSeconds = Math.floor(this.startTime);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  /**
   * Format line for LLM ingestion with full context grounding
   * e.g., [seg_001] [01:23] Vardhan (Sales Rep, PulseSync): "Thanks for joining."
   */
  formatPromptLine() {
    const roleStr = this.role !== 'unknown' ? this.role.replace(/_/g, ' ') : '';
    const orgStr = this.organization ? this.organization : '';
    const descParts = [roleStr, orgStr].filter(Boolean);
    const identityTag = descParts.length > 0 ? ` (${descParts.join(', ')})` : '';
    
    return `[${this.id}] [${this.formatTimestamp()}] ${this.displayName}${identityTag}: "${this.text}"`;
  }

  toJSON() {
    return {
      id: this.id,
      meetingId: this.meetingId,
      participantId: this.participantId,
      speakerId: this.speakerId,
      displayName: this.displayName,
      role: this.role,
      organization: this.organization,
      startTime: this.startTime,
      endTime: this.endTime,
      text: this.text,
      words: this.words,
      confidence: this.confidence,
      attributionSource: this.attributionSource,
      attributionConfidence: this.attributionConfidence,
      transcriptionSource: this.transcriptionSource,
      metadata: this.metadata
    };
  }
}

export default AttributedTranscriptSegment;
