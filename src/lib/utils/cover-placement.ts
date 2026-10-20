/**
 * Component: Cover Art Placement (cover.jpg never replaces an existing library cover)
 * Documentation: documentation/phase3/file-organization.md
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { copyFile, writeFileAtomic } from './copy-file';
import { applyFileMode, removeStalePartials, withTargetLock } from './organize-copy';

/** 'written': this run published the cover; 'kept': a cover was already there and stays as it is. */
export type CoverOutcome = 'written' | 'kept';

export interface CoverPlacement {
  outcome: CoverOutcome;
  /** Set when the cover was written but its permissions could not be applied. */
  warning?: string;
}

/** Cover bytes to publish: a local file (cached thumbnail) or downloaded data. */
export type CoverContent = { file: string } | { data: Buffer };

/**
 * What is at `target`: nothing, an empty regular file (a cover an older
 * version truncated or left half-written), or anything else (kept as it is).
 */
export async function coverState(target: string): Promise<'missing' | 'empty' | 'present'> {
  try {
    const stat = await fs.lstat(target);
    return stat.isFile() && stat.size === 0 ? 'empty' : 'present';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw error;
  }
}

/** True when the library already has a cover to keep (an empty cover.jpg does not count). */
export async function hasCover(target: string): Promise<boolean> {
  return (await coverState(target)) === 'present';
}

/**
 * Publish a cover at `target` the way audio is published: written to a hidden
 * partial, fsynced and size-checked, then linked into place without replacing
 * anything. An existing cover (or one that appears meanwhile) is kept; only an
 * empty regular file is replaced (renamed over, re-checked under the lock).
 * Runs under the per-target placement lock, so it never races a cover copy
 * from the download in another organize job. The file mode is applied
 * best-effort (a refused chmod is a warning); a cover that is not there
 * afterwards throws.
 */
export async function publishCover(target: string, content: CoverContent, fileMode: number): Promise<CoverPlacement> {
  return withTargetLock(target, async () => {
    await removeStalePartials(path.dirname(target), path.basename(target));
    const state = await coverState(target);
    if (state === 'present') {
      return { outcome: 'kept' };
    }
    const mode = state === 'empty' ? 'replace' : 'create';
    try {
      if ('file' in content) {
        await copyFile(content.file, target, { mode });
      } else {
        await writeFileAtomic(target, content.data, { mode });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        return { outcome: 'kept' };
      }
      throw error;
    }
    const permissions = await applyFileMode(target, fileMode);
    if (permissions.kind === 'missing') throw new Error(permissions.reason);
    return permissions.kind === 'refused' ? { outcome: 'written', warning: permissions.warning } : { outcome: 'written' };
  });
}
