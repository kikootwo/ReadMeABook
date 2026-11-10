/**
 * Component: Book Hard Link Pass (vet every file, link every file or none)
 * Documentation: documentation/features/library-placement.md
 *
 * Every file goes through placeFile({ link }) (organize-copy.ts), so the existing-target
 * rules are the copy's. Every file is vetted before the first link; any file that can't be
 * linked safely, and any failure or throw during the pass, makes the whole book `cannot`
 * after this run's links are removed by name: a book is linked, copied or not imported,
 * never half-linked by one run.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { collectGuardRoots } from '../processors/organize-cleanup-guard';
import { canonicalize, isSameEntry, isStrictlyInside, type CanonicalPath } from './delete-guard';
import { sameIdentity, type FileIdentity } from './copy-file';
import { placeFile, withTargetLock, type PlaceResult } from './organize-copy';
import { describeRefusal, linkRefusal, pinFile, refusalFromError, type LinkRefusal, type PinnedFile } from './link-file';
import type { RMABLogger } from './logger';

export interface BookLinkFile {
  source: string;
  target: string;
}

export interface BookLinkInput {
  files: BookLinkFile[];
  targetDir: string;
  fileMode: number;
  compareExisting: (target: string) => boolean;
  logger?: RMABLogger | null;
}

export type BookLinkResult =
  | { kind: 'placed'; placed: Array<{ file: BookLinkFile; result: PlaceResult }> }
  /** Every source already is its target (a Bulk or Manual Import in place): nothing to link or copy. */
  | { kind: 'inplace' }
  /** `leftBehind`: names of this run that could not be removed again (never removed recursively). */
  | { kind: 'cannot'; refusal: LinkRefusal; leftBehind: string[] };

// One link pass (and its rollback) per book folder at a time, so a second job for the same
// book never reports as in place a link this pass is about to remove
const bookLocks = new Map<string, Promise<void>>();

async function withBookLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const key = path.resolve(dir).toLowerCase();
  const previous = bookLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => mine);
  bookLocks.set(key, tail);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (bookLocks.get(key) === tail) bookLocks.delete(key);
  }
}

interface Roots { media: CanonicalPath; allowed: CanonicalPath[] }

/** One file: its identity when it may be linked (the file stays pinned in `pins`), else the refusal code. */
async function vet(
  source: string, roots: Roots | null, canonicalDir: (dir: string) => Promise<CanonicalPath>, pins: PinnedFile[]
): Promise<{ code: string } | { id: FileIdentity }> {
  let stat;
  try {
    stat = await fs.lstat(source, { bigint: true });
  } catch (error) {
    return { code: refusalFromError(error).code };
  }
  if (stat.isSymbolicLink()) return { code: 'SYMLINK' };
  if (!stat.isFile()) return { code: 'NOT_REGULAR' };
  if (roots) {
    // Not a symlink, so it is inside a folder when its own (canonical) folder is that folder or below it
    const dir = await canonicalDir(path.dirname(source));
    const inside = (root: CanonicalPath) => isSameEntry(dir, root) || isStrictlyInside(dir, root);
    if (!roots.allowed.some(inside)) return { code: 'OUTSIDE' };
    // Audiobookshelf would index both names of one inode
    if (inside(roots.media)) return { code: 'IN_LIBRARY' };
  }
  const pin = await pinFile(source);
  if ('code' in pin) return pin;
  pins.push(pin.pinned);
  // Swapped between the lstat and the open
  if (!sameIdentity(pin.pinned.id, { dev: stat.dev, ino: stat.ino })) return { code: 'VERIFY' };
  return { id: pin.pinned.id };
}

type Precheck = { eligible: Array<BookLinkFile & { id: FileIdentity }> } | { refusal: LinkRefusal };

async function precheck(files: BookLinkFile[], targetDir: string, pins: PinnedFile[], logger?: RMABLogger | null): Promise<Precheck> {
  let roots: Roots | null = null;
  try {
    const configured = await collectGuardRoots();
    roots = {
      media: await canonicalize(configured.mediaDir),
      allowed: await Promise.all([...configured.downloadRoots, ...(configured.otherRoots ?? [])].map(canonicalize)),
    };
  } catch {
    roots = null;
  }
  const targetInside = roots !== null && isStrictlyInside(await canonicalize(targetDir), roots.media);
  const targetDev = (await fs.stat(targetDir, { bigint: true })).dev;

  // Every file is vetted before the first link; the first unsafe one decides the book
  const dirs = new Map<string, Promise<CanonicalPath>>();
  const canonicalDir = (dir: string) => dirs.get(dir) ?? dirs.set(dir, canonicalize(dir)).get(dir)!;
  const eligible: Array<BookLinkFile & { id: FileIdentity }> = [];
  let unsafe: string | null = null;
  for (const file of files) {
    const vetted = await vet(file.source, roots, canonicalDir, pins);
    if ('code' in vetted) {
      await logger?.warn(`Can't hard-link ${path.basename(file.source)}: ${describeRefusal(linkRefusal(vetted.code))}`);
      unsafe ??= vetted.code;
    } else {
      eligible.push({ ...file, id: vetted.id });
    }
  }
  if (!roots) return { refusal: linkRefusal('ROOTS') };
  if (!targetInside) return { refusal: linkRefusal('TARGET') };
  if (unsafe) return { refusal: linkRefusal(unsafe) };
  // Equal devices don't prove one mount (two bind mounts of a disk share st_dev); only link() can tell
  if (eligible.some((file) => file.id.dev !== targetDev)) return { refusal: linkRefusal('EXDEV') };
  return { eligible };
}

const lstatOrNull = (p: string) => fs.lstat(p, { bigint: true }).catch(() => null);

/**
 * Remove, by name, every link this run made: a name that was not there before the pass and
 * is now the download file (dev/ino of a source still pinned, so no replacement can carry
 * them). A name someone else put there stays. Returns the names that
 * should go and could not (including `failedTarget` when its failed link stayed).
 */
async function rollback(
  files: Array<BookLinkFile & { id: FileIdentity }>,
  before: Set<string>,
  created: Array<{ target: string; id: FileIdentity }>,
  failedTarget: string | null,
  logger?: RMABLogger | null
): Promise<string[]> {
  const candidates = new Map<string, FileIdentity>();
  for (const file of files) if (!before.has(file.target)) candidates.set(file.target, file.id);
  for (const { target, id } of created) candidates.set(target, id);
  const leftBehind: string[] = [];
  for (const [target, id] of [...candidates].reverse()) {
    await withTargetLock(target, async () => {
      const stat = await lstatOrNull(target);
      if (!stat) return;
      const name = path.basename(target);
      if (stat.isFile() && sameIdentity({ dev: stat.dev, ino: stat.ino }, id)) {
        await fs.unlink(target).catch(async (error: unknown) => {
          leftBehind.push(name);
          await logger?.warn(`Could not remove the link ${name} again: ${error instanceof Error ? error.message : String(error)}`);
        });
      } else if (target === failedTarget) {
        leftBehind.push(name);
        await logger?.warn(`Could not remove ${name} again: the link made for it failed its check`);
      } else {
        await logger?.warn(`Left alone: ${name} was put there by something else while the book was being linked`);
      }
    });
  }
  return leftBehind;
}

/**
 * Link the book's files into `targetDir`. Returns `cannot` (after removing this run's links)
 * when the configured folders can't be read, the folder is outside the media folder, any file
 * is unsafe (symlink, not a regular file, outside the download folders, inside the media
 * folder), the devices differ, or any file fails or throws during the pass. Otherwise every
 * file's placeFile result (linked, in place, or another file by that name left untouched).
 */
export async function linkBook(input: BookLinkInput): Promise<BookLinkResult> {
  const same = (file: BookLinkFile) => path.resolve(file.source) === path.resolve(file.target);
  if (input.files.length > 0 && input.files.every(same)) return { kind: 'inplace' };
  return withBookLock(input.targetDir, async () => {
    // Every vetted source stays open until the pass and any rollback are done (pinFile)
    const pins: PinnedFile[] = [];
    try {
      return await linkPinned(input, pins);
    } finally {
      await Promise.all(pins.map((pin) => pin.close()));
    }
  });
}

async function linkPinned(input: BookLinkInput, pins: PinnedFile[]): Promise<BookLinkResult> {
  let checked: Precheck;
  try {
    checked = await precheck(input.files, input.targetDir, pins, input.logger);
  } catch (error) {
    return { kind: 'cannot', refusal: refusalFromError(error), leftBehind: [] };
  }
  if ('refusal' in checked) return { kind: 'cannot', refusal: checked.refusal, leftBehind: [] };

  const eligible = checked.eligible;
  const before = new Set<string>();
  for (const file of eligible) if (await lstatOrNull(file.target)) before.add(file.target);
  const created: Array<{ target: string; id: FileIdentity }> = [];
  const placed: Array<{ file: BookLinkFile; result: PlaceResult }> = [];
  for (const file of eligible) {
    let result: PlaceResult;
    try {
      result = await placeFile(file.source, file.target, {
        fileMode: input.fileMode,
        compareExisting: input.compareExisting(file.target),
        link: file.id,
      });
    } catch (error) {
      await input.logger?.warn(`Linking ${path.basename(file.target)} failed: ${error instanceof Error ? error.message : String(error)}`);
      const leftBehind = await rollback(eligible, before, created, null, input.logger);
      return { kind: 'cannot', refusal: refusalFromError(error), leftBehind };
    }
    if (result.status === 'failed') {
      if (result.reason) await input.logger?.warn(`Linking ${path.basename(file.target)} failed: ${result.reason}`);
      const failedTarget = result.cannotLink?.code === 'VERIFY' ? file.target : null;
      const leftBehind = await rollback(eligible, before, created, failedTarget, input.logger);
      return { kind: 'cannot', refusal: result.cannotLink ?? linkRefusal(/^(E[A-Z]+)\b/.exec(result.reason ?? '')?.[1] ?? 'ERROR'), leftBehind };
    }
    if (result.linked) created.push({ target: result.target, id: file.id });
    placed.push({ file: { source: file.source, target: file.target }, result });
  }
  return { kind: 'placed', placed };
}
