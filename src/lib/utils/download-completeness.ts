/**
 * Component: Download Completeness Check
 * Documentation: documentation/backend/services/list-sync.md
 *
 * Automatic search already skips releases too small for a book's runtime, but a release can still slip
 * through (RSS matches, manual picks, a single part of a multi-file usenet post that SABnzbd reports as
 * complete). This check runs at import time: audio far smaller than the runtime allows is refused
 * instead of being imported as a whole book.
 */

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { AUTO_SEARCH_MIN_MB_PER_MINUTE } from './ranking-algorithm';

/** Configuration key: MB of audio per minute of runtime below which an import is refused (0 = off) */
export const IMPORT_MIN_MB_PER_MINUTE_KEY = 'import_min_mb_per_minute';
export const DEFAULT_IMPORT_MIN_MB_PER_MINUTE = AUTO_SEARCH_MIN_MB_PER_MINUTE;

/** Downloads at or above this size are never checked (about 60 hours at the floor), which skips the runtime lookup */
export const MAX_BYTES_TO_CHECK_COMPLETENESS = 600 * 1024 * 1024;

const AUDIO_EXTENSIONS = /\.(mp3|m4b|m4a|aac|flac|ogg|opus|wma|wav)$/i;
const MAX_DEPTH = 4;

/** Total bytes of audio files at a path (a single file, or a folder searched a few levels deep). */
export async function audioBytes(target: string, depth = 0): Promise<number> {
  let info;
  try {
    info = await stat(target);
  } catch {
    return 0;
  }
  if (info.isFile()) return AUDIO_EXTENSIONS.test(target) ? info.size : 0;
  if (!info.isDirectory() || depth >= MAX_DEPTH) return 0;

  let total = 0;
  for (const entry of await readdir(target)) {
    total += await audioBytes(path.join(target, entry), depth + 1);
  }
  return total;
}

/**
 * Why a download is too small for the book, or null when it is fine (or cannot be judged).
 * Needs a known runtime; with none, or a floor of 0, nothing is refused.
 */
export function truncatedDownloadReason(bytes: number, runtimeMinutes: number | undefined, minMbPerMinute: number): string | null {
  if (!runtimeMinutes || runtimeMinutes <= 0 || minMbPerMinute <= 0 || bytes <= 0) return null;
  const floorMb = runtimeMinutes * minMbPerMinute;
  const actualMb = bytes / (1024 * 1024);
  if (actualMb >= floorMb) return null;
  const hours = Math.round((runtimeMinutes / 60) * 10) / 10;
  return `Incomplete download: ${Math.round(actualMb)} MB of audio for a ${hours}-hour book (expected at least ${Math.round(floorMb)} MB). It is probably one part of a multi-file release`;
}
