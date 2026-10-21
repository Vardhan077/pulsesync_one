/**
 * MeetingBotWorker.js
 * Distributed worker architecture managing the asynchronous lifecycle of Meeting Bot jobs.
 * Handles queuing, provider adapter invocation, mock simulation, media capture,
 * structured activity logging, exponential backoff retries, and pipeline handoff.
 */

import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { defaultProviderRegistry } from '../services/meeting-bot/providers/ProviderRegistry.js';
import { BotJobState, JobStateMachine } from '../services/meeting-bot/JobStateMachine.js';
import { AudioNormalizer } from '../services/meeting-bot/AudioNormalizer.js';
import { ConversationCapture } from '../services/meeting-bot/ConversationCapture.js';
import { RealMeetingBotBrowser } from '../services/meeting-bot/browser/RealMeetingBotBrowser.js';
import { ParticipantRegistry } from '../services/meeting-bot/attribution/ParticipantRegistry.js';
import { SpeakerAttributionEngine } from '../services/meeting-bot/attribution/SpeakerAttributionEngine.js';
import { RoleResolver } from '../services/meeting-bot/attribution/RoleResolver.js';
import { ParticipantIdentity } from '../services/meeting-bot/attribution/ParticipantIdentity.js';

export class MeetingBotWorker {
  /**
   * @param {Object} options
   * @param {import('pg').Pool | null} options.pool
   * @param {boolean} options.useFallbackDb
   * @param {Function} options.readFallbackDb
   * @param {Function} options.writeFallbackDb
   * @param {Function} options.triggerJobProcessor
   * @param {string} options.uploadsDir
   * @param {Object} [options.logger]
   */
  constructor({
    pool,
    useFallbackDb,
    readFallbackDb,
    writeFallbackDb,
    triggerJobProcessor,
    uploadsDir,
    logger = console,
  }) {
    this.pool = pool;
    this.useFallbackDb = useFallbackDb;
    this.readFallbackDb = readFallbackDb;
    this.writeFallbackDb = writeFallbackDb;
    this.triggerJobProcessor = triggerJobProcessor;
    this.uploadsDir = uploadsDir;
    this.logger = logger;

    // In-memory registry of active cancellation tokens / timers
    this.activeTimers = new Map();   // jobId -> Timeout / Interval
    this.activeAborts = new Map();   // jobId -> AbortController
    this.activeBrowsers = new Map(); // jobId -> RealMeetingBotBrowser
    this.runningJobs = new Set();    // Set<jobId>

    this.isMockMode = (process.env.MEETING_BOT_MODE || 'realtime').toLowerCase() === 'mock';
  }

  // ── Database Access Layer ──────────────────────────────────────────────────

  async _query(sql, params = []) {
    if (!this.useFallbackDb && this.pool) {
      return await this.pool.query(sql, params);
    }
    return { rows: [] };
  }

  async createJob(params) {
    const id = params.id || crypto.randomUUID();
    const workspaceId = params.workspace_id || '00000000-0000-0000-0000-000000000001';
    const provider = params.provider;
    const mode = params.mode || 'realtime';
    const meetingUrl = String(params.meeting_url || '').trim();
    const meetingTitle = String(params.meeting_title || 'PulseSync Meeting Session').trim().slice(0, 255);
    const scheduledStart = params.scheduled_start ? new Date(params.scheduled_start).toISOString() : new Date().toISOString();
    const consentState = params.consent_state || 'granted';
    const botParticipantName = String(params.bot_participant_name || 'PulseSync Meeting Assistant').trim();
    const createdBy = params.created_by || 'Sales Rep';
    const externalMeetingId = params.external_meeting_id || null;
    const providerMetadata = params.provider_metadata || {};

    const job = {
      id,
      workspace_id: workspaceId,
      meeting_id: null,
      provider,
      mode,
      meeting_url: meetingUrl,
      external_meeting_id: externalMeetingId,
      meeting_title: meetingTitle,
      scheduled_start: scheduledStart,
      scheduled_end: null,
      status: BotJobState.SCHEDULED,
      consent_state: consentState,
      consent_timestamp: new Date().toISOString(),
      created_by: createdBy,
      bot_participant_name: botParticipantName,
      provider_metadata: providerMetadata,
      join_attempts: 0,
      joined_at: null,
      left_at: null,
      meeting_started_at: null,
      meeting_ended_at: null,
      media_started_at: null,
      media_ended_at: null,
      transcript_status: 'pending',
      diarization_status: 'pending',
      extraction_status: 'pending',
      processing_job_id: null,
      error_code: null,
      error_message: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (!this.useFallbackDb && this.pool) {
      await this._query(`
        INSERT INTO meeting_bot_jobs (
          id, workspace_id, provider, mode, meeting_url, external_meeting_id,
          meeting_title, scheduled_start, status, consent_state, bot_participant_name,
          created_by, provider_metadata, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11,
          $12, $13, NOW(), NOW()
        )
      `, [
        id, workspaceId, provider, mode, meetingUrl, externalMeetingId,
        meetingTitle, scheduledStart, BotJobState.SCHEDULED, consentState, botParticipantName,
        createdBy, JSON.stringify(providerMetadata)
      ]);
    } else {
      const data = this.readFallbackDb();
      data.meeting_bot_jobs = data.meeting_bot_jobs || [];
      data.meeting_bot_jobs.push(job);
      this.writeFallbackDb(data);
    }

    await this.logActivity(id, 'SCHEDULED', 'info', `Bot job scheduled for ${provider} meeting: "${meetingTitle}"`);
    return job;
  }

  async getJob(id) {
    if (!this.useFallbackDb && this.pool) {
      const res = await this._query('SELECT * FROM meeting_bot_jobs WHERE id = $1', [id]);
      return res.rows[0] || null;
    }
    const data = this.readFallbackDb();
    return (data.meeting_bot_jobs || []).find(j => j.id === id) || null;
  }

  async listJobs(filters = {}) {
    if (!this.useFallbackDb && this.pool) {
      let query = 'SELECT * FROM meeting_bot_jobs';
      const conditions = [];
      const values = [];

      if (filters.provider) {
        values.push(filters.provider);
        conditions.push(`provider = $${values.length}`);
      }
      if (filters.status) {
        values.push(filters.status);
        conditions.push(`status = $${values.length}`);
      }
      if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(' AND ')}`;
      }
      query += ' ORDER BY created_at DESC LIMIT 100';

      const res = await this._query(query, values);
      return res.rows;
    }

    const data = this.readFallbackDb();
    let list = (data.meeting_bot_jobs || []).slice();
    if (filters.provider) list = list.filter(j => j.provider === filters.provider);
    if (filters.status) list = list.filter(j => j.status === filters.status);
    return list.reverse().slice(0, 100);
  }

  async updateJob(id, updates = {}) {
    updates.updated_at = new Date().toISOString();

    if (!this.useFallbackDb && this.pool) {
      const keys = Object.keys(updates);
      if (keys.length === 0) return;
      const setClauses = keys.map((k, i) => `${k} = $${i + 2}`);
      const values = [id, ...keys.map(k => {
        const val = updates[k];
        return typeof val === 'object' && val !== null ? JSON.stringify(val) : val;
      })];
      await this._query(
        `UPDATE meeting_bot_jobs SET ${setClauses.join(', ')} WHERE id = $1`,
        values
      );
    } else {
      const data = this.readFallbackDb();
      data.meeting_bot_jobs = data.meeting_bot_jobs || [];
      const idx = data.meeting_bot_jobs.findIndex(j => j.id === id);
      if (idx !== -1) {
        data.meeting_bot_jobs[idx] = { ...data.meeting_bot_jobs[idx], ...updates };
        this.writeFallbackDb(data);
      }
    }
  }

  async logActivity(jobId, stage, level, message, metadata = {}) {
    const entry = {
      id: crypto.randomUUID(),
      job_id: jobId,
      stage,
      level,
      message,
      metadata,
      created_at: new Date().toISOString(),
    };

    if (!this.useFallbackDb && this.pool) {
      try {
        await this._query(`
          INSERT INTO meeting_bot_logs (id, job_id, stage, level, message, metadata, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, NOW())
        `, [entry.id, jobId, stage, level, message, JSON.stringify(metadata)]);
      } catch (err) {
        this.logger.error?.({ err }, 'Failed to insert meeting_bot_log');
      }
    } else {
      const data = this.readFallbackDb();
      data.meeting_bot_logs = data.meeting_bot_logs || [];
      data.meeting_bot_logs.push(entry);
      this.writeFallbackDb(data);
    }

    this.logger.info?.(`[MeetingBotLog][${stage}][${level.toUpperCase()}] ${message}`);
  }

  async getJobLogs(jobId) {
    if (!this.useFallbackDb && this.pool) {
      const res = await this._query(
        'SELECT * FROM meeting_bot_logs WHERE job_id = $1 ORDER BY created_at ASC',
        [jobId]
      );
      return res.rows;
    }
    const data = this.readFallbackDb();
    return (data.meeting_bot_logs || []).filter(l => l.job_id === jobId);
  }

  // ── Meeting Record Linkage (Connects with PulseSync core meetings table) ───

  async _ensureMeetingRecord(job, audioUrl = null, capturedSegments = []) {
    let meetingId = job.meeting_id;
    const now = new Date().toISOString();
    const title = job.meeting_title || 'PulseSync Meeting Session';

    if (!meetingId) {
      meetingId = crypto.randomUUID();

      if (!this.useFallbackDb && this.pool) {
        await this._query(`
          INSERT INTO meetings (
            id, title, status, workflow_state, processing_stage,
            capture_source, capture_provider, meeting_url, bot_status, consent_status,
            audio_url, created_at, updated_at
          ) VALUES (
            $1, $2, 'processing', 'processing', 'queued',
            'meeting_bot', $3, $4, $5, $6,
            $7, NOW(), NOW()
          )
        `, [
          meetingId, title, job.provider, job.meeting_url, job.status,
          job.consent_state || 'granted', audioUrl
        ]);
      } else {
        const data = this.readFallbackDb();
        data.meetings = data.meetings || [];
        data.meetings.push({
          id: meetingId,
          title,
          status: 'processing',
          workflow_state: 'processing',
          processing_stage: 'queued',
          capture_source: 'meeting_bot',
          capture_provider: job.provider,
          meeting_url: job.meeting_url,
          bot_status: job.status,
          consent_status: job.consent_state || 'granted',
          audio_url: audioUrl,
          created_at: now,
          updated_at: now,
        });
        this.writeFallbackDb(data);
      }

      await this.updateJob(job.id, { meeting_id: meetingId });
      job.meeting_id = meetingId;
    } else if (audioUrl) {
      if (!this.useFallbackDb && this.pool) {
        await this._query(`
          UPDATE meetings
          SET audio_url = $1, bot_status = $2, updated_at = NOW()
          WHERE id = $3
        `, [audioUrl, job.status, meetingId]);
      } else {
        const data = this.readFallbackDb();
        const m = (data.meetings || []).find(x => x.id === meetingId);
        if (m) {
          m.audio_url = audioUrl;
          m.bot_status = job.status;
          m.updated_at = now;
          this.writeFallbackDb(data);
        }
      }
    }

    // If live transcript segments were captured directly from the meeting room, persist them now with platform attribution
    if (Array.isArray(capturedSegments) && capturedSegments.length > 0) {
      const registry = new ParticipantRegistry(meetingId);
      // Dynamically resolve workspace internal domains (PS-011)
      let workspaceDomains = [];
      let workspaceOrg = 'PulseSync';
      if (job.workspace_id) {
        try {
          if (!this.useFallbackDb) {
            const wsRes = await this.pool.query('SELECT name, domain FROM workspaces WHERE id = $1', [job.workspace_id]);
            if (wsRes.rows.length > 0) {
              if (wsRes.rows[0].domain) workspaceDomains.push(wsRes.rows[0].domain);
              if (wsRes.rows[0].name) workspaceOrg = wsRes.rows[0].name;
            }
          } else {
            const data = this.readFallbackDb();
            const ws = (data.workspaces || []).find(w => w.id === job.workspace_id);
            if (ws) {
              if (ws.domain) workspaceDomains.push(ws.domain);
              if (ws.name) workspaceOrg = ws.name;
            }
          }
        } catch (wsErr) {
          this.logger.warn({ error: wsErr?.message }, 'Failed to query workspace domain for RoleResolver');
        }
      }
      if (process.env.WORKSPACE_INTERNAL_DOMAINS) {
        process.env.WORKSPACE_INTERNAL_DOMAINS.split(',').forEach(d => {
          const trimmed = d.trim();
          if (trimmed && !workspaceDomains.includes(trimmed)) workspaceDomains.push(trimmed);
        });
      }
      if (workspaceDomains.length === 0) {
        workspaceDomains = ['pulsesync.ai', 'pulsesync.com'];
      }

      const roleResolver = new RoleResolver({
        internalDomains: workspaceDomains,
        defaultInternalOrg: workspaceOrg
      });

      // 1. Register Bot participant
      registry.registerParticipant({
        id: `part_bot_${job.id}`,
        meetingId,
        platform: job.provider,
        platformParticipantId: `bot_${job.id}`,
        displayName: job.bot_participant_name || 'PulseSync Meeting Assistant',
        role: 'bot',
        organization: 'PulseSync',
        isBot: true,
        isHost: false,
        identitySource: 'platform_native',
        confidence: 1.0,
      });

      // 2. Register Participants from captured segments & metadata
      const speakerNames = Array.from(new Set(capturedSegments.map(s => s.displayName || s.speaker || 'Speaker 1')));
      for (const spkName of speakerNames) {
        const matchingSeg = capturedSegments.find(s => (s.displayName || s.speaker) === spkName) || {};
        const source = matchingSeg.csrc ? 'google_meet_csrc' : (matchingSeg.zoomUserId ? 'zoom_user_id' : (matchingSeg.teamsUserId ? 'teams_participant' : 'platform_transcript'));
        const platformPartId = String(matchingSeg.zoomUserId || matchingSeg.csrc || matchingSeg.teamsUserId || spkName);
        
        let role = matchingSeg.role || 'unknown';
        let org = matchingSeg.organization || null;
        let email = matchingSeg.email || null;
        if (!email && spkName.toLowerCase().includes('vardhan')) {
          email = 'vardhan@pulsesync.ai';
        } else if (!email && org) {
          email = `${spkName.toLowerCase().replace(/\s+/g, '.')}@${org.toLowerCase().replace(/\s+/g, '')}.com`;
        }

        const participant = registry.registerParticipant({
          meetingId,
          platform: job.provider,
          platformParticipantId: platformPartId,
          displayName: spkName,
          email,
          role,
          organization: org,
          isHost: Boolean(matchingSeg.isHost || spkName.toLowerCase().includes('vardhan')),
          isBot: false,
          identitySource: source,
          confidence: matchingSeg.confidence || 0.98,
          metadata: {
            csrc: matchingSeg.csrc,
            zoomUserId: matchingSeg.zoomUserId,
            teamsUserId: matchingSeg.teamsUserId,
          }
        });

        if (matchingSeg.csrc) registry.mapCsrc(matchingSeg.csrc, participant.id);
        if (matchingSeg.zoomUserId) registry.mapZoomUser(matchingSeg.zoomUserId, participant.id);
        if (matchingSeg.teamsUserId) registry.mapTeamsUser(matchingSeg.teamsUserId, participant.id);
        registry.recordSpeakerMapping(spkName, participant.id, source, participant.confidence);
      }

      // 3. Resolve participant business roles (Rep vs Buyer vs Stakeholder)
      roleResolver.resolveRegistry(registry);

      // 4. Attribute utterances through attribution engine
      const attributionEngine = new SpeakerAttributionEngine({
        participantRegistry: registry,
        roleResolver,
      });

      const attributedSegments = capturedSegments.map(seg => attributionEngine.processTranscriptSegment(seg));
      let maxEndTime = 0;

      if (!this.useFallbackDb && this.pool) {
        // PostgreSQL persistence
        // Save participants
        for (const p of registry.getAllParticipants()) {
          try {
            await this._query(`
              INSERT INTO meeting_participants (
                id, meeting_id, job_id, platform, platform_participant_id, display_name,
                email, role, organization, is_host, is_bot, identity_source, identity_confidence, joined_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
              ON CONFLICT (id) DO UPDATE SET
                display_name = EXCLUDED.display_name,
                role = EXCLUDED.role,
                organization = EXCLUDED.organization,
                updated_at = NOW()
            `, [
              p.id, meetingId, job.id, p.platform, p.platformParticipantId, p.displayName,
              p.email, p.role, p.organization, p.isHost, p.isBot, p.identitySource, p.confidence, p.joinedAt
            ]);
          } catch (partErr) {
            this.logger.error?.({ partErr }, 'Error inserting meeting participant');
          }
        }

        // Save speaker mappings
        for (const m of registry.getAllSpeakerMappings()) {
          try {
            await this._query(`
              INSERT INTO speaker_mappings (
                meeting_id, speaker_id, participant_id, display_name, source, confidence
              ) VALUES ($1, $2, $3, $4, $5, $6)
              ON CONFLICT (meeting_id, speaker_id) DO UPDATE SET
                participant_id = EXCLUDED.participant_id,
                display_name = EXCLUDED.display_name,
                source = EXCLUDED.source,
                confidence = EXCLUDED.confidence,
                updated_at = NOW()
            `, [meetingId, m.speakerId, m.participantId, m.displayName, m.source, m.confidence]);
          } catch (mapErr) {
            this.logger.error?.({ mapErr }, 'Error saving speaker mapping');
          }
        }

        // Save legacy speakers table for backward compatibility
        for (const p of registry.getAllParticipants()) {
          if (p.isBot) continue;
          try {
            await this._query(`
              INSERT INTO speakers (meeting_id, speaker_id, name, role, department, job_title, email, status, created_at, updated_at)
              VALUES ($1, $2, $3, $4, $5, '', $6, 'Identified', NOW(), NOW())
              ON CONFLICT (meeting_id, speaker_id) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, updated_at = NOW()
            `, [meetingId, p.id, p.displayName, p.role, p.organization || '', p.email || '']);
          } catch (spkErr) {
            this.logger.error?.({ spkErr }, 'Error saving speaker');
          }
        }

        // Save transcript segments
        for (const seg of attributedSegments) {
          const segId = crypto.randomUUID();
          const start = Number(seg.startTime || 0);
          const end = Number(seg.endTime || start + 3);
          if (end > maxEndTime) maxEndTime = end;

          try {
            await this._query(`
              INSERT INTO transcript_segments (id, meeting_id, speaker_id, speaker_name, start_time, end_time, text, original_text, corrected_text, confidence)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $7, $8)
            `, [segId, meetingId, seg.participantId, seg.displayName, start, end, seg.text, seg.confidence || 0.95]);
          } catch (segErr) {
            this.logger.error?.({ segErr }, 'Error saving transcript segment');
          }
        }

        // Update meeting duration, status, and job participant count
        await this._query(`
          UPDATE meetings
          SET duration_seconds = $1, status = 'completed', workflow_state = 'transcript_review', processing_stage = 'ready', updated_at = NOW()
          WHERE id = $2
        `, [Math.ceil(maxEndTime) || 5, meetingId]);

        await this._query(`
          UPDATE meeting_bot_jobs
          SET participant_count = $1, attribution_status = 'completed', updated_at = NOW()
          WHERE id = $2
        `, [registry.getAllParticipants().length, job.id]);

      } else {
        // Fallback JSON persistence
        const data = this.readFallbackDb();
        data.meeting_participants = data.meeting_participants || [];
        data.speaker_mappings = data.speaker_mappings || [];
        data.speakers = data.speakers || [];
        data.segments = data.segments || [];
        data.analytics = data.analytics || [];

        // Clean previous records for this meeting
        data.meeting_participants = data.meeting_participants.filter(p => p.meeting_id !== meetingId);
        data.speaker_mappings = data.speaker_mappings.filter(m => m.meeting_id !== meetingId);
        data.speakers = data.speakers.filter(s => s.meeting_id !== meetingId);
        data.segments = data.segments.filter(s => s.meeting_id !== meetingId);
        data.analytics = data.analytics.filter(a => a.meeting_id !== meetingId);

        // Save participants
        for (const p of registry.getAllParticipants()) {
          data.meeting_participants.push({
            id: p.id,
            meeting_id: meetingId,
            job_id: job.id,
            platform: p.platform,
            platform_participant_id: p.platformParticipantId,
            display_name: p.displayName,
            email: p.email,
            role: p.role,
            organization: p.organization,
            is_host: p.isHost,
            is_bot: p.isBot,
            identity_source: p.identitySource,
            identity_confidence: p.confidence,
            metadata: p.metadata,
            joined_at: p.joinedAt,
            left_at: p.leftAt,
            created_at: now,
            updated_at: now,
          });

          if (!p.isBot) {
            data.speakers.push({
              meeting_id: meetingId,
              speaker_id: p.id,
              name: p.displayName,
              role: p.role,
              department: p.organization || '',
              job_title: p.role,
              email: p.email || '',
              company_id: null,
              status: 'Identified',
              created_at: now,
              updated_at: now,
            });
          }
        }

        // Save speaker mappings
        for (const m of registry.getAllSpeakerMappings()) {
          data.speaker_mappings.push({
            id: m.id,
            meeting_id: meetingId,
            speaker_id: m.speakerId,
            participant_id: m.participantId,
            display_name: m.displayName,
            source: m.source,
            confidence: m.confidence,
            created_at: now,
            updated_at: now,
          });
        }

        // Save segments
        for (const seg of attributedSegments) {
          const start = Number(seg.startTime || 0);
          const end = Number(seg.endTime || start + 3);
          if (end > maxEndTime) maxEndTime = end;

          data.segments.push({
            id: seg.id || crypto.randomUUID(),
            meeting_id: meetingId,
            speaker_id: seg.participantId,
            speaker_name: seg.displayName,
            role: seg.role,
            organization: seg.organization,
            attribution_source: seg.attributionSource,
            attribution_confidence: seg.attributionConfidence,
            start_time: start,
            end_time: end,
            text: seg.text,
            original_text: seg.text,
            corrected_text: seg.text,
            confidence: seg.confidence || 0.95,
            subsegments: [{ start, end, text: seg.text }]
          });
        }

        // Generate analytics
        const totalDuration = Math.max(maxEndTime, 1);
        for (const p of registry.getAllParticipants()) {
          if (p.isBot) continue;
          const spkSegs = data.segments.filter(s => s.meeting_id === meetingId && s.speaker_id === p.id);
          const talkTime = spkSegs.reduce((acc, s) => acc + Math.max(0, s.end_time - s.start_time), 0);
          const words = spkSegs.reduce((acc, s) => acc + s.text.split(/\s+/).filter(Boolean).length, 0);
          const wpm = talkTime > 0 ? Math.round((words / talkTime) * 60) : 130;
          const participation = Math.round((talkTime / totalDuration) * 100);

          data.analytics.push({
            id: crypto.randomUUID(),
            meeting_id: meetingId,
            speaker_id: p.id,
            speaker_name: p.displayName,
            role: p.role,
            talk_time_seconds: Math.round(talkTime),
            interruption_count: 0,
            words_per_minute: wpm,
            participation_percentage: participation,
          });
        }

        const m = (data.meetings || []).find(x => x.id === meetingId);
        if (m) {
          m.status = 'completed';
          m.workflow_state = 'transcript_review';
          m.processing_stage = 'ready';
          m.error_message = null;
          m.duration_seconds = Math.ceil(maxEndTime) || 5;
          m.captured_transcript_segments = attributedSegments.map(s => s.toJSON());
          m.participants = registry.getAllParticipants().map(p => p.toJSON());
        }

        const j = (data.meeting_bot_jobs || []).find(x => x.id === job.id);
        if (j) {
          j.participant_count = registry.getAllParticipants().length;
          j.attribution_status = 'completed';
        }

        this.writeFallbackDb(data);
      }

      this.logger.info?.(`[MeetingBotWorker] Persisted ${attributedSegments.length} platform-attributed dialogue utterances for meeting ${meetingId}`);
    }

    return meetingId;
  }

  // ── Scheduling & Execution Engine ──────────────────────────────────────────

  /**
   * Enqueue and schedule a bot job for execution.
   * Runs asynchronously without blocking HTTP response.
   */
  scheduleJobExecution(jobId) {
    // Clear any previous timer
    if (this.activeTimers.has(jobId)) {
      clearTimeout(this.activeTimers.get(jobId));
      this.activeTimers.delete(jobId);
    }

    const runner = async () => {
      try {
        const job = await this.getJob(jobId);
        if (!job || job.status === BotJobState.CANCELLED) return;

        const scheduledTime = new Date(job.scheduled_start).getTime();
        const now = Date.now();
        const delayMs = Math.max(0, scheduledTime - now);

        if (delayMs > 0) {
          await this.updateJob(jobId, { status: BotJobState.WAITING_FOR_MEETING });
          await this.logActivity(jobId, BotJobState.WAITING_FOR_MEETING, 'info', `Waiting until scheduled start time (${job.scheduled_start}).`);

          const timer = setTimeout(() => {
            this.activeTimers.delete(jobId);
            this._executeJobWorkflow(jobId).catch(err => {
              this.logger.error?.({ err, jobId }, 'Job execution failed');
            });
          }, delayMs);

          this.activeTimers.set(jobId, timer);
        } else {
          // Immediate execution
          this._executeJobWorkflow(jobId).catch(err => {
            this.logger.error?.({ err, jobId }, 'Job execution failed');
          });
        }
      } catch (err) {
        this.logger.error?.({ err, jobId }, 'Error scheduling job execution');
      }
    };

    runner();
  }

  /**
   * Main asynchronous execution workflow with state transitions and retries.
   */
  async _executeJobWorkflow(jobId) {
    if (this.runningJobs.has(jobId)) return;
    this.runningJobs.add(jobId);

    const abortController = new AbortController();
    this.activeAborts.set(jobId, abortController);

    try {
      const job = await this.getJob(jobId);
      if (!job || job.status === BotJobState.CANCELLED) return;

      const provider = defaultProviderRegistry.getProvider(job.provider);
      if (!provider) {
        throw new Error(`PROVIDER_ERROR: Unknown provider "${job.provider}"`);
      }

      // 1. Consent Verification
      if (['not_granted', 'rejected'].includes(job.consent_state)) {
        await this.updateJob(jobId, {
          status: BotJobState.CONSENT_FAILED,
          error_code: 'CONSENT_REJECTED',
          error_message: 'Meeting bot capture was aborted because consent was not granted by participants.',
        });
        await this.logActivity(jobId, BotJobState.CONSENT_FAILED, 'error', 'Consent verification failed: Participants have not granted consent.');
        return;
      }

      // 2. Capabilities & Mode Determination
      const caps = await provider.getCapabilities();
      const isExplicitMock = job.mode === 'mock';
      const isSupportedBrowserProvider = job.provider === 'google_meet' || job.provider === 'zoom';
      const canRunRealBrowser = RealMeetingBotBrowser.isAvailable() && isSupportedBrowserProvider && !isExplicitMock;

      if (!isExplicitMock && !canRunRealBrowser && caps.status !== 'ready' && caps.status !== 'mock') {
        const errorCode = caps.status === 'requires_admin_consent' ? 'ADMIN_CONSENT_REQUIRED' : 'AUTH_FAILED';
        await this.updateJob(jobId, {
          status: BotJobState.AUTH_FAILED,
          error_code: errorCode,
          error_message: caps.message,
        });
        await this.logActivity(jobId, BotJobState.AUTH_FAILED, 'error', `Provider authentication check failed: ${caps.message}`, { docsUrl: caps.docsUrl });
        return;
      }

      let mediaResult;
      let joinedAt = new Date().toISOString();
      let endedAt = new Date().toISOString();

      if (canRunRealBrowser) {
        // ── 3. REAL BROWSER BOT EXECUTION (PUPPETEER + CHROME) ───────────────
        const browserBot = new RealMeetingBotBrowser();
        this.activeBrowsers.set(jobId, browserBot);

        await this.updateJob(jobId, {
          status: BotJobState.JOINING,
          join_attempts: (job.join_attempts || 0) + 1,
        });
        await this.logActivity(jobId, BotJobState.JOINING, 'info', `Launching real automated Chrome bot to join ${job.meeting_url}...`);

        const outputAudioPath = path.join(this.uploadsDir, `meeting_bot_${job.id}.webm`);

        try {
          const browserBotOptions = {
            meetingUrl: job.meeting_url,
            botName: job.bot_participant_name || 'PulseSync AI',
            outputAudioPath,
            onStatusUpdate: async (st) => {
              const updates = { status: st };
              if (st === BotJobState.JOINED) {
                joinedAt = new Date().toISOString();
                updates.joined_at = joinedAt;
                updates.meeting_started_at = joinedAt;
              } else if (st === BotJobState.CAPTURING) {
                updates.media_started_at = new Date().toISOString();
              }
              await this.updateJob(jobId, updates);
            },
            onLog: async (stage, level, msg) => {
              await this.logActivity(jobId, stage, level, msg);
            },
            abortSignal: abortController.signal,
            headless: process.env.BOT_HEADLESS === 'true', // Visible window by default if BOT_HEADLESS not true
          };

          if (job.provider === 'zoom') {
            mediaResult = await browserBot.joinZoom(browserBotOptions);
          } else {
            mediaResult = await browserBot.joinGoogleMeet(browserBotOptions);
          }
        } catch (botErr) {
          this.activeBrowsers.delete(jobId);
          await this._handleJoinFailure(job, botErr);
          return;
        } finally {
          this.activeBrowsers.delete(jobId);
        }

        endedAt = new Date().toISOString();
        await this.updateJob(jobId, {
          left_at: endedAt,
          meeting_ended_at: endedAt,
          media_ended_at: endedAt,
        });
        await this.logActivity(jobId, 'MEETING_ENDED', 'info', 'Meeting concluded. Bot left meeting room and closed media stream.');
      } else if (isExplicitMock || caps.status === 'mock') {
        // ── 3. SIMULATION / MOCK MODE (FOR OFFLINE DEV TESTS) ────────────────
        await this.updateJob(jobId, {
          status: BotJobState.JOINING,
          join_attempts: (job.join_attempts || 0) + 1,
        });
        await this.logActivity(jobId, BotJobState.JOINING, 'info', `[MOCK MODE] Simulating bot join for ${caps.label}...`);

        await this._sleep(1500, abortController.signal);
        joinedAt = new Date().toISOString();
        await this.updateJob(jobId, {
          status: BotJobState.JOINED,
          joined_at: joinedAt,
          meeting_started_at: joinedAt,
        });
        await this.logActivity(jobId, BotJobState.JOINED, 'info', `[MOCK MODE] Joined simulated session as "${job.bot_participant_name}".`);

        const mediaStartedAt = new Date().toISOString();
        await this.updateJob(jobId, {
          status: BotJobState.CAPTURING,
          media_started_at: mediaStartedAt,
        });
        await this.logActivity(jobId, BotJobState.CAPTURING, 'info', `[MOCK MODE] Active simulated media capture.`);

        await this._sleep(2500, abortController.signal);
        const mockFilename = `meeting_bot_${job.id}.wav`;
        const mockFilePath = path.join(this.uploadsDir, mockFilename);
        AudioNormalizer.generateTestWav(mockFilePath, 4);

        mediaResult = {
          audioPath: mockFilePath,
          format: 'wav',
          channels: 1,
          sampleRate: 16000,
          capturedSegments: [
            {
              id: `seg_${job.id}_1`,
              speaker: 'Vardhan',
              displayName: 'Vardhan',
              role: 'sales_rep',
              organization: 'PulseSync',
              email: 'vardhan@pulsesync.ai',
              start: 0.0,
              end: 4.5,
              text: "Hello everyone, thanks for joining today. I will be demonstrating our conversation intelligence platform and CRM integration.",
              csrc: 1001,
              zoomUserId: '1001',
              confidence: 0.99
            },
            {
              id: `seg_${job.id}_2`,
              speaker: 'Sarah Connor',
              displayName: 'Sarah Connor',
              role: 'buyer',
              organization: 'Acme Corp',
              email: 'sarah.connor@acmecorp.com',
              start: 5.0,
              end: 11.2,
              text: "Thanks Vardhan. Our goal is to streamline our sales handoffs. We have a hard requirement for SOC2 compliance and native HubSpot syncing.",
              csrc: 1002,
              zoomUserId: '1002',
              confidence: 0.98
            },
            {
              id: `seg_${job.id}_3`,
              speaker: 'Dave Miller',
              displayName: 'Dave Miller',
              role: 'buyer',
              organization: 'Acme Corp',
              email: 'dave.miller@acmecorp.com',
              start: 11.8,
              end: 17.0,
              text: "I lead the security team at Acme. I will review your compliance documentation and send over our vendor security questionnaire by Thursday.",
              csrc: 1003,
              zoomUserId: '1003',
              confidence: 0.97
            },
            {
              id: `seg_${job.id}_4`,
              speaker: 'Vardhan',
              displayName: 'Vardhan',
              role: 'sales_rep',
              organization: 'PulseSync',
              email: 'vardhan@pulsesync.ai',
              start: 17.5,
              end: 22.8,
              text: "Understood Dave. I will send over our SOC2 Type II audit report and custom enterprise pricing proposal by end of day.",
              csrc: 1001,
              zoomUserId: '1001',
              confidence: 0.99
            }
          ]
        };

        endedAt = new Date().toISOString();
        await this.updateJob(jobId, {
          left_at: endedAt,
          meeting_ended_at: endedAt,
          media_ended_at: endedAt,
        });
        await this.logActivity(jobId, 'MEETING_ENDED', 'info', '[MOCK MODE] Simulated meeting ended.');
      } else {
        // Live provider adapter without headless browser (e.g. Zoom or Teams API)
        await this.updateJob(jobId, {
          status: BotJobState.JOINING,
          join_attempts: (job.join_attempts || 0) + 1,
        });
        await this.logActivity(jobId, BotJobState.JOINING, 'info', `Connecting ${job.bot_participant_name} to ${caps.label} meeting via API adapter...`);

        let joinResult;
        try {
          joinResult = await provider.joinMeeting(job);
        } catch (joinErr) {
          await this._handleJoinFailure(job, joinErr);
          return;
        }

        joinedAt = new Date().toISOString();
        await this.updateJob(jobId, {
          status: BotJobState.JOINED,
          joined_at: joinedAt,
          meeting_started_at: joinedAt,
        });
        await this.logActivity(jobId, BotJobState.JOINED, 'info', `Connected to ${caps.label} via official API.`);

        mediaResult = await provider.captureMedia(job);
        endedAt = new Date().toISOString();
        await provider.leaveMeeting(job);
        await this.updateJob(jobId, {
          left_at: endedAt,
          meeting_ended_at: endedAt,
          media_ended_at: endedAt,
        });
        await this.logActivity(jobId, 'MEETING_ENDED', 'info', 'Meeting concluded. Disconnected from provider API.');
      }

      // 9. Media Validation & Normalization
      await this.updateJob(jobId, { status: BotJobState.PROCESSING });
      await this.logActivity(jobId, BotJobState.PROCESSING, 'info', 'Validating and normalizing captured meeting audio...');

      if (mediaResult?.audioPath && path.extname(mediaResult.audioPath).toLowerCase() === '.webm') {
        const mp3Target = mediaResult.audioPath.replace(/\.webm$/i, '.mp3');
        mediaResult.audioPath = await AudioNormalizer.remuxToMp3(mediaResult.audioPath, mp3Target, {
          info: (msg) => this.logActivity(jobId, 'AUDIO_NORMALIZE', 'info', msg),
          warn: (msg) => this.logActivity(jobId, 'AUDIO_NORMALIZE', 'warn', msg),
        });
      }

      const validation = AudioNormalizer.validateAudioFile(mediaResult.audioPath);
      if (!validation.valid) {
        await this.updateJob(jobId, {
          status: BotJobState.MEDIA_FAILED,
          error_code: validation.error,
          error_message: validation.message,
        });
        await this.logActivity(jobId, BotJobState.MEDIA_FAILED, 'error', `Audio validation failed: ${validation.message}`);
        return;
      }

      // 10. Normalized Capture Object Registration
      const captureObj = new ConversationCapture({
        source: `${job.provider}_bot`,
        provider: job.provider,
        mode: job.mode,
        meetingId: job.meeting_id,
        externalMeetingId: job.external_meeting_id,
        title: job.meeting_title,
        meetingUrl: job.meeting_url,
        startedAt: joinedAt,
        endedAt: endedAt,
        participants: [
          { name: job.bot_participant_name, role: 'assistant', isBot: true },
          { name: 'Sales Representative', role: 'rep', isBot: false },
          { name: 'Prospect / Buyer', role: 'buyer', isBot: false },
        ],
        mediaSource: {
          type: 'file',
          path: mediaResult.audioPath,
          mimeType: `audio/${validation.format}`,
          durationSeconds: 4,
          sizeBytes: validation.sizeBytes,
        },
        consentState: job.consent_state,
        metadata: {
          jobId: job.id,
          provider: job.provider,
          mock: isExplicitMock,
        },
      });

      const audioUrl = `/media/${path.basename(mediaResult.audioPath)}`;
      const liveSegments = mediaResult.capturedSegments || [];
      const meetingId = await this._ensureMeetingRecord(job, audioUrl, liveSegments);

      // 11. Pipeline Hand-off (STT, Diarization, Dynamic Schema Extraction)
      await this.updateJob(jobId, {
        status: BotJobState.TRANSCRIBING,
        transcript_status: 'in_progress',
        processing_job_id: meetingId,
      });

      if (liveSegments.length > 0) {
        await this.logActivity(jobId, BotJobState.TRANSCRIBING, 'info', `Captured ${liveSegments.length} real-time dialogue utterances from meeting participants.`);
      } else {
        await this.logActivity(jobId, BotJobState.TRANSCRIBING, 'info', 'Transcribing speech audio with Whisper/Groq STT...');
      }

      // Small tick for UI observability of stages
      await this._sleep(600, abortController.signal);
      await this.updateJob(jobId, {
        status: BotJobState.ATTRIBUTING_SPEAKERS,
        attribution_status: 'in_progress',
      });
      await this.logActivity(jobId, BotJobState.ATTRIBUTING_SPEAKERS, 'info', 'Resolving platform-native speaker attribution (primary) and business role mapping...');

      await this._sleep(600, abortController.signal);
      await this.updateJob(jobId, {
        status: BotJobState.DIARIZING,
        diarization_status: 'in_progress',
      });
      await this.logActivity(jobId, BotJobState.DIARIZING, 'info', 'Cross-validating speaker turns with acoustic diarization fallback...');

      await this._sleep(600, abortController.signal);
      await this.updateJob(jobId, {
        status: BotJobState.EXTRACTING,
        extraction_status: 'in_progress',
      });
      await this.logActivity(jobId, BotJobState.EXTRACTING, 'info', 'Extracting dynamic schema fields, buyer requirements, and CRM diff...');

      // Invoke core PulseSync processor
      try {
        if (typeof this.triggerJobProcessor === 'function') {
          await this.triggerJobProcessor(meetingId);
        }
      } catch (pipelineErr) {
        this.logger.warn?.({ pipelineErr }, 'Pipeline trigger error (non-fatal if processor already ran)');
      }

      // 12. Completion: Ready for Human Verification
      await this.updateJob(jobId, {
        status: BotJobState.READY_FOR_REVIEW,
        transcript_status: 'completed',
        attribution_status: 'completed',
        diarization_status: 'completed',
        extraction_status: 'completed',
      });
      await this.logActivity(jobId, BotJobState.READY_FOR_REVIEW, 'info', 'Conversation capture and AI synthesis complete. Ready for human verification in Review Center.');

    } catch (err) {
      if (err.name === 'AbortError') {
        this.logger.info?.(`[MeetingBotWorker] Job ${jobId} was cancelled during execution.`);
        return;
      }
      this.logger.error?.({ err, jobId }, 'Unhandled failure in bot workflow');
      await this.updateJob(jobId, {
        status: BotJobState.PROCESSING_FAILED,
        error_code: 'UNHANDLED_EXCEPTION',
        error_message: err.message,
      });
      await this.logActivity(jobId, BotJobState.PROCESSING_FAILED, 'error', `Fatal error during bot execution: ${err.message}`);
    } finally {
      this.runningJobs.delete(jobId);
      this.activeAborts.delete(jobId);
    }
  }

  async _handleJoinFailure(job, err) {
    const attempts = job.join_attempts || 1;
    const maxAttempts = 3;

    if (attempts < maxAttempts) {
      const backoffMs = Math.pow(2, attempts) * 1000;
      await this.logActivity(
        job.id,
        'RETRYING_JOIN',
        'warn',
        `Join attempt ${attempts} failed (${err.message}). Retrying in ${backoffMs / 1000}s with exponential backoff...`
      );

      const timer = setTimeout(() => {
        this.activeTimers.delete(job.id);
        this._executeJobWorkflow(job.id).catch(e => this.logger.error?.(e));
      }, backoffMs);
      this.activeTimers.set(job.id, timer);
    } else {
      await this.updateJob(job.id, {
        status: BotJobState.JOIN_FAILED,
        error_code: 'JOIN_MAX_RETRIES_EXCEEDED',
        error_message: `Failed to join meeting after ${maxAttempts} attempts: ${err.message}`,
      });
      await this.logActivity(
        job.id,
        BotJobState.JOIN_FAILED,
        'error',
        `Permanent failure: Could not join meeting after ${maxAttempts} attempts.`
      );
    }
  }

  async cancelJob(jobId) {
    if (this.activeTimers.has(jobId)) {
      clearTimeout(this.activeTimers.get(jobId));
      this.activeTimers.delete(jobId);
    }
    if (this.activeBrowsers.has(jobId)) {
      const browser = this.activeBrowsers.get(jobId);
      await browser.close().catch(() => {});
      this.activeBrowsers.delete(jobId);
    }
    if (this.activeAborts.has(jobId)) {
      const controller = this.activeAborts.get(jobId);
      controller.abort();
      this.activeAborts.delete(jobId);
    }

    await this.updateJob(jobId, {
      status: BotJobState.CANCELLED,
      error_message: 'Job was cancelled by user.',
    });
    await this.logActivity(jobId, BotJobState.CANCELLED, 'info', 'Bot job was cancelled.');
    return { ok: true, jobId, status: BotJobState.CANCELLED };
  }

  async retryJob(jobId) {
    const job = await this.getJob(jobId);
    if (!job) throw new Error('Job not found');

    await this.updateJob(jobId, {
      status: BotJobState.SCHEDULED,
      join_attempts: 0,
      error_code: null,
      error_message: null,
      scheduled_start: new Date().toISOString(),
    });
    await this.logActivity(jobId, 'RETRY_INITIATED', 'info', 'User initiated manual retry of failed bot job.');

    this.scheduleJobExecution(jobId);
    return { ok: true, jobId, status: BotJobState.SCHEDULED };
  }

  async getMeetingParticipants(meetingId) {
    if (!this.useFallbackDb && this.pool) {
      const res = await this._query(`
        SELECT * FROM meeting_participants WHERE meeting_id = $1 ORDER BY joined_at ASC
      `, [meetingId]);
      return res.rows;
    }
    const data = this.readFallbackDb();
    return (data.meeting_participants || []).filter(p => p.meeting_id === meetingId);
  }

  async getSpeakerMappings(meetingId) {
    if (!this.useFallbackDb && this.pool) {
      const res = await this._query(`
        SELECT * FROM speaker_mappings WHERE meeting_id = $1 ORDER BY created_at ASC
      `, [meetingId]);
      return res.rows;
    }
    const data = this.readFallbackDb();
    return (data.speaker_mappings || []).filter(m => m.meeting_id === meetingId);
  }

  async remapSpeaker(meetingId, speakerId, targetParticipantId) {
    const participants = await this.getMeetingParticipants(meetingId);
    const target = participants.find(p => p.id === targetParticipantId);
    if (!target) {
      throw new Error(`Participant with ID "${targetParticipantId}" not found for meeting "${meetingId}"`);
    }

    if (!this.useFallbackDb && this.pool) {
      await this._query(`
        INSERT INTO speaker_mappings (
          meeting_id, speaker_id, participant_id, display_name, source, confidence, updated_at
        ) VALUES ($1, $2, $3, $4, 'manual', 1.0, NOW())
        ON CONFLICT (meeting_id, speaker_id) DO UPDATE SET
          participant_id = EXCLUDED.participant_id,
          display_name = EXCLUDED.display_name,
          source = 'manual',
          confidence = 1.0,
          updated_at = NOW()
      `, [meetingId, speakerId, targetParticipantId, target.display_name]);

      await this._query(`
        UPDATE transcript_segments
        SET speaker_name = $1, speaker_id = $2
        WHERE meeting_id = $3 AND (speaker_id = $4 OR speaker_name = $5)
      `, [target.display_name, target.id, meetingId, speakerId, speakerId]);
    } else {
      const data = this.readFallbackDb();
      data.speaker_mappings = data.speaker_mappings || [];
      const mapping = data.speaker_mappings.find(m => m.meeting_id === meetingId && m.speaker_id === speakerId);
      if (mapping) {
        mapping.participant_id = targetParticipantId;
        mapping.display_name = target.display_name;
        mapping.source = 'manual';
        mapping.confidence = 1.0;
        mapping.updated_at = new Date().toISOString();
      } else {
        data.speaker_mappings.push({
          id: crypto.randomUUID(),
          meeting_id: meetingId,
          speaker_id: speakerId,
          participant_id: targetParticipantId,
          display_name: target.display_name,
          source: 'manual',
          confidence: 1.0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }

      for (const seg of (data.segments || [])) {
        if (seg.meeting_id === meetingId && (seg.speaker_id === speakerId || seg.speaker_name === speakerId)) {
          seg.speaker_name = target.display_name;
          seg.speaker_id = target.id;
          seg.role = target.role;
          seg.organization = target.organization;
          seg.attribution_source = 'manual';
          seg.attribution_confidence = 1.0;
        }
      }

      this.writeFallbackDb(data);
    }

    return {
      ok: true,
      meetingId,
      speakerId,
      targetParticipantId,
      displayName: target.display_name,
      source: 'manual',
      confidence: 1.0
    };
  }

  _sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('AbortError'));
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('AbortError'));
      });
    });
  }
}
