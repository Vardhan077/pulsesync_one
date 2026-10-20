/**
 * ParticipantRegistry.js
 * 
 * Central session registry tracking participants and multi-platform identifier mappings
 * (Google Meet CSRCs, Zoom user IDs, Microsoft Teams AAD / speaker IDs).
 */

import { EventEmitter } from 'events';
import { ParticipantIdentity } from './ParticipantIdentity.js';
import { SpeakerMapping } from './SpeakerMapping.js';

export class ParticipantRegistry extends EventEmitter {
  constructor(meetingId) {
    super();
    this.meetingId = meetingId;
    this.participants = new Map(); // participantId -> ParticipantIdentity
    this.csrcToParticipant = new Map(); // csrc -> participantId
    this.zoomUserToParticipant = new Map(); // zoomUserId -> participantId
    this.teamsUserToParticipant = new Map(); // teamsUserId -> participantId
    this.speakerMappings = new Map(); // speakerId -> SpeakerMapping
    this.activeSpeakerIds = new Set();
  }

  /**
   * Register or update a participant in the meeting
   * @param {Object|ParticipantIdentity} identityData
   * @returns {ParticipantIdentity}
   */
  registerParticipant(identityData) {
    const identity = identityData instanceof ParticipantIdentity
      ? identityData
      : new ParticipantIdentity({ ...identityData, meetingId: this.meetingId });

    const existing = this.participants.get(identity.id);
    this.participants.set(identity.id, identity);

    // Platform-specific automatic key indexing
    if (identity.platform === 'google_meet' && identity.metadata?.csrc) {
      this.mapCsrc(identity.metadata.csrc, identity.id);
    } else if (identity.platform === 'zoom') {
      this.mapZoomUser(identity.platformParticipantId, identity.id);
    } else if (identity.platform === 'teams') {
      this.mapTeamsUser(identity.platformParticipantId, identity.id);
    }

    if (!existing) {
      this.emit('participant_joined', identity);
    } else {
      this.emit('participant_updated', identity);
    }

    return identity;
  }

  /**
   * Mark participant as left
   * @param {string} participantId
   */
  removeParticipant(participantId) {
    const participant = this.participants.get(participantId);
    if (participant) {
      participant.markLeft();
      this.activeSpeakerIds.delete(participantId);
      this.emit('participant_left', participant);
    }
  }

  /**
   * Map Google Meet CSRC (Contributing Source) to participant ID
   */
  mapCsrc(csrc, participantId) {
    const key = String(csrc);
    this.csrcToParticipant.set(key, participantId);
    this.recordSpeakerMapping(`csrc_${key}`, participantId, 'google_meet_csrc', 0.99);
  }

  /**
   * Resolve participant from CSRC
   */
  resolveCsrc(csrc) {
    const participantId = this.csrcToParticipant.get(String(csrc));
    return participantId ? this.participants.get(participantId) : null;
  }

  /**
   * Map Zoom user_id to participant ID
   */
  mapZoomUser(zoomUserId, participantId) {
    const key = String(zoomUserId);
    this.zoomUserToParticipant.set(key, participantId);
    this.recordSpeakerMapping(`zoom_${key}`, participantId, 'zoom_user_id', 1.0);
  }

  /**
   * Resolve participant from Zoom user_id
   */
  resolveZoomUser(zoomUserId) {
    const participantId = this.zoomUserToParticipant.get(String(zoomUserId));
    return participantId ? this.participants.get(participantId) : null;
  }

  /**
   * Map Teams user ID to participant ID
   */
  mapTeamsUser(teamsUserId, participantId) {
    const key = String(teamsUserId);
    this.teamsUserToParticipant.set(key, participantId);
    this.recordSpeakerMapping(`teams_${key}`, participantId, 'teams_participant', 0.98);
  }

  /**
   * Resolve participant from Teams user ID
   */
  resolveTeamsUser(teamsUserId) {
    const participantId = this.teamsUserToParticipant.get(String(teamsUserId));
    return participantId ? this.participants.get(participantId) : null;
  }

  /**
   * Record or update a speaker mapping
   */
  recordSpeakerMapping(speakerId, participantId, source = 'platform_native', confidence = 1.0) {
    const participant = this.participants.get(participantId);
    const displayName = participant ? participant.displayName : null;

    let mapping = this.speakerMappings.get(speakerId);
    if (mapping) {
      mapping.update(participantId, displayName, source, confidence);
    } else {
      mapping = new SpeakerMapping({
        meetingId: this.meetingId,
        speakerId,
        participantId,
        displayName,
        source,
        confidence
      });
      this.speakerMappings.set(speakerId, mapping);
    }

    this.emit('speaker_mapped', mapping);
    return mapping;
  }

  getSpeakerMapping(speakerId) {
    return this.speakerMappings.get(speakerId);
  }

  getAllSpeakerMappings() {
    return Array.from(this.speakerMappings.values());
  }

  getParticipant(participantId) {
    return this.participants.get(participantId);
  }

  findParticipantByName(name) {
    if (!name) return null;
    const clean = name.trim().toLowerCase();
    for (const p of this.participants.values()) {
      if (p.displayName.toLowerCase() === clean) return p;
    }
    // Partial match
    for (const p of this.participants.values()) {
      if (p.displayName.toLowerCase().includes(clean) || clean.includes(p.displayName.toLowerCase())) {
        return p;
      }
    }
    return null;
  }

  findParticipantByEmail(email) {
    if (!email) return null;
    const clean = email.trim().toLowerCase();
    for (const p of this.participants.values()) {
      if (p.email && p.email.toLowerCase() === clean) return p;
    }
    return null;
  }

  getAllParticipants() {
    return Array.from(this.participants.values());
  }

  setActiveSpeaker(participantId, isActive = true) {
    if (isActive) {
      this.activeSpeakerIds.add(participantId);
      const participant = this.participants.get(participantId);
      if (participant) this.emit('speaker_started', participant);
    } else {
      this.activeSpeakerIds.delete(participantId);
      const participant = this.participants.get(participantId);
      if (participant) this.emit('speaker_stopped', participant);
    }
  }

  getActiveSpeakers() {
    return Array.from(this.activeSpeakerIds)
      .map(id => this.participants.get(id))
      .filter(Boolean);
  }

  toJSON() {
    return {
      meetingId: this.meetingId,
      participantCount: this.participants.size,
      participants: this.getAllParticipants().map(p => p.toJSON()),
      speakerMappings: this.getAllSpeakerMappings().map(m => m.toJSON()),
      activeSpeakers: Array.from(this.activeSpeakerIds)
    };
  }
}

export default ParticipantRegistry;
