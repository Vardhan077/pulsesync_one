/**
 * filenameResolver.js
 * 
 * Production-ready, concurrency-safe filename conflict resolution and atomic storage claiming.
 * 
 * Rules:
 * 1. Safe extraction of stem and extension (supporting multiple dots, e.g. North.Daniel.test.mp3 -> North.Daniel.test(1).mp3).
 * 2. Case-insensitive comparison against existing files in UPLOADS_DIR and database audio_url records.
 * 3. Gap-filling sequential numbering: checks candidate(0) = original, candidate(1) = base(1).ext, candidate(2) = base(2).ext, etc.
 * 4. Concurrency safety via atomic exclusive file creation (fs.constants.COPYFILE_EXCL / fs.openSync('wx')) with retry loop.
 * 5. Isolation: audio files are never overwritten; internal record identities (UUIDs) remain strictly separated.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Sanitize a user-provided filename to prevent directory traversal or invalid filesystem characters.
 * @param {string} originalName 
 * @returns {string} Sanitized filename
 */
export function sanitizeFilename(originalName) {
  if (!originalName || typeof originalName !== 'string') {
    return 'audio_recording.mp3';
  }
  // Strip path traversal and normalize basename
  let base = path.basename(originalName.trim());
  // Replace illegal filesystem characters on Windows and POSIX (\ / : * ? " < > | null)
  base = base.replace(/[/\\?%*:|"<>]/g, '_');
  // Strip control characters
  base = base.replace(/[\x00-\x1f\x80-\x9f]/g, '');
  // Trim leading/trailing dots and spaces
  base = base.replace(/^[\s.]+|[\s.]+$/g, '');
  if (!base) {
    base = 'audio_recording.mp3';
  }
  return base;
}

/**
 * Split a filename into its stem and extension, correctly handling multiple dots.
 * E.g., 'North.Daniel.test.mp3' -> { stem: 'North.Daniel.test', ext: '.mp3' }
 * @param {string} filename 
 * @returns {{ stem: string, ext: string }}
 */
export function splitFilename(filename) {
  const sanitized = sanitizeFilename(filename);
  const ext = path.extname(sanitized);
  const stem = ext ? sanitized.slice(0, sanitized.length - ext.length) : sanitized;
  return { stem: stem || 'recording', ext: ext || '' };
}

/**
 * Generate a candidate numbered filename based on the incoming stem, extension, and counter.
 * Counter 0: original stem + ext (e.g. North_Daniel_test.mp3)
 * Counter 1: stem(1).ext (e.g. North_Daniel_test(1).mp3)
 * Counter 2: stem(2).ext (e.g. North_Daniel_test(2).mp3)
 * 
 * If stem already has a trailing (N) like 'customer_call(1)', we normalize to base 'customer_call'
 * so that subsequent uploads become 'customer_call(2).wav', while still testing sequential slots.
 * 
 * @param {string} originalName 
 * @param {number} counter 
 * @returns {string}
 */
export function getNumberedCandidate(originalName, counter) {
  const { stem, ext } = splitFilename(originalName);
  if (counter === 0) {
    return `${stem}${ext}`;
  }

  // Check if stem already ends with (N)
  const match = stem.match(/^(.*?)(?:\((\d+)\))$/);
  if (match) {
    const baseStem = match[1];
    const initialNum = parseInt(match[2], 10);
    // If incoming had (1), counter 1 gives (initialNum + counter) e.g. (2)
    const nextNum = initialNum + counter;
    return `${baseStem}(${nextNum})${ext}`;
  }

  return `${stem}(${counter})${ext}`;
}

/**
 * Scan a directory for existing filenames in a case-insensitive manner.
 * @param {string} dirPath 
 * @returns {Set<string>} Lowercase filenames
 */
export function getExistingDirectoryFilenames(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      return new Set();
    }
    const entries = fs.readdirSync(dirPath);
    return new Set(entries.map(e => e.toLowerCase()));
  } catch {
    return new Set();
  }
}

/**
 * Atomically claim and persist an uploaded file to a unique filename in targetDir.
 * If targetFilename already exists or is taken concurrently, it increments through
 * sequential numbering until an available slot is atomically secured without overwriting.
 * 
 * @param {Object} options
 * @param {string} options.tempFilePath - Path to the temporarily staged upload
 * @param {string} options.targetDir - Destination directory (e.g. UPLOADS_DIR)
 * @param {string} options.originalFilename - Filename provided by the client
 * @param {Set<string>|Array<string>} [options.knownConflicts] - Optional set/array of DB audio filenames
 * @param {number} [options.maxAttempts=1000] - Circuit breaker
 * @returns {Promise<{ filename: string, filePath: string, originalFilename: string }>}
 */
export async function claimUniqueFilename({
  tempFilePath,
  targetDir,
  originalFilename,
  knownConflicts = new Set(),
  maxAttempts = 1000,
}) {
  if (!tempFilePath || !fs.existsSync(tempFilePath)) {
    throw new Error(`Temp upload file not found at: ${tempFilePath}`);
  }

  fs.mkdirSync(targetDir, { recursive: true });

  const sanitizedOriginal = sanitizeFilename(originalFilename);
  const existingFilesLower = getExistingDirectoryFilenames(targetDir);

  const dbConflictsLower = new Set(
    (Array.isArray(knownConflicts) ? knownConflicts : Array.from(knownConflicts || []))
      .map(f => (typeof f === 'string' ? path.basename(f).toLowerCase() : ''))
      .filter(Boolean)
  );

  let counter = 0;
  while (counter < maxAttempts) {
    const candidateName = getNumberedCandidate(sanitizedOriginal, counter);
    const candidateLower = candidateName.toLowerCase();

    // Check pre-flight conflicts in directory and database records
    const inDir = existingFilesLower.has(candidateLower);
    const inDb = dbConflictsLower.has(candidateLower);

    if (!inDir && !inDb) {
      const candidatePath = path.join(targetDir, candidateName);

      // Concurrency guard: attempt exclusive file creation
      try {
        // fs.copyFileSync with COPYFILE_EXCL fails with EEXIST if the file exists on disk
        fs.copyFileSync(tempFilePath, candidatePath, fs.constants.COPYFILE_EXCL);
        
        // Remove temp file after successful atomic copy
        try {
          fs.unlinkSync(tempFilePath);
        } catch {
          // Best effort cleanup
        }

        return {
          filename: candidateName,
          filePath: candidatePath,
          originalFilename: sanitizedOriginal,
        };
      } catch (err) {
        if (err.code === 'EEXIST') {
          // Concurrent worker grabbed this filename in the race window; record collision and continue
          existingFilesLower.add(candidateLower);
          counter++;
          continue;
        }
        throw err;
      }
    }

    counter++;
  }

  throw new Error(`Failed to generate a unique filename for "${sanitizedOriginal}" after ${maxAttempts} attempts.`);
}
