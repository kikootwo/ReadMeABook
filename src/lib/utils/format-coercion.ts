/**
 * Component: Plex Format Coercion
 * Documentation: documentation/phase3/file-organization.md
 *
 * Renames audio files in-place after organization to formats Plex's audiobook
 * library recognizes silently. No transcoding — extension-swap only.
 *
 * Behavior (issue #166):
 * - `.mp4` → `.m4b` (always)
 * - `.m4a` → `.m4b` only when it's the only audio file in its directory (single-file audiobook)
 * - DRM (`.aa`/`.aax`) → warn + skip (cannot decode without keys)
 * - Transcode-required (`.ogg`/`.opus`/`.wma`) → warn + skip (out of scope for v1)
 * - Already Plex-compatible or unrecognized → silent no-op
 * - Target path already exists → no-op + info log (never overwrite)
 *
 * Idempotency signal is the file extension itself — no marker files, no DB column.
 * Failure mode: any per-file error is captured as a warning and the original path
 * is retained in `finalAudioFiles`; never throws.
 */

import { promises as fs } from 'fs';
import path from 'path';

import {
  DRM_EXTENSIONS,
  PLEX_COMPATIBLE_EXTENSIONS,
  TRANSCODE_REQUIRED_EXTENSIONS,
} from '../constants/audio-formats';
import type { RMABLogger } from './logger';

/**
 * Result of a coercion pass over a set of audio file paths.
 *
 * - `renamed`: every successful rename, in input order
 * - `warnings`: human-readable reasons for non-rename outcomes (DRM, transcode, collision, EPERM, ...)
 * - `errors`: reserved for future hard-error reporting; currently unused (we degrade to warnings)
 * - `finalAudioFiles`: the post-coercion path list, 1:1 with the input order.
 *   Always populated — caller can blindly assign `result.audioFiles = coercion.finalAudioFiles`.
 */
export interface CoercionResult {
  renamed: Array<{ from: string; to: string }>;
  warnings: string[];
  errors: string[];
  finalAudioFiles: string[];
}

const DRM_SET: ReadonlySet<string> = new Set(DRM_EXTENSIONS as readonly string[]);
const TRANSCODE_SET: ReadonlySet<string> = new Set(
  TRANSCODE_REQUIRED_EXTENSIONS as readonly string[],
);
const PLEX_COMPATIBLE_SET: ReadonlySet<string> = new Set(
  PLEX_COMPATIBLE_EXTENSIONS as readonly string[],
);

/**
 * Coerce the given audio files to Plex-compatible formats by extension rename.
 *
 * Never throws. Per-file failures are recorded in `warnings` and the original
 * path is preserved in `finalAudioFiles` at the same index.
 *
 * @param audioFilePaths Absolute paths to audio files (already organized into the target media dir).
 * @param logger         Optional `RMABLogger` for per-file and per-warning visibility.
 * @returns Structured `CoercionResult`. Caller should overwrite its audio-file list with `finalAudioFiles`.
 */
export async function coerceToPlexCompatible(
  audioFilePaths: string[],
  logger?: RMABLogger,
): Promise<CoercionResult> {
  const renamed: Array<{ from: string; to: string }> = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const finalAudioFiles: string[] = [];

  if (!Array.isArray(audioFilePaths) || audioFilePaths.length === 0) {
    return { renamed, warnings, errors, finalAudioFiles };
  }

  // Count `.m4a` siblings per directory so we can distinguish single-file
  // (rename to .m4b) from multi-file (leave alone) m4a books.
  const m4aCountByDir = new Map<string, number>();
  for (const filePath of audioFilePaths) {
    if (path.extname(filePath).toLowerCase() === '.m4a') {
      const dir = path.dirname(filePath);
      m4aCountByDir.set(dir, (m4aCountByDir.get(dir) ?? 0) + 1);
    }
  }

  for (const originalPath of audioFilePaths) {
    const ext = path.extname(originalPath).toLowerCase();
    let targetExt: string | null = null;

    if (ext === '.mp4') {
      targetExt = '.m4b';
    } else if (ext === '.m4a') {
      const dir = path.dirname(originalPath);
      const siblingCount = m4aCountByDir.get(dir) ?? 0;
      if (siblingCount === 1) {
        targetExt = '.m4b';
      } else {
        // Multi-file .m4a audiobook — leave alone.
        finalAudioFiles.push(originalPath);
        continue;
      }
    } else if (DRM_SET.has(ext)) {
      const msg = `DRM format ${ext} cannot be decoded; Plex will not import "${path.basename(originalPath)}"`;
      warnings.push(msg);
      logger?.warn(`Plex format coercion: ${msg}`);
      finalAudioFiles.push(originalPath);
      continue;
    } else if (TRANSCODE_SET.has(ext)) {
      const msg = `Format ${ext} requires transcode; not supported in this version (file: "${path.basename(originalPath)}")`;
      warnings.push(msg);
      logger?.warn(`Plex format coercion: ${msg}`);
      finalAudioFiles.push(originalPath);
      continue;
    } else if (PLEX_COMPATIBLE_SET.has(ext)) {
      // Already Plex-compatible — silent no-op.
      finalAudioFiles.push(originalPath);
      continue;
    } else {
      // Unknown extension — leave alone. Not our job to filter detection.
      finalAudioFiles.push(originalPath);
      continue;
    }

    // We have a rename target. Compose the new path by swapping just the extension.
    const dir = path.dirname(originalPath);
    const base = path.basename(originalPath, path.extname(originalPath));
    const targetPath = path.join(dir, `${base}${targetExt}`);

    // Pre-rename collision check — never overwrite.
    try {
      await fs.access(targetPath);
      const msg = `target already exists, skipping rename: "${path.basename(targetPath)}"`;
      warnings.push(msg);
      logger?.info(`Plex format coercion: ${msg}`);
      finalAudioFiles.push(originalPath);
      continue;
    } catch {
      // Target does not exist — proceed with rename.
    }

    try {
      await fs.rename(originalPath, targetPath);
      renamed.push({ from: originalPath, to: targetPath });
      finalAudioFiles.push(targetPath);
      logger?.info(
        `Plex format coercion: renamed "${path.basename(originalPath)}" → "${path.basename(targetPath)}"`,
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown error';
      const msg = `failed to rename "${path.basename(originalPath)}" → "${path.basename(targetPath)}": ${reason}`;
      warnings.push(msg);
      logger?.warn(`Plex format coercion: ${msg}`);
      finalAudioFiles.push(originalPath);
    }
  }

  return { renamed, warnings, errors, finalAudioFiles };
}
