/**
 * ConversationCapture.js
 * Normalized conversation capture abstraction shared across:
 * - Chrome Extension (browser capture)
 * - Google Meet Bot
 * - Zoom Bot
 * - Microsoft Teams Bot
 */

export class ConversationCapture {
  /**
   * @param {Object} params
   * @param {'chrome_extension' | 'google_meet_bot' | 'zoom_bot' | 'teams_bot' | 'upload'} params.source
   * @param {'google_meet' | 'zoom' | 'microsoft_teams' | 'browser' | 'other'} params.provider
   * @param {'realtime' | 'post_meeting_artifact'} [params.mode='realtime']
   * @param {string} [params.meetingId]
   * @param {string} [params.externalMeetingId]
   * @param {string} params.title
   * @param {string} [params.meetingUrl]
   * @param {string} [params.startedAt]
   * @param {string} [params.endedAt]
   * @param {Array<{ id?: string, name: string, role?: string, email?: string, isBot?: boolean }>} [params.participants]
   * @param {{ type: 'stream' | 'file', path: string, mimeType?: string, durationSeconds?: number, sizeBytes?: number }} params.mediaSource
   * @param {'granted' | 'pending' | 'required' | 'expired' | 'rejected' | 'unknown'} [params.consentState='granted']
   * @param {Record<string, unknown>} [params.metadata]
   */
  constructor({
    source,
    provider,
    mode = 'realtime',
    meetingId = null,
    externalMeetingId = null,
    title,
    meetingUrl = null,
    startedAt = new Date().toISOString(),
    endedAt = null,
    participants = [],
    mediaSource,
    consentState = 'granted',
    metadata = {},
  }) {
    if (!source) throw new Error('ConversationCapture requires a valid source');
    if (!title) throw new Error('ConversationCapture requires a title');
    if (!mediaSource || !mediaSource.path) throw new Error('ConversationCapture requires a valid mediaSource');

    this.source = source;
    this.provider = provider;
    this.mode = mode;
    this.meetingId = meetingId;
    this.externalMeetingId = externalMeetingId;
    this.title = title;
    this.meetingUrl = meetingUrl;
    this.startedAt = startedAt;
    this.endedAt = endedAt;
    this.participants = participants;
    this.mediaSource = mediaSource;
    this.consentState = consentState;
    this.metadata = metadata;
  }

  toJSON() {
    return {
      source: this.source,
      provider: this.provider,
      mode: this.mode,
      meetingId: this.meetingId,
      externalMeetingId: this.externalMeetingId,
      title: this.title,
      meetingUrl: this.meetingUrl,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      participants: this.participants,
      mediaSource: this.mediaSource,
      consentState: this.consentState,
      metadata: this.metadata,
    };
  }
}
