/**
 * ZoomRtmsAdapter.js
 * 
 * Adapter for Zoom Realtime Media Streams (RTMS).
 * Consumes per-participant raw L16 PCM 16kHz mono audio and participant-attributed
 * real-time transcript fragments via WebSocket.
 * 
 * Includes fragment stitching logic to assemble partial words/phrases into coherent
 * AttributedTranscriptSegment instances.
 */

import { EventEmitter } from 'events';
import { AttributedAudioChunk } from '../attribution/AttributedAudioChunk.js';
import { AttributedTranscriptSegment } from '../attribution/AttributedTranscriptSegment.js';
import { ParticipantIdentity } from '../attribution/ParticipantIdentity.js';

export class ZoomRtmsAdapter extends EventEmitter {
  /**
   * @param {Object} options
   * @param {string} options.meetingId
   * @param {string} [options.rtmsUrl] - WebSocket endpoint for RTMS
   * @param {string} [options.token] - JWT/OAuth access token
   * @param {ParticipantRegistry} [options.registry]
   */
  constructor(options = {}) {
    super();
    this.meetingId = options.meetingId;
    this.rtmsUrl = options.rtmsUrl;
    this.token = options.token;
    this.registry = options.registry;
    this.connected = false;
    
    // Fragment stitching buffers: userId -> { text, startTime, endTime, userName, timer }
    this.transcriptBuffers = new Map();
    this.FRAGMENT_FLUSH_INTERVAL_MS = 1500; // Emit if no fragment arrives within 1.5s
  }

  /**
   * Connect to RTMS WebSocket stream (or simulate in mock mode)
   */
  async connect() {
    this.connected = true;
    this.emit('connected', { meetingId: this.meetingId });
  }

  async disconnect() {
    this.flushAllFragments();
    this.connected = false;
    this.emit('disconnected', { meetingId: this.meetingId });
  }

  /**
   * Handle incoming binary RTMS audio packet from WebSocket
   * Zoom RTMS protocol format:
   * Header: { user_id, user_name, timestamp, sample_rate, channels }
   * Body: Raw L16 PCM bytes (16kHz, 16-bit mono)
   * 
   * @param {Object} packet
   * @param {string|number} packet.user_id
   * @param {string} packet.user_name
   * @param {number} packet.timestamp
   * @param {Buffer|Uint8Array} packet.audioData
   * @param {number} [packet.durationMs]
   */
  handleAudioFrame(packet) {
    if (!packet || !packet.audioData) return;

    const userId = String(packet.user_id);
    const userName = packet.user_name || `Zoom User ${userId}`;

    // Ensure participant is registered in registry
    let participant = null;
    if (this.registry) {
      participant = this.registry.resolveZoomUser(userId);
      if (!participant) {
        participant = this.registry.registerParticipant({
          platform: 'zoom',
          platformParticipantId: userId,
          displayName: userName,
          identitySource: 'platform_native',
          confidence: 1.0
        });
      }
    }

    const chunk = new AttributedAudioChunk({
      meetingId: this.meetingId,
      participantId: participant ? participant.id : `zoom_${userId}`,
      speakerId: `zoom_${userId}`,
      displayName: userName,
      audio: packet.audioData,
      timestamp: packet.timestamp || Date.now(),
      durationMs: packet.durationMs || 100,
      sampleRate: 16000,
      channels: 1,
      codec: 'pcm_16le',
      source: 'zoom_rtms',
      metadata: {
        zoomUserId: userId
      }
    });

    this.emit('attributed_audio', chunk);
    return chunk;
  }

  /**
   * Handle incoming RTMS real-time transcript message fragment
   * Zoom RTMS transcript fragment schema:
   * {
   *   "msg_type": "transcript",
   *   "user_id": "16778240",
   *   "user_name": "Sarah Connor",
   *   "start_time": 12.4,
   *   "end_time": 14.1,
   *   "data": "let's discuss the security",
   *   "is_final": false
   * }
   * 
   * @param {Object} fragment
   */
  handleTranscriptFragment(fragment) {
    if (!fragment || !fragment.data) return;

    const userId = String(fragment.user_id);
    const userName = fragment.user_name || `Zoom User ${userId}`;
    const text = fragment.data.trim();

    if (!text) return;

    // Ensure participant exists
    let participant = null;
    if (this.registry) {
      participant = this.registry.resolveZoomUser(userId);
      if (!participant) {
        participant = this.registry.registerParticipant({
          platform: 'zoom',
          platformParticipantId: userId,
          displayName: userName,
          identitySource: 'platform_native',
          confidence: 1.0
        });
      }
    }

    let buffer = this.transcriptBuffers.get(userId);
    if (!buffer) {
      buffer = {
        userId,
        userName,
        startTime: typeof fragment.start_time === 'number' ? fragment.start_time : 0,
        endTime: typeof fragment.end_time === 'number' ? fragment.end_time : 0,
        textParts: [],
        timer: null
      };
      this.transcriptBuffers.set(userId, buffer);
    }

    buffer.textParts.push(text);
    buffer.endTime = typeof fragment.end_time === 'number' ? fragment.end_time : buffer.endTime + 1;

    // Reset silence flush timer
    if (buffer.timer) clearTimeout(buffer.timer);

    if (fragment.is_final) {
      this.flushUserFragment(userId);
    } else {
      buffer.timer = setTimeout(() => {
        this.flushUserFragment(userId);
      }, this.FRAGMENT_FLUSH_INTERVAL_MS);
    }
  }

  /**
   * Flush and emit assembled utterance for a user
   */
  flushUserFragment(userId) {
    const buffer = this.transcriptBuffers.get(userId);
    if (!buffer || buffer.textParts.length === 0) return;

    if (buffer.timer) clearTimeout(buffer.timer);

    const fullText = buffer.textParts.join(' ').replace(/\s+/g, ' ').trim();
    const participant = this.registry ? this.registry.resolveZoomUser(userId) : null;

    const segment = new AttributedTranscriptSegment({
      meetingId: this.meetingId,
      participantId: participant ? participant.id : `zoom_${userId}`,
      speakerId: `zoom_${userId}`,
      displayName: buffer.userName,
      role: participant ? participant.role : 'unknown',
      organization: participant ? participant.organization : null,
      startTime: buffer.startTime,
      endTime: buffer.endTime,
      text: fullText,
      confidence: 0.98,
      attributionSource: 'platform_transcript',
      attributionConfidence: 1.0,
      transcriptionSource: 'zoom_rtms_transcript'
    });

    this.transcriptBuffers.delete(userId);
    this.emit('attributed_segment', segment);
    return segment;
  }

  flushAllFragments() {
    for (const userId of this.transcriptBuffers.keys()) {
      this.flushUserFragment(userId);
    }
  }
}

export default ZoomRtmsAdapter;
