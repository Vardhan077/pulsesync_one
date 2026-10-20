/**
 * MicrosoftTeamsProvider.js
 * Platform adapter for Microsoft Teams meetings.
 *
 * Current Official Microsoft Teams API Realities:
 * 1. Real-Time Media Bot: Microsoft Graph Communications Calling and Media Platform.
 *    Requires Azure Bot Framework registration, Microsoft Entra ID (Azure AD),
 *    application-hosted media service, and tenant admin consent with:
 *    - Calls.AccessMedia.All
 *    - Calls.JoinGroupCall.All
 * 2. Active Speaker Events: Microsoft Graph Calling emits participant active-speaker
 *    notifications (e.g., speaker_started, speaker_stopped) linked to participant object IDs.
 * 3. Post-Meeting Artifact Processing: Microsoft Graph Online Meeting API
 *    (/communications/onlineMeetings/{meetingId}/transcripts and /recordings).
 */

import { MeetingProvider } from './MeetingProvider.js';
import { AttributedAudioChunk } from '../attribution/AttributedAudioChunk.js';
import { AttributedTranscriptSegment } from '../attribution/AttributedTranscriptSegment.js';

export class MicrosoftTeamsProvider extends MeetingProvider {
  constructor(config = {}) {
    super('microsoft_teams', 'Microsoft Teams');
    this.config = {
      clientId: process.env.TEAMS_CLIENT_ID || config.clientId,
      clientSecret: process.env.TEAMS_CLIENT_SECRET || config.clientSecret,
      tenantId: process.env.TEAMS_TENANT_ID || config.tenantId,
      adminConsentGranted: process.env.TEAMS_ADMIN_CONSENT_GRANTED === 'true' || config.adminConsentGranted,
      mode: process.env.MEETING_BOT_MODE || config.mode || 'mock',
      ...config,
    };
    this.activeSpeakerMap = new Map(); // participantId -> boolean
  }

  /**
   * Validate Microsoft Teams meeting URL.
   */
  validateMeetingUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const cleanUrl = url.trim();
    const teamsPattern = /^https:\/\/(teams\.microsoft\.com\/l\/meetup-join|teams\.live\.com\/meet)\/[^\s]+$/i;
    return teamsPattern.test(cleanUrl);
  }

  /**
   * Extract meeting metadata from Teams URL.
   */
  extractMeetingMetadata(url) {
    if (!url || typeof url !== 'string') {
      return { valid: false, rawUrl: url };
    }
    const cleanUrl = url.trim();
    const valid = this.validateMeetingUrl(cleanUrl);
    let meetingId = null;

    try {
      const parsed = new URL(cleanUrl);
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      meetingId = pathParts[pathParts.length - 1] || null;
      if (parsed.searchParams.has('context')) {
        const contextStr = decodeURIComponent(parsed.searchParams.get('context'));
        const parsedContext = JSON.parse(contextStr);
        if (parsedContext?.Tid) {
          meetingId = `${parsedContext.Tid}_${meetingId}`;
        }
      }
    } catch {
      // ignore URL parse failure
    }

    return {
      valid,
      meetingId,
      rawUrl: cleanUrl,
      provider: this.name,
    };
  }

  /**
   * Check Microsoft Teams capabilities, Azure Entra ID status, and tenant admin consent.
   */
  async getCapabilities() {
    const isMock = this.config.mode === 'mock';
    const hasEntraApp = Boolean(this.config.clientId && this.config.clientSecret && this.config.tenantId);
    const hasConsent = Boolean(this.config.adminConsentGranted);

    let status = 'requires_auth';
    let message = 'Microsoft Entra ID (Azure AD) application not configured. Configure TEAMS_CLIENT_ID, TEAMS_CLIENT_SECRET, and TEAMS_TENANT_ID.';

    if (isMock) {
      status = 'mock';
      message = 'Running in Development / Mock Mode. Microsoft Teams calling bot and active speaker events simulated for testing.';
    } else if (hasEntraApp && hasConsent) {
      status = 'ready';
      message = 'Microsoft Graph Communications Calling and Media API active with tenant admin consent.';
    } else if (hasEntraApp && !hasConsent) {
      status = 'requires_admin_consent';
      message = 'Azure Entra ID app configured, but requires Microsoft 365 Tenant Admin Consent for Calls.AccessMedia.All and OnlineMeetings.Read.All.';
    }

    return {
      provider: this.name,
      label: this.label,
      supportedModes: ['realtime', 'post_meeting_artifact'],
      status,
      message,
      authType: 'Microsoft Entra ID (Azure AD) / Microsoft Graph App Consent',
      docsUrl: 'https://learn.microsoft.com/en-us/graph/cloud-communication-concept-overview',
      features: {
        realtimeBot: isMock || (hasEntraApp && hasConsent),
        artifactImport: isMock || hasEntraApp,
        diarizationMetadata: true,
        watermarkedSupport: false,
        platformAttribution: true,
        activeSpeakerEvents: true,
        rosterSync: true,
      },
    };
  }

  /**
   * Process Graph Calling API Active Speaker Notification
   * @param {Object} event
   * @param {string} event.participantId - Azure AD object ID / Teams participant ID
   * @param {string} event.displayName
   * @param {boolean} event.isSpeaking
   * @param {import('../attribution/ParticipantRegistry.js').ParticipantRegistry} registry
   */
  handleActiveSpeakerEvent(event, registry) {
    if (!event || !event.participantId) return;

    const teamsUserId = String(event.participantId);
    let participant = null;

    if (registry) {
      participant = registry.resolveTeamsUser(teamsUserId);
      if (!participant && event.displayName) {
        participant = registry.registerParticipant({
          platform: 'teams',
          platformParticipantId: teamsUserId,
          displayName: event.displayName,
          identitySource: 'platform_native',
          confidence: 0.98,
        });
      }

      if (participant) {
        registry.setActiveSpeaker(participant.id, Boolean(event.isSpeaking));
      }
    }

    this.activeSpeakerMap.set(teamsUserId, Boolean(event.isSpeaking));
    return participant;
  }

  async scheduleBot(job) {
    const meta = this.extractMeetingMetadata(job.meeting_url);
    if (!meta.valid) {
      throw new Error(`Invalid Microsoft Teams meeting URL: ${job.meeting_url}`);
    }
  }

  async joinMeeting(job, options = {}) {
    const isMock = this.config.mode === 'mock';
    if (!isMock && (!this.config.clientId || !this.config.adminConsentGranted)) {
      throw new Error('AUTH_FAILED: Microsoft Teams Calling Bot requires Azure Entra ID app credentials and Tenant Admin Consent.');
    }

    return {
      joined: true,
      participantId: `teams-bot-${Date.now()}`,
      waitingRoom: false,
      botDisplayName: job.bot_participant_name || 'PulseSync Meeting Assistant',
    };
  }

  async leaveMeeting(job) {
    this.activeSpeakerMap.clear();
    return { left: true, timestamp: new Date().toISOString() };
  }

  async captureMedia(job, options = {}) {
    return {
      mode: job.mode || 'realtime',
      format: 'wav',
      channels: 1,
      sampleRate: 16000,
    };
  }

  async getMeetingStatus(job) {
    return {
      status: 'active',
      isMuted: true,
      participantCount: 5,
      activeSpeakers: Array.from(this.activeSpeakerMap.entries())
        .filter(([, speaking]) => speaking)
        .map(([id]) => id),
    };
  }

  async handleMeetingEnded(job) {
    this.activeSpeakerMap.clear();
    return { processed: true, endedAt: new Date().toISOString() };
  }
}
