/**
 * JobStateMachine.js
 * State machine and lifecycle transitions for PulseSync Meeting Bot jobs.
 */

export const BotJobState = Object.freeze({
  DRAFT: 'DRAFT',
  SCHEDULED: 'SCHEDULED',
  WAITING_FOR_MEETING: 'WAITING_FOR_MEETING',
  JOINING: 'JOINING',
  WAITING_ROOM: 'WAITING_ROOM',
  JOINED: 'JOINED',
  CAPTURING: 'CAPTURING',
  PROCESSING: 'PROCESSING',
  TRANSCRIBING: 'TRANSCRIBING',
  ATTRIBUTING_SPEAKERS: 'ATTRIBUTING_SPEAKERS',
  DIARIZING: 'DIARIZING',
  EXTRACTING: 'EXTRACTING',
  READY_FOR_REVIEW: 'READY_FOR_REVIEW',
  SYNCED: 'SYNCED',

  // Failure / Terminal states
  JOIN_FAILED: 'JOIN_FAILED',
  AUTH_FAILED: 'AUTH_FAILED',
  CONSENT_FAILED: 'CONSENT_FAILED',
  MEDIA_FAILED: 'MEDIA_FAILED',
  TRANSCRIPTION_FAILED: 'TRANSCRIPTION_FAILED',
  ATTRIBUTION_FAILED: 'ATTRIBUTION_FAILED',
  DIARIZATION_FAILED: 'DIARIZATION_FAILED',
  EXTRACTION_FAILED: 'EXTRACTION_FAILED',
  CRM_SYNC_FAILED: 'CRM_SYNC_FAILED',
  PROCESSING_FAILED: 'PROCESSING_FAILED',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  CANCELLED: 'CANCELLED',
});

export const BotStateMeta = Object.freeze({
  [BotJobState.DRAFT]: {
    label: 'Draft',
    description: 'Bot job is configured but not yet scheduled.',
    badgeClass: 'bg-slate-100 text-slate-700',
    isTerminal: false,
    isActive: false,
  },
  [BotJobState.SCHEDULED]: {
    label: 'Scheduled',
    description: 'Meeting bot is queued and awaiting scheduled start time.',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
    isTerminal: false,
    isActive: false,
  },
  [BotJobState.WAITING_FOR_MEETING]: {
    label: 'Waiting for Meeting',
    description: 'Bot is online and waiting for the meeting to start.',
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
    isTerminal: false,
    isActive: true,
  },
  [BotJobState.JOINING]: {
    label: 'Joining',
    description: 'PulseSync bot is connecting to the meeting.',
    badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    isTerminal: false,
    isActive: true,
  },
  [BotJobState.WAITING_ROOM]: {
    label: 'Waiting Room',
    description: 'Bot is in the waiting room waiting for the host to admit it.',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-300',
    isTerminal: false,
    isActive: true,
  },
  [BotJobState.JOINED]: {
    label: 'Joined',
    description: 'Bot is active in the meeting as a participant.',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    isTerminal: false,
    isActive: true,
  },
  [BotJobState.CAPTURING]: {
    label: 'Capturing',
    description: 'PulseSync is capturing and streaming meeting audio.',
    badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    isTerminal: false,
    isActive: true,
  },
  [BotJobState.PROCESSING]: {
    label: 'Processing',
    description: 'The meeting has concluded. Normalizing conversation audio.',
    badgeClass: 'bg-purple-50 text-purple-700 border-purple-200',
    isTerminal: false,
    isActive: true,
  },
  [BotJobState.TRANSCRIBING]: {
    label: 'Transcribing',
    description: 'Running high-precision speech-to-text transcription.',
    badgeClass: 'bg-purple-50 text-purple-700 border-purple-200',
    isTerminal: false,
    isActive: true,
  },
  [BotJobState.ATTRIBUTING_SPEAKERS]: {
    label: 'Attributing Speakers',
    description: 'Resolving platform-native speaker identity, roles, and source provenance.',
    badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    isTerminal: false,
    isActive: true,
  },
  [BotJobState.DIARIZING]: {
    label: 'Diarizing',
    description: 'Attributing speaker turns and conversational roles.',
    badgeClass: 'bg-purple-50 text-purple-700 border-purple-200',
    isTerminal: false,
    isActive: true,
  },
  [BotJobState.EXTRACTING]: {
    label: 'Extracting Insights',
    description: 'Synthesizing dynamic schema fields, buyer goals, and risks.',
    badgeClass: 'bg-purple-100 text-purple-800 border-purple-300',
    isTerminal: false,
    isActive: true,
  },
  [BotJobState.READY_FOR_REVIEW]: {
    label: 'Ready for Review',
    description: 'Transcript and AI insights are ready for verification.',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    isTerminal: true,
    isActive: false,
  },
  [BotJobState.SYNCED]: {
    label: 'Synced',
    description: 'Conversation intelligence verified and pushed to CRM.',
    badgeClass: 'bg-slate-100 text-slate-800 border-slate-300',
    isTerminal: true,
    isActive: false,
  },
  [BotJobState.JOIN_FAILED]: {
    label: 'Join Failed',
    description: 'Could not connect to meeting. Check access permissions or meeting URL.',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
    isTerminal: true,
    isActive: false,
  },
  [BotJobState.AUTH_FAILED]: {
    label: 'Authentication Failed',
    description: 'Unable to authenticate with meeting provider. Verify credentials or OAuth status.',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
    isTerminal: true,
    isActive: false,
  },
  [BotJobState.CONSENT_FAILED]: {
    label: 'Consent Required',
    description: 'Participant consent was rejected or missing.',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
    isTerminal: true,
    isActive: false,
  },
  [BotJobState.MEDIA_FAILED]: {
    label: 'Media Failed',
    description: 'Joined meeting but could not access or capture meeting audio.',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
    isTerminal: true,
    isActive: false,
  },
  [BotJobState.TRANSCRIPTION_FAILED]: {
    label: 'Transcription Failed',
    description: 'Speech-to-text service encountered an error during transcription.',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
    isTerminal: true,
    isActive: false,
  },
  [BotJobState.ATTRIBUTION_FAILED]: {
    label: 'Attribution Failed',
    description: 'Could not attribute participant identities to audio streams.',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
    isTerminal: true,
    isActive: false,
  },
  [BotJobState.DIARIZATION_FAILED]: {
    label: 'Diarization Failed',
    description: 'Acoustic speaker clustering fallback failed.',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
    isTerminal: true,
    isActive: false,
  },
  [BotJobState.EXTRACTION_FAILED]: {
    label: 'Extraction Failed',
    description: 'AI intelligence and schema extraction failed.',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
    isTerminal: true,
    isActive: false,
  },
  [BotJobState.CRM_SYNC_FAILED]: {
    label: 'CRM Sync Failed',
    description: 'Could not synchronize conversation intelligence with CRM.',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
    isTerminal: true,
    isActive: false,
  },
  [BotJobState.PROCESSING_FAILED]: {
    label: 'Processing Failed',
    description: 'Meeting captured successfully, but AI extraction pipeline encountered an error.',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
    isTerminal: true,
    isActive: false,
  },
  [BotJobState.PROVIDER_ERROR]: {
    label: 'Provider Error',
    description: 'Meeting platform returned an unexpected error or restricted API access.',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
    isTerminal: true,
    isActive: false,
  },
  [BotJobState.CANCELLED]: {
    label: 'Cancelled',
    description: 'Meeting bot job was cancelled by user.',
    badgeClass: 'bg-slate-100 text-slate-500 border-slate-200',
    isTerminal: true,
    isActive: false,
  },
});

const VALID_TRANSITIONS = {
  [BotJobState.DRAFT]: [BotJobState.SCHEDULED, BotJobState.CANCELLED],
  [BotJobState.SCHEDULED]: [
    BotJobState.WAITING_FOR_MEETING,
    BotJobState.JOINING,
    BotJobState.CANCELLED,
    BotJobState.AUTH_FAILED,
    BotJobState.CONSENT_FAILED,
  ],
  [BotJobState.WAITING_FOR_MEETING]: [
    BotJobState.JOINING,
    BotJobState.CANCELLED,
    BotJobState.JOIN_FAILED,
    BotJobState.AUTH_FAILED,
  ],
  [BotJobState.JOINING]: [
    BotJobState.WAITING_ROOM,
    BotJobState.JOINED,
    BotJobState.JOIN_FAILED,
    BotJobState.AUTH_FAILED,
    BotJobState.PROVIDER_ERROR,
    BotJobState.CANCELLED,
  ],
  [BotJobState.WAITING_ROOM]: [
    BotJobState.JOINED,
    BotJobState.JOIN_FAILED,
    BotJobState.CANCELLED,
  ],
  [BotJobState.JOINED]: [
    BotJobState.CAPTURING,
    BotJobState.MEDIA_FAILED,
    BotJobState.PROCESSING, // if ended early
    BotJobState.CANCELLED,
  ],
  [BotJobState.CAPTURING]: [
    BotJobState.PROCESSING,
    BotJobState.MEDIA_FAILED,
    BotJobState.CANCELLED,
  ],
  [BotJobState.PROCESSING]: [
    BotJobState.TRANSCRIBING,
    BotJobState.ATTRIBUTING_SPEAKERS,
    BotJobState.PROCESSING_FAILED,
  ],
  [BotJobState.TRANSCRIBING]: [
    BotJobState.ATTRIBUTING_SPEAKERS,
    BotJobState.DIARIZING,
    BotJobState.TRANSCRIPTION_FAILED,
    BotJobState.PROCESSING_FAILED,
  ],
  [BotJobState.ATTRIBUTING_SPEAKERS]: [
    BotJobState.DIARIZING,
    BotJobState.EXTRACTING,
    BotJobState.ATTRIBUTION_FAILED,
    BotJobState.PROCESSING_FAILED,
  ],
  [BotJobState.DIARIZING]: [
    BotJobState.EXTRACTING,
    BotJobState.DIARIZATION_FAILED,
    BotJobState.PROCESSING_FAILED,
  ],
  [BotJobState.EXTRACTING]: [
    BotJobState.READY_FOR_REVIEW,
    BotJobState.EXTRACTION_FAILED,
    BotJobState.PROCESSING_FAILED,
  ],
  [BotJobState.READY_FOR_REVIEW]: [
    BotJobState.SYNCED,
    BotJobState.CRM_SYNC_FAILED,
  ],
  [BotJobState.SYNCED]: [],

  // Terminal retry routes
  [BotJobState.JOIN_FAILED]: [BotJobState.SCHEDULED, BotJobState.JOINING],
  [BotJobState.AUTH_FAILED]: [BotJobState.SCHEDULED],
  [BotJobState.CONSENT_FAILED]: [BotJobState.SCHEDULED],
  [BotJobState.MEDIA_FAILED]: [BotJobState.SCHEDULED, BotJobState.PROCESSING],
  [BotJobState.TRANSCRIPTION_FAILED]: [BotJobState.TRANSCRIBING, BotJobState.PROCESSING],
  [BotJobState.PROCESSING_FAILED]: [BotJobState.PROCESSING, BotJobState.EXTRACTING],
  [BotJobState.PROVIDER_ERROR]: [BotJobState.SCHEDULED],
  [BotJobState.CANCELLED]: [BotJobState.SCHEDULED],
};

export class JobStateMachine {
  static canTransition(fromState, toState) {
    const fromUpper = String(fromState || '').toUpperCase();
    const toUpper = String(toState || '').toUpperCase();
    const allowed = VALID_TRANSITIONS[fromUpper] || [];
    return allowed.includes(toUpper);
  }

  static validateTransition(fromState, toState) {
    const fromUpper = String(fromState || '').toUpperCase();
    const toUpper = String(toState || '').toUpperCase();
    if (!this.canTransition(fromUpper, toUpper)) {
      throw new Error(`Invalid bot job transition from "${fromUpper}" to "${toUpper}"`);
    }
    return true;
  }

  static getMeta(state) {
    const upper = String(state || '').toUpperCase();
    return BotStateMeta[upper] || {
      label: upper,
      description: 'Meeting bot status',
      badgeClass: 'bg-slate-100 text-slate-700',
      isTerminal: false,
      isActive: false,
    };
  }
}
