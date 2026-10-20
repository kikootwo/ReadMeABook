/**
 * Component: Verified File Placement (copy into the library and prove it landed)
 * Documentation: documentation/phase3/file-organization.md
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { copyFile, filesEqual, isSameFile, PARTIAL_FILE_PATTERN, partialNameHash, sameLeadingBytes } from './copy-file';
import type { PlacementStatus } from './import-inventory';

const STALE_PARTIAL_MS = 24 * 60 * 60 * 1000;

/** Allowed difference between a tagged copy's duration and its original's. */
export const TAGGED_DURATION_TOLERANCE_MS = 1000;

export interface PlaceOptions {
  fileMode: number;
  /** Compare same-size existing targets byte-for-byte (only worth it when a delete depends on the answer). */
  compareExisting: boolean;
}

export interface PlaceResult {
  status: PlacementStatus;
  /** Path the content lives at (an existing Plex-coerced .m4b counts as the target). */
  target: string;
  reason?: string;
}

/**
 * Remove leftover partial files in `dir`: those for this target name, and any
 * older than 24 h. Only regular files matching the exact partial pattern in
 * that one folder are touched.
 */
export async function removeStalePartials(dir: string, targetName: string): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const hash = partialNameHash(targetName);
  const now = Date.now();
  for (const entry of entries) {
    const match = PARTIAL_FILE_PATTERN.exec(entry.name);
    if (!match || !entry.isFile()) continue;
    const full = path.join(dir, entry.name);
    try {
      const stat = await fs.lstat(full);
      if (!stat.isFile()) continue;
      if (match[1] === hash || now - stat.mtimeMs > STALE_PARTIAL_MS) {
        await fs.unlink(full);
      }
    } catch {
      // Raced with another cleanup
    }
  }
}

/** Existing library entry for `target`, including the .m4b name Plex format coercion renames .mp4/.m4a to. */
async function findExistingTarget(target: string): Promise<string | null> {
  const candidates = [target];
  const ext = path.extname(target).toLowerCase();
  if (ext === '.mp4' || ext === '.m4a') {
    candidates.push(path.join(path.dirname(target), `${path.basename(target, path.extname(target))}.m4b`));
  }
  for (const candidate of candidates) {
    try {
      await fs.lstat(candidate);
      return candidate;
    } catch {
      // Not there
    }
  }
  return null;
}

async function copyInto(
  source: string,
  target: string,
  fileMode: number,
  mode: 'create' | 'replace'
): Promise<PlaceResult & { exists?: boolean }> {
  try {
    await copyFile(source, target, { mode });
    await fs.chmod(target, fileMode).catch(() => undefined);
    return { status: 'copied', target };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return { status: 'failed', target, reason: 'target appeared during the copy', exists: true };
    }
    return { status: 'failed', target, reason: error instanceof Error ? error.message : String(error) };
  }
}

// Placements into the same target (any extension: .mp4 and its coerced .m4b) run one at a time
const targetLocks = new Map<string, Promise<void>>();

async function withTargetLock<T>(target: string, fn: () => Promise<T>): Promise<T> {
  const key = path.join(path.resolve(path.dirname(target)), path.basename(target, path.extname(target))).toLowerCase();
  const previous = targetLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => mine);
  targetLocks.set(key, tail);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (targetLocks.get(key) === tail) targetLocks.delete(key);
  }
}

/**
 * Place `source` at `target`.
 *
 * Existing targets are never trusted by name alone:
 * - not a regular file (symlink, directory, ...): `differs`, never overwritten
 * - same regular file as the source (hard links fine): `identical`
 * - smaller and a byte-prefix of the source (interrupted copy): re-copied
 * - same size: `identical` / `differs` by content when compareExisting, else `present`
 * - anything else: `differs`, never overwritten
 *
 * A new target is published without overwriting (hard link, EEXIST-safe), so
 * two jobs placing the same name never replace each other's file: the second
 * sees the first one's file and applies the rules above to it.
 */
export async function placeFile(source: string, target: string, options: PlaceOptions): Promise<PlaceResult> {
  return withTargetLock(target, () => placeUnlocked(source, target, options, true));
}

async function placeUnlocked(source: string, target: string, options: PlaceOptions, retryOnRace: boolean): Promise<PlaceResult> {
  await removeStalePartials(path.dirname(target), path.basename(target));

  const existing = await findExistingTarget(target);
  if (!existing) {
    const created = await copyInto(source, target, options.fileMode, 'create');
    if (created.exists && retryOnRace) {
      return placeUnlocked(source, target, options, false);
    }
    const { exists: _exists, ...result } = created;
    void _exists;
    return result;
  }

  let targetStat;
  let sourceStat;
  try {
    targetStat = await fs.lstat(existing);
    sourceStat = await fs.stat(source);
  } catch (error) {
    return { status: 'failed', target: existing, reason: error instanceof Error ? error.message : String(error) };
  }

  if (!targetStat.isFile()) {
    return { status: 'differs', target: existing, reason: 'existing target is not a regular file' };
  }
  if (await isSameRegularFile(source, existing)) {
    return { status: 'identical', target: existing };
  }

  try {
    if (targetStat.size < sourceStat.size) {
      if (await sameLeadingBytes(existing, source, targetStat.size)) {
        // Only an interrupted copy of this exact source leaves a byte-prefix behind
        const { exists: _exists, ...result } = await copyInto(source, existing, options.fileMode, 'replace');
        void _exists;
        return result;
      }
      return { status: 'differs', target: existing, reason: 'existing target is smaller and not a prefix of the source' };
    }
    if (targetStat.size === sourceStat.size) {
      if (!options.compareExisting) {
        return { status: 'present', target: existing };
      }
      return (await filesEqual(existing, source))
        ? { status: 'identical', target: existing }
        : { status: 'differs', target: existing, reason: 'existing target has different content' };
    }
    return { status: 'differs', target: existing, reason: 'existing target is larger than the source' };
  } catch (error) {
    return { status: 'failed', target: existing, reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * True when `target` is itself a regular file (not a symlink) and the same
 * file as `source`: the same path or a hard link. isSameFile alone follows
 * symlinks, and a library symlink to the download is not a copy of it.
 */
async function isSameRegularFile(source: string, target: string): Promise<boolean> {
  try {
    if (!(await fs.lstat(target)).isFile()) return false;
  } catch {
    return false;
  }
  return isSameFile(source, target);
}

/** True when `status` means the content is proven to be at the target. */
export function isVerifiedStatus(status: PlacementStatus): boolean {
  return status === 'copied' || status === 'identical';
}

// =========================================================================
// AUDIO PLACEMENT (original or tagged derivative)
// =========================================================================

export interface AudioPlaceOptions extends PlaceOptions {
  /** Audio duration in ms (from stream packets); throws or returns <= 0 when it cannot be probed. */
  probeDuration: (filePath: string) => Promise<number>;
}

export interface AudioPlacement extends PlaceResult {
  verified: boolean;
  /** True when the library holds the tagged derivative rather than the original bytes. */
  usedDerivative: boolean;
}

async function durationsMatch(original: string, derivative: string, probe: (p: string) => Promise<number>): Promise<boolean> {
  try {
    const a = await probe(original);
    const b = await probe(derivative);
    return a > 0 && b > 0 && Math.abs(a - b) <= TAGGED_DURATION_TOLERANCE_MS;
  } catch {
    return false;
  }
}

async function placeOriginal(original: string, target: string, options: PlaceOptions): Promise<AudioPlacement> {
  const result = await placeFile(original, target, options);
  return { ...result, verified: isVerifiedStatus(result.status), usedDerivative: false };
}

/**
 * Place one audio source. The tagged derivative is checked first, where it was
 * written: its audio duration (from the stream's packets) must match the
 * original's within TAGGED_DURATION_TOLERANCE_MS. Otherwise the original is
 * placed untagged (byte-checked by the copy). A derivative that cannot be
 * placed, or an existing target that differs from it, falls back to the
 * original too.
 */
export async function placeAudio(
  original: string,
  derivative: string | undefined,
  target: string,
  options: AudioPlaceOptions
): Promise<AudioPlacement> {
  // The target already is the original (same path, or a hard link): nothing to place, and no
  // probe or compare of the derivative (a different file of the same size). A symlinked target
  // falls through: placeUnlocked reports it as `differs`, so it is never evidence for a delete.
  if (await isSameRegularFile(original, target)) {
    return { status: 'identical', target, verified: true, usedDerivative: false };
  }
  if (!derivative) {
    return placeOriginal(original, target, options);
  }

  if (!(await durationsMatch(original, derivative, options.probeDuration))) {
    const untagged = await placeOriginal(original, target, options);
    return {
      ...untagged,
      reason: untagged.reason ?? 'tagged copy duration did not match the original; original placed without metadata tags',
    };
  }

  const tagged = await placeFile(derivative, target, options);
  if (tagged.status === 'failed' || tagged.status === 'differs') {
    const fallback = await placeOriginal(original, target, options);
    return {
      ...fallback,
      reason: fallback.status === 'copied'
        ? `Tagged copy failed (${tagged.reason}); original placed without metadata tags`
        : fallback.reason ?? tagged.reason,
    };
  }
  return { ...tagged, verified: isVerifiedStatus(tagged.status), usedDerivative: true };
}
