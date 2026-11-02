/**
 * File Hash Utility
 * Documentation: documentation/fixes/file-hash-matching.md
 *
 * Generates deterministic hashes of audio file collections for accurate library matching.
 * Used to match RMAB-organized audiobooks with Audiobookshelf library items.
 */

import crypto from 'crypto';
import path from 'path';
import { AUDIO_EXTENSIONS } from '../constants/audio-formats';

/** True when the file name has a supported audio extension (any case). */
export function isAudioFilename(name: string): boolean {
  return (AUDIO_EXTENSIONS as readonly string[]).includes(path.extname(name).toLowerCase());
}

/**
 * Generates a SHA256 hash of audio filenames for library matching.
 *
 * Process:
 * 1. Extract basenames from file paths
 * 2. Filter to supported audio extensions
 * 3. Normalize to lowercase
 * 4. Sort alphabetically
 * 5. Generate SHA256 hash
 *
 * @param filePaths - Array of absolute or relative file paths
 * @returns 64-character hex string (SHA256 hash) or empty string if no audio files
 *
 * @example
 * ```typescript
 * const hash = generateFilesHash([
 *   '/path/to/Chapter 01.mp3',
 *   '/path/to/Chapter 02.mp3',
 *   '/path/to/cover.jpg'  // Filtered out (not audio)
 * ]);
 * // Returns: "abc123def456..." (64 chars)
 * ```
 */
export function generateFilesHash(filePaths: string[]): string {
  if (!filePaths || filePaths.length === 0) {
    return '';
  }

  // Extract basenames and filter to audio files only
  const audioBasenames = filePaths
    .map((filePath) => {
      // Normalize path separators to forward slashes for cross-platform consistency
      const normalizedPath = filePath.replace(/\\/g, '/');
      return path.posix.basename(normalizedPath);
    })
    .filter(isAudioFilename)
    .map((basename) => basename.toLowerCase()) // Normalize case
    .sort(); // Sort alphabetically for deterministic hash

  // No audio files found
  if (audioBasenames.length === 0) {
    return '';
  }

  // Generate SHA256 hash
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify(audioBasenames))
    .digest('hex');

  return hash;
}

/**
 * Validates if a hash string is a valid SHA256 hash
 */
export function isValidHash(hash: string): boolean {
  return /^[a-f0-9]{64}$/i.test(hash);
}
