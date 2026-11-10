/**
 * Component: Organize Link Pass (hard-link a book's audio, or say why it is copied or not imported)
 * Documentation: documentation/features/library-placement.md
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { linkBook } from './book-link';
import { describeRefusal, refusalFromError, type LinkRefusal } from './link-file';
import type { FilePlacement } from './library-placement';
import type { OrganizationResult } from './file-organizer';
import type { RMABLogger } from './logger';
import { OPF_FILE_NAME, removeOwnOpf, writeOpfSidecar, type OpfMetadata, type OpfOutcome } from './opf-sidecar';

export interface LinkPassInput {
  placement: Exclude<FilePlacement, 'copy'>;
  /** Source path and library file name per audio file, in import order. */
  sources: string[];
  names: string[];
  targetPath: string;
  fileMode: number;
  compareExisting: (target: string) => boolean;
  result: OrganizationResult;
  logger: RMABLogger | null;
  /** The metadata.opf this import wrote before the pass (removed again when the book can't be linked). */
  opf: OpfOutcome | null;
}

export type LinkPassOutcome =
  /** Every audio file is placed (linked, in place, or another file by that name left untouched). */
  | { kind: 'linked' }
  /** Hard link (copy if not possible): the copy loop places the whole book, exactly as Copy mode. */
  | { kind: 'copy' }
  /** Hard link only: nothing is imported. */
  | { kind: 'stop' }
  /** The book already is its library folder: the copy loop finds every file in place; no copy note. */
  | { kind: 'inplace' };

const OPF_WRITE_FAILED = 'Failed to write metadata.opf';

/**
 * Write metadata.opf before any audio (once Audiobookshelf has scanned a book, its own
 * metadata wins over a later OPF). A failure never stops the import; it is said on the
 * request (`result.opfError`).
 */
export async function placeOpf(
  targetPath: string, book: OpfMetadata, fileMode: number, result: OrganizationResult, logger: RMABLogger | null
): Promise<OpfOutcome | null> {
  // A second write (the copy fallback) replaces what the first attempt reported
  delete result.opfError;
  if (result.errors.includes(OPF_WRITE_FAILED)) result.errors.splice(result.errors.indexOf(OPF_WRITE_FAILED), 1);
  try {
    const opf = await writeOpfSidecar(targetPath, book, fileMode);
    await logger?.info(opf.outcome === 'written' ? 'Wrote metadata.opf' : 'metadata.opf already exists; kept');
    if (opf.outcome === 'written' && opf.warning && !result.permissionWarnings?.includes(opf.warning)) {
      (result.permissionWarnings ??= []).push(opf.warning);
    }
    return opf;
  } catch (error) {
    await logger?.warn(`Could not write metadata.opf: ${error instanceof Error ? error.message : 'Unknown error'}`);
    result.errors.push(OPF_WRITE_FAILED);
    result.opfError = refusalFromError(error).code;
    return null;
  }
}

/** Remove the metadata.opf this import wrote (by identity); false when it should go and could not. */
async function removeWrittenOpf(opf: OpfOutcome | null, logger: RMABLogger | null): Promise<boolean> {
  if (opf?.outcome !== 'written') return true;
  try {
    if (await removeOwnOpf(opf)) await logger?.info('Removed the metadata.opf written for this import');
    return true;
  } catch (error) {
    await logger?.warn(`Could not remove the metadata.opf written for this import: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Link every audio file of the book (book-link.ts). When the book can't be linked, this
 * run's links and metadata.opf are already gone; then Hard link (copy if not possible)
 * hands the whole book to the copy loop and Hard link only imports nothing. The outcome
 * lands on `result` (records, audioFiles, linkedCount, linkFallback, linkRefused, linkLeftBehind).
 */
export async function runLinkPass(input: LinkPassInput): Promise<LinkPassOutcome> {
  const { result, logger } = input;
  const files = input.sources.map((source, i) => ({ source, target: path.join(input.targetPath, input.names[i]) }));
  const outcome = await linkBook({
    files,
    targetDir: input.targetPath,
    fileMode: input.fileMode,
    compareExisting: input.compareExisting,
    logger,
  });

  if (outcome.kind === 'inplace') {
    await logger?.info('The book is already in its library folder: nothing to link or copy');
    return { kind: 'inplace' };
  }
  if (outcome.kind === 'cannot') {
    const leftBehind = [...outcome.leftBehind];
    if (!(await removeWrittenOpf(input.opf, logger))) leftBehind.push(OPF_FILE_NAME);
    if (leftBehind.length > 0) result.linkLeftBehind = leftBehind;
    return cannotLink(input, outcome.refusal);
  }

  let linked = 0;
  for (const { file, result: placed } of outcome.placed) {
    const name = path.basename(file.target);
    result.records!.push({
      source: file.source,
      target: placed.target,
      status: placed.status,
      verified: placed.status === 'copied' || placed.status === 'identical',
      linked: placed.linked,
      reason: placed.reason,
    });
    if (placed.status === 'differs') {
      await logger?.warn(`Not imported, left untouched: ${name} (${placed.reason})`);
      result.errors.push(`${name} not imported: ${placed.reason}`);
      if ((await fs.lstat(placed.target).catch(() => null))?.isFile()) result.audioFiles.push(placed.target);
      continue;
    }
    result.audioFiles.push(placed.target);
    if (placed.linked) {
      linked++;
      result.filesMovedCount++;
      await logger?.debug(`Linked: ${name}`);
    } else {
      await logger?.info(`Already in place: ${name}`);
    }
  }
  result.linkedCount = linked;
  if (linked > 0) {
    await logger?.info(`Linked ${linked} file(s) to the download (one copy on disk)`);
    await logger?.info("File permissions are not changed on linked files; they keep the download's permissions");
  }
  return { kind: 'linked' };
}

async function cannotLink(input: LinkPassInput, refusal: LinkRefusal): Promise<LinkPassOutcome> {
  const { result, logger } = input;
  const why = describeRefusal(refusal);
  const stuck = result.linkLeftBehind ? `; could not remove ${result.linkLeftBehind.join(', ')}` : '';
  if (input.placement === 'hardlink_only') {
    result.linkRefused = refusal;
    await logger?.warn(`Hard link not possible (${why}): nothing imported (File placement is Hard link only)${stuck}`);
    result.errors.push(`Hard link not possible (${why}); nothing was imported`);
    return { kind: 'stop' };
  }
  result.linkFallback = refusal;
  await logger?.warn(`Hard link not possible (${why}): copying the book as Copy mode does${stuck}; it uses disk space twice while the download is kept`);
  return { kind: 'copy' };
}

/** The folders mkdir -p created for `targetPath` (deepest first), from the first one it reports. */
export function createdFolders(targetPath: string, firstCreated: string | undefined): string[] {
  if (!firstCreated) return [];
  // Windows reports it with the long-path prefix
  const top = path.resolve(firstCreated.startsWith('\\\\?\\') ? firstCreated.slice(4) : firstCreated);
  const target = path.resolve(targetPath);
  const below = path.relative(top, target);
  if (below.startsWith('..') || path.isAbsolute(below)) return [];
  const created: string[] = [];
  for (let dir = target; ; dir = path.dirname(dir)) {
    created.push(dir);
    if (path.relative(top, dir) === '') return created;
  }
}

/**
 * After a Hard link only refusal: remove the book folders this run created (`created`,
 * deepest first), each only when empty (plain rmdir, never recursive); the first folder
 * that stays ends the walk. Also used to drop an OPF beside no audio (`opf`).
 */
export async function undoRefusedImport(created: string[], opf: OpfOutcome | null, logger: RMABLogger | null): Promise<void> {
  await removeWrittenOpf(opf, logger);
  for (const dir of created) {
    if (!(await fs.rmdir(dir).then(() => true, () => false))) return;
  }
}
