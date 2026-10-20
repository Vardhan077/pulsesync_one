/**
 * MeetingProvider.js
 * Common abstract interface for all meeting platforms (Google Meet, Zoom, Microsoft Teams).
 * Platform-specific logic lives ONLY within subclasses of this interface.
 */

export class MeetingProvider {
  constructor(name, label) {
    if (new.target === MeetingProvider) {
      throw new TypeError('Cannot construct MeetingProvider abstract instances directly.');
    }
    this.name = name;
    this.label = label;
  }

  /**
   * Return the canonical unique provider key (e.g., 'google_meet', 'zoom', 'microsoft_teams')
   * @returns {string}
   */
  getProviderName() {
    return this.name;
  }

  /**
   * Return human-readable label
   * @returns {string}
   */
  getLabel() {
    return this.label;
  }

  /**
   * Validate if a meeting URL matches this provider's syntax and domain.
   * @param {string} url
   * @returns {Promise<boolean> | boolean}
   */
  validateMeetingUrl(url) {
    throw new Error('validateMeetingUrl must be implemented by provider');
  }

  /**
   * Extract meeting metadata (ID, passcode, space code) from URL.
   * @param {string} url
   * @returns {{ meetingId?: string, passcode?: string, rawUrl: string, valid: boolean }}
   */
  extractMeetingMetadata(url) {
    throw new Error('extractMeetingMetadata must be implemented by provider');
  }

  /**
   * Introspect current provider readiness, credentials, and supported modes.
   * Does NOT simulate real-time bot capability if external prerequisites are missing.
   * @returns {Promise<{
   *   provider: string,
   *   label: string,
   *   supportedModes: Array<'realtime' | 'post_meeting_artifact'>,
   *   status: 'ready' | 'mock' | 'requires_auth' | 'developer_preview' | 'requires_admin_consent' | 'not_connected',
   *   message: string,
   *   authType: string,
   *   docsUrl?: string,
   *   features: {
   *     realtimeBot: boolean,
   *     artifactImport: boolean,
   *     diarizationMetadata: boolean,
   *     watermarkedSupport: boolean
   *   }
   * }>}
   */
  async getCapabilities() {
    throw new Error('getCapabilities must be implemented by provider');
  }

  /**
   * Prepare/schedule a bot job before meeting execution.
   * @param {Object} job
   * @returns {Promise<void>}
   */
  async scheduleBot(job) {
    throw new Error('scheduleBot must be implemented by provider');
  }

  /**
   * Connect and join the bot participant into the meeting.
   * @param {Object} job
   * @param {Object} options
   * @returns {Promise<{ joined: boolean, participantId?: string, waitingRoom?: boolean }>}
   */
  async joinMeeting(job, options = {}) {
    throw new Error('joinMeeting must be implemented by provider');
  }

  /**
   * Disconnect and remove the bot participant from the meeting.
   * @param {Object} job
   * @returns {Promise<void>}
   */
  async leaveMeeting(job) {
    throw new Error('leaveMeeting must be implemented by provider');
  }

  /**
   * Begin capturing meeting media (audio stream or recording artifact).
   * @param {Object} job
   * @param {Object} options
   * @returns {Promise<{ stream?: unknown, audioPath?: string, format: string }>}
   */
  async captureMedia(job, options = {}) {
    throw new Error('captureMedia must be implemented by provider');
  }

  /**
   * Inspect live status of meeting and bot participant.
   * @param {Object} job
   * @returns {Promise<{ status: string, participantCount?: number, isMuted?: boolean }>}
   */
  async getMeetingStatus(job) {
    throw new Error('getMeetingStatus must be implemented by provider');
  }

  /**
   * Clean up resources and trigger normalization when meeting ends.
   * @param {Object} job
   * @returns {Promise<void>}
   */
  async handleMeetingEnded(job) {
    throw new Error('handleMeetingEnded must be implemented by provider');
  }
}
