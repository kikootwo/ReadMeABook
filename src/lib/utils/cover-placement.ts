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

/** True when something already exists at `target` (any kind of entry). */
export async function coverExists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Publish a cover at `target` the way audio is published: written to a hidden
 * partial, fsynced and size-checked, then linked into place without replacing
 * anything. An existing cover (or one that appears meanwhile) is kept. Runs
 * under the per-target placement lock, so it never races a cover copy from the
 * download in another organize job. The file mode is applied best-effort (a
 * refused chmod is a warning); a cover that is not there afterwards throws.
 */
export async function publishCover(target: string, content: CoverContent, fileMode: number): Promise<CoverPlacement> {
  return withTargetLock(target, async () => {
    await removeStalePartials(path.dirname(target), path.basename(target));
    if (await coverExists(target)) {
      return { outcome: 'kept' };
    }
    try {
      if ('file' in content) {
        await copyFile(content.file, target, { mode: 'create' });
      } else {
        await writeFileAtomic(target, content.data, { mode: 'create' });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        return { outcome: 'kept' };
      }
      throw error;
    }
    const mode = await applyFileMode(target, fileMode);
    if (mode.kind === 'missing') throw new Error(mode.reason);
    return mode.kind === 'refused' ? { outcome: 'written', warning: mode.warning } : { outcome: 'written' };
  });
}
