/**
 * ParticipantIdentity.js
 * 
 * Canonical normalized participant identity model across all meeting platforms
 * (Google Meet, Zoom, Microsoft Teams, and Chrome Extension).
 */

export class ParticipantIdentity {
  /**
   * @param {Object} data
   * @param {string} [data.id] - Canonical ID (e.g. "part_meet_12345" or UUID)
   * @param {string} data.meetingId - Meeting or Job ID
   * @param {string} [data.platform='generic'] - 'google_meet' | 'zoom' | 'teams' | 'chrome_extension' | 'generic'
   * @param {string} [data.platformParticipantId] - Native platform participant identifier
   * @param {string} [data.displayName='Unknown Participant'] - Participant's displayed name
   * @param {string} [data.email] - Participant email address if exposed by platform
   * @param {string} [data.role='unknown'] - Normalized role ('sales_rep' | 'buyer' | 'prospect' | 'customer' | 'manager' | 'unknown')
   * @param {string} [data.organization] - Company / organization name
   * @param {boolean} [data.isHost=false] - Whether participant is the meeting host / organizer
   * @param {boolean} [data.isBot=false] - Whether this participant is the PulseSync bot
   * @param {string|Date} [data.joinedAt] - Time joined
   * @param {string|Date} [data.leftAt] - Time left
   * @param {string} [data.identitySource='platform_native'] - Provenance of identity
   * @param {number} [data.confidence=1.0] - Attribution confidence score (0.0 to 1.0)
   * @param {Object} [data.metadata={}] - Platform-specific extra details (CSRCs, SSRCs, etc.)
   */
  constructor(data = {}) {
    this.id = data.id || `part_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    this.meetingId = data.meetingId;
    this.platform = data.platform || 'generic';
    this.platformParticipantId = String(data.platformParticipantId || this.id);
    this.displayName = data.displayName || 'Unknown Participant';
    this.email = data.email || null;
    this.role = data.role || 'unknown';
    this.organization = data.organization || null;
    this.isHost = Boolean(data.isHost);
    this.isBot = Boolean(data.isBot);
    this.joinedAt = data.joinedAt ? new Date(data.joinedAt).toISOString() : new Date().toISOString();
    this.leftAt = data.leftAt ? new Date(data.leftAt).toISOString() : null;
    this.identitySource = data.identitySource || 'platform_native';
    this.confidence = typeof data.confidence === 'number' ? data.confidence : 1.0;
    this.metadata = data.metadata || {};
  }

  markLeft(timestamp = new Date().toISOString()) {
    this.leftAt = timestamp;
  }

  updateMetadata(key, value) {
    this.metadata[key] = value;
  }

  toJSON() {
    return {
      id: this.id,
      meetingId: this.meetingId,
      platform: this.platform,
      platformParticipantId: this.platformParticipantId,
      displayName: this.displayName,
      email: this.email,
      role: this.role,
      organization: this.organization,
      isHost: this.isHost,
      isBot: this.isBot,
      joinedAt: this.joinedAt,
      leftAt: this.leftAt,
      identitySource: this.identitySource,
      confidence: this.confidence,
      metadata: this.metadata
    };
  }
}

export default ParticipantIdentity;
