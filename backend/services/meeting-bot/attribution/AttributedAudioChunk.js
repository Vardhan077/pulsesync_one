/**
 * AttributedAudioChunk.js
 * 
 * Represents an audio buffer stamped with platform-native participant attribution,
 * timing, and media codec specifications.
 */

export class AttributedAudioChunk {
  /**
   * @param {Object} params
   * @param {string} params.meetingId
   * @param {string} params.participantId - Canonical participant ID
   * @param {string} [params.speakerId] - Speaker ID or SSRC/CSRC reference
   * @param {string} [params.displayName] - Speaker display name
   * @param {Buffer|Uint8Array} params.audio - Raw audio bytes
   * @param {number} [params.timestamp] - Unix or relative timestamp in milliseconds
   * @param {number} [params.durationMs] - Duration of the chunk in milliseconds
   * @param {number} [params.sampleRate=16000] - Sample rate in Hz (e.g. 16000, 48000)
   * @param {number} [params.channels=1] - 1 for mono, 2 for stereo
   * @param {string} [params.codec='pcm_16le'] - 'pcm_16le', 'opus', 'wav'
   * @param {string} [params.source='platform_native'] - 'zoom_rtms' | 'meet_csrc' | 'teams_stream' | 'browser_tab'
   * @param {Object} [params.metadata={}]
   */
  constructor(params = {}) {
    this.meetingId = params.meetingId;
    this.participantId = params.participantId;
    this.speakerId = params.speakerId || params.participantId;
    this.displayName = params.displayName || 'Unknown Speaker';
    this.audio = params.audio || Buffer.alloc(0);
    this.timestamp = typeof params.timestamp === 'number' ? params.timestamp : Date.now();
    this.durationMs = typeof params.durationMs === 'number' ? params.durationMs : 0;
    this.sampleRate = params.sampleRate || 16000;
    this.channels = params.channels || 1;
    this.codec = params.codec || 'pcm_16le';
    this.source = params.source || 'platform_native';
    this.metadata = params.metadata || {};
  }

  toJSON() {
    return {
      meetingId: this.meetingId,
      participantId: this.participantId,
      speakerId: this.speakerId,
      displayName: this.displayName,
      byteLength: this.audio ? this.audio.length : 0,
      timestamp: this.timestamp,
      durationMs: this.durationMs,
      sampleRate: this.sampleRate,
      channels: this.channels,
      codec: this.codec,
      source: this.source,
      metadata: this.metadata
    };
  }
}

export default AttributedAudioChunk;
