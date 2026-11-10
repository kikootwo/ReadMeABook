/**
 * Component: Organize Link Pass (hard-link a book's audio, or say why it is copied or not imported)
 * Documentation: documentation/features/library-placement.md
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { linkBook, type BookLinkFile } from './book-link';
import { describeRefusal, type LinkRefusal } from './link-file';
import type { FilePlacement } from './library-placement';
import type { OrganizationResult } from './file-organizer';
import type { RMABLogger } from './logger';
import { removeOwnOpf, type OpfOutcome } from './opf-sidecar';

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
}

export type LinkPassOutcome =
  /** Indices of the files the copy loop still places (empty when the book was linked). */
  | { kind: 'copy'; indices: number[] }
  /** Hard link only and the book can't be linked: nothing is imported. */
  | { kind: 'stop' };

function record(result: OrganizationResult, file: BookLinkFile, status: 'failed', reason: string): void {
  result.records!.push({ source: file.source, target: file.target, status, verified: false, reason });
  result.errors.push(`${path.basename(file.target)} not imported: ${reason}`);
}

/**
 * Link every audio file of the book (book-link.ts). A refused source (symlink, outside the
 * download folders) is recorded as not imported and is never copied either. When the book
 * can't be linked: Hard link (copy if not possible) copies every other file, Hard link only
 * imports nothing. The outcome lands on `result` (records, audioFiles, linkFallback, linkRefused).
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

  for (const refused of outcome.refused) {
    await logger?.warn(`Not imported: ${path.basename(refused.file.source)} (${refused.reason})`);
    record(result, refused.file, 'failed', refused.reason);
  }
  const refusedSources = new Set(outcome.refused.map((r) => r.file.source));

  if (outcome.kind === 'cannot') {
    return cannotLink(input, outcome.refusal, files.flatMap((f, i) => (refusedSources.has(f.source) ? [] : [i])));
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
    if (placed.status === 'copied' || placed.status === 'identical' || placed.status === 'present') {
      result.audioFiles.push(placed.target);
      if (placed.linked) {
        linked++;
        result.filesMovedCount++;
        if (logger) await logger.debug(`Linked: ${name}`);
      } else {
        await logger?.info(`Already in place: ${name}`);
      }
    } else if (placed.status === 'differs') {
      await logger?.warn(`Not imported, left untouched: ${name} (${placed.reason})`);
      result.errors.push(`${name} not imported: ${placed.reason}`);
      if ((await fs.lstat(placed.target).catch(() => null))?.isFile()) result.audioFiles.push(placed.target);
    } else {
      await logger?.error(`Failed to link ${name}: ${placed.reason}`);
      result.errors.push(`Failed to link ${name}: ${placed.reason}`);
    }
  }
  result.linkedCount = linked;
  if (linked > 0) {
    await logger?.info(`Linked ${linked} file(s) to the download (one copy on disk)`);
    await logger?.info("File permissions are not changed on linked files; they keep the download's permissions");
  }
  return { kind: 'copy', indices: [] };
}

async function cannotLink(input: LinkPassInput, refusal: LinkRefusal, copyIndices: number[]): Promise<LinkPassOutcome> {
  const { result, logger } = input;
  const why = describeRefusal(refusal);
  if (input.placement === 'hardlink_only') {
    result.linkRefused = refusal;
    await logger?.warn(`Hard link not possible (${why}): nothing imported (File placement is Hard link only)`);
    result.errors.push(`Hard link not possible (${why}); nothing was imported`);
    return { kind: 'stop' };
  }
  result.linkFallback = refusal;
  await logger?.warn(
    `Hard link not possible (${why}): copying ${copyIndices.length} file(s) instead; this book uses disk space twice while the download is kept`
  );
  return { kind: 'copy', indices: copyIndices };
}

/** The folders of `targetPath` that don't exist yet, deepest first (what mkdir -p is about to create). */
export async function missingFolders(targetPath: string): Promise<string[]> {
  const missing: string[] = [];
  let dir = path.resolve(targetPath);
  while (!(await fs.lstat(dir).then(() => true, () => false))) {
    missing.push(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return missing;
}

/**
 * After a Hard link only refusal: remove the metadata.opf this run wrote and the book
 * folders this run created (`created`, deepest first), each only when empty (plain
 * rmdir, never recursive); the first folder that stays ends the walk.
 */
export async function undoRefusedImport(created: string[], opf: OpfOutcome | null, logger: RMABLogger | null): Promise<void> {
  if (opf?.outcome === 'written' && (await removeOwnOpf(opf).catch(() => false))) {
    await logger?.info('Removed the metadata.opf written for this import');
  }
  for (const dir of created) {
    if (!(await fs.rmdir(dir).then(() => true, () => false))) return;
  }
}
