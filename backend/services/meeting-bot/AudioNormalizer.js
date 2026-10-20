/**
 * AudioNormalizer.js
 * Validates, normalizes, and manages lifecycle/retention of meeting audio files.
 */

import fs from 'node:fs';
import path from 'node:path';

// Magic bytes for popular audio container formats
const MAGIC_SIGNATURES = [
  { format: 'webm', bytes: [0x1A, 0x45, 0xDF, 0xA3] }, // EBML header (WebM/MKV)
  { format: 'wav', bytes: [0x52, 0x49, 0x46, 0x46] },  // RIFF header
  { format: 'mp3', bytes: [0x49, 0x44, 0x33] },        // ID3v2 header
  { format: 'mp3_sync', bytes: [0xFF, 0xFB] },         // MPEG-1 Layer 3 syncword
  { format: 'ogg', bytes: [0x4F, 0x67, 0x67, 0x53] },  // OggS
  { format: 'flac', bytes: [0x66, 0x4C, 0x61, 0x43] }, // fLaC
];

const ALLOWED_MIME_TYPES = new Set([
  'audio/webm',
  'audio/wav',
  'audio/x-wav',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/ogg',
  'audio/flac',
  'video/webm',
  'video/mp4',
  'application/octet-stream',
]);

export class AudioNormalizer {
  /**
   * Validate audio file for MIME, non-emptiness, size limits, and header validity.
   * @param {string} filePath - Absolute path to audio file
   * @param {Object} [options]
   * @param {number} [options.maxSizeBytes=500 * 1024 * 1024]
   * @param {number} [options.minSizeBytes=100]
   * @returns {{ valid: boolean, format?: string, sizeBytes?: number, error?: string, message?: string }}
   */
  static validateAudioFile(filePath, options = {}) {
    const maxSizeBytes = options.maxSizeBytes || 500 * 1024 * 1024; // 500MB
    const minSizeBytes = options.minSizeBytes || 64;

    if (!filePath || typeof filePath !== 'string') {
      return {
        valid: false,
        error: 'INVALID_PATH',
        message: 'Audio file path was not provided or is invalid.',
      };
    }

    if (!fs.existsSync(filePath)) {
      return {
        valid: false,
        error: 'FILE_NOT_FOUND',
        message: `Audio file does not exist at path: ${filePath}`,
      };
    }

    let stats;
    try {
      stats = fs.statSync(filePath);
    } catch (err) {
      return {
        valid: false,
        error: 'IO_ERROR',
        message: `Cannot access audio file metadata: ${err.message}`,
      };
    }

    if (stats.size === 0) {
      return {
        valid: false,
        error: 'EMPTY_AUDIO',
        message: 'The captured audio file is empty (0 bytes).',
      };
    }

    if (stats.size < minSizeBytes) {
      return {
        valid: false,
        error: 'CORRUPTED_AUDIO',
        message: `The audio file size (${stats.size} bytes) is too small to contain valid audio data.`,
      };
    }

    if (stats.size > maxSizeBytes) {
      return {
        valid: false,
        error: 'FILE_TOO_LARGE',
        message: `Audio file exceeds maximum size limit of ${Math.round(maxSizeBytes / (1024 * 1024))}MB.`,
      };
    }

    // Inspect initial header bytes
    let detectedFormat = 'unknown';
    try {
      const buffer = Buffer.alloc(16);
      const fd = fs.openSync(filePath, 'r');
      fs.readSync(fd, buffer, 0, 16, 0);
      fs.closeSync(fd);

      for (const sig of MAGIC_SIGNATURES) {
        const matches = sig.bytes.every((b, i) => buffer[i] === b);
        if (matches) {
          detectedFormat = sig.format;
          break;
        }
      }

      // Accept the variable MPEG audio sync pattern used by valid MP3 frame headers.
      if (detectedFormat === 'unknown' && buffer[0] === 0xFF && (buffer[1] & 0xE0) === 0xE0) {
        detectedFormat = 'mp3_sync';
      }

      // RIFF alone is not sufficient: WAV containers include the WAVE form identifier.
      if (detectedFormat === 'wav' && buffer.toString('ascii', 8, 12) !== 'WAVE') {
        detectedFormat = 'unknown';
      }

      // MP4 / M4A ftyp check at offset 4
      if (detectedFormat === 'unknown' && buffer.toString('utf8', 4, 8) === 'ftyp') {
        detectedFormat = 'm4a';
      }

      if (detectedFormat === 'unknown') {
        return {
          valid: false,
          error: 'INVALID_AUDIO_HEADER',
          message: 'The uploaded file does not have a recognized audio/video container header.',
        };
      }
    } catch (headerErr) {
      return {
        valid: false,
        error: 'HEADER_READ_FAILED',
        message: `Unable to read audio file header: ${headerErr.message}`,
      };
    }

    return {
      valid: true,
      format: detectedFormat,
      sizeBytes: stats.size,
    };
  }

  /**
   * Check if raw audio storage retention is enabled via environment.
   * STORE_RAW_AUDIO=true / false
   */
  static shouldStoreRawAudio() {
    return process.env.STORE_RAW_AUDIO === 'true';
  }

  /**
   * Safely cleanup temporary audio file if retention policy allows.
   * @param {string} filePath
   * @param {Object} logger
   */
  static cleanupTemporaryAudio(filePath, logger = console) {
    if (this.shouldStoreRawAudio()) {
      logger.info?.(`[AudioRetention] Retaining raw audio file: ${filePath}`);
      return;
    }

    try {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        logger.info?.(`[AudioRetention] Cleaned up temporary audio file: ${filePath}`);
      }
    } catch (err) {
      logger.warn?.(`[AudioRetention] Failed to delete temporary audio file: ${err.message}`);
    }
  }

  /**
   * Generate a 100% pure silent PCM WAV file (no beeps, zero amplitude).
   * Used for fake microphone capture devices and clean silence padding.
   */
  static generateSilentWav(outputPath, durationSeconds = 3) {
    const sampleRate = 16000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const numSamples = Math.floor(sampleRate * durationSeconds);
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const dataSize = numSamples * blockAlign;
    const buffer = Buffer.alloc(44 + dataSize); // Buffer.alloc initializes with zeroes (pure silence)

    // RIFF header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);

    // fmt subchunk
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20); // PCM
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE((sampleRate * numChannels * bitsPerSample) / 8, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);

    // data subchunk
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outputPath, buffer);
    return outputPath;
  }

  /**
   * Generate a standard sample audio WAV file for mock testing or test suites.
   * Writes clean valid PCM WAV so Whisper/pipeline won't crash on invalid data.
   */
  static generateTestWav(outputPath, durationSeconds = 3, includeTone = false) {
    if (!includeTone) {
      return this.generateSilentWav(outputPath, durationSeconds);
    }

    const sampleRate = 16000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const numSamples = Math.floor(sampleRate * durationSeconds);
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const dataSize = numSamples * blockAlign;
    const buffer = Buffer.alloc(44 + dataSize);

    // RIFF header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);

    // fmt subchunk
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);

    // data subchunk
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const sample = Math.sin(2 * Math.PI * 440 * t) * 4000;
      buffer.writeInt16LE(Math.floor(sample), 44 + i * 2);
    }

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outputPath, buffer);
    return outputPath;
  }

  /**
   * Convert or remux captured audio (e.g. streaming WebM/Opus) into a universally seekable broadcast MP3 format.
   * Ensures 100% compatibility with HTML5 browser <audio> players and STT models.
   * @param {string} inputPath
   * @param {string} outputPath
   * @param {Object} [logger=console]
   * @returns {Promise<string>} Output audio path
   */
  static async remuxToMp3(inputPath, outputPath, logger = console) {
    if (!inputPath || !fs.existsSync(inputPath)) {
      return inputPath;
    }

    try {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execFileAsync = promisify(execFile);

      const targetDir = path.dirname(outputPath);
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

      // Remux to high-quality MP3 with seekable standard headers
      await execFileAsync('ffmpeg', [
        '-y',
        '-i', inputPath,
        '-c:a', 'libmp3lame',
        '-q:a', '2',
        outputPath
      ]);

      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 64) {
        logger.info?.(`[AudioNormalizer] Successfully remuxed ${path.basename(inputPath)} to seekable MP3: ${path.basename(outputPath)} (${fs.statSync(outputPath).size} bytes)`);
        return outputPath;
      }
    } catch (err) {
      logger.warn?.(`[AudioNormalizer] FFmpeg remuxing notice: ${err.message}. Retaining raw audio.`);
    }

    return inputPath;
  }
}

