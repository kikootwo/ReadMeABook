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
 * - Only files that hold this import's content (`copied`, or `identical` e.g. after
 *   a crash and retry) are renamed; other library files (`present`, `differs`) are
 *   never touched
 * - The rename never replaces: hard link + unlink (EEXIST = leave both as they are),
 *   under the same per-target lock as placement, so a `.m4b` another organize job
 *   just placed is never overwritten. A crash between link and unlink leaves both
 *   names on one file; the next run sees that and drops the old name.
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
import { LINK_UNSUPPORTED, sameIdentity } from './copy-file';
import type { PlacementRecord } from './import-inventory';
import type { RMABLogger } from './logger';
import { withTargetLock } from './organize-copy';

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

/**
 * Library paths coercion may rename: those holding this import's content,
 * copied now or `identical` (e.g. an earlier attempt's copy after a crash).
 * `present` (same size, never compared) and `differs` files are not ours.
 */
export function coercibleTargets(records: PlacementRecord[]): Set<string> {
  return new Set(records.filter((r) => r.status === 'copied' || r.status === 'identical').map((r) => r.target));
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
 * @param audioFilePaths   Absolute paths to audio files (already organized into the target media dir).
 * @param placedThisImport Paths holding this import's content (`copied`/`identical`); every other path is left as it is.
 * @param logger           Optional `RMABLogger` for per-file and per-warning visibility.
 * @returns Structured `CoercionResult`. Caller should overwrite its audio-file list with `finalAudioFiles`.
 */
export async function coerceToPlexCompatible(
  audioFilePaths: string[],
  placedThisImport: ReadonlySet<string>,
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

  const placed = new Set([...placedThisImport].map((p) => path.resolve(p)));

  for (const originalPath of audioFilePaths) {
    const ext = path.extname(originalPath).toLowerCase();
    let targetExt: string | null = null;

    if (!placed.has(path.resolve(originalPath))) {
      // In the library before this import: not ours to rename
      finalAudioFiles.push(originalPath);
      continue;
    }

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

    try {
      const outcome = await withTargetLock(targetPath, () => renameWithoutReplacing(originalPath, targetPath));
      if (outcome === 'exists') {
        const msg = `target already exists, skipping rename: "${path.basename(targetPath)}"`;
        warnings.push(msg);
        logger?.info(`Plex format coercion: ${msg}`);
        finalAudioFiles.push(originalPath);
        continue;
      }
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

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** True when both paths are regular files (not symlinks) with the same dev/ino: two names of one file. */
async function sameRegularFile(a: string, b: string): Promise<boolean> {
  try {
    const [sa, sb] = await Promise.all([fs.lstat(a, { bigint: true }), fs.lstat(b, { bigint: true })]);
    return sa.isFile() && sb.isFile() && sameIdentity(sa, sb);
  } catch {
    return false;
  }
}

/** Drop the old name once `to` holds the file. If that fails while `from` still exists, undo the link. */
async function dropOldName(from: string, to: string): Promise<void> {
  try {
    await fs.unlink(from);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // Already gone: `to` is the last name of the file, so it stays
      return;
    }
    if (await pathExists(from).catch(() => false)) {
      // Keep the file under the name it was placed with only
      await fs.unlink(to).catch(() => undefined);
    }
    throw error;
  }
}

/**
 * Move `from` to `to` without ever replacing an existing `to`: hard-link (EEXIST
 * when `to` exists), then drop the old name. An existing `to` that is the same
 * file (a run that stopped between link and unlink) only needs the old name
 * dropped. Filesystems without hard links fall back to an lstat check and
 * rename; the caller holds the per-target lock, so no in-process placement can
 * land in between. 'exists' means nothing changed.
 */
async function renameWithoutReplacing(from: string, to: string): Promise<'renamed' | 'exists'> {
  try {
    await fs.link(from, to);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code || '';
    if (code === 'EEXIST') {
      if (!(await sameRegularFile(from, to))) return 'exists';
      await dropOldName(from, to);
      return 'renamed';
    }
    if (!LINK_UNSUPPORTED.has(code)) throw error;
    if (await pathExists(to)) return 'exists';
    await fs.rename(from, to);
    return 'renamed';
  }
  await dropOldName(from, to);
  return 'renamed';
}
