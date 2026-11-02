/**
 * Component: Book Folder Junk (OS and Audiobookshelf leftovers a request delete may clear, #526)
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * A fixed name list. A request delete removes these only when nothing else is
 * left in the book folder but them, RMAB's cover and ebooks recorded by active
 * ebook requests (those stay). Junk folders (`@eaDir`, `.@__thumb`) go through a
 * limited walk: lstat only, links never followed, and the whole folder is kept
 * (nothing in it removed) on any link, special file, audio or ebook file, depth
 * over JUNK_MAX_DEPTH or more than JUNK_MAX_ENTRIES entries. Each walked folder
 * stays open from the walk until its own rmdir, so on a local filesystem a folder
 * made in its place can't pass the re-check with a reused inode number (Linux
 * reuses a freed one at once). Not covered: a swap after the re-check, or a
 * filesystem that keeps a folder's number by path (mergerfs, NFS).
 */

import * as fs from 'fs/promises';
import type { FileHandle } from 'fs/promises';
import * as path from 'path';
import { isAudioFile, isEbookFile } from './import-inventory';

const JUNK_FILE_NAMES: ReadonlySet<string> = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', 'metadata.json', 'metadata.abs']);
const JUNK_DIR_NAMES: ReadonlySet<string> = new Set(['@eaDir', '.@__thumb']);

/** Deepest folder level below a junk folder the walk accepts (the junk folder itself is level 0). */
export const JUNK_MAX_DEPTH = 3;
/** Most entries (files and folders, all levels) a junk folder may hold. */
export const JUNK_MAX_ENTRIES = 500;

/** macOS, Windows, NAS indexer or Audiobookshelf leftovers, matched by exact name (`._*`: AppleDouble). */
export function isJunkFileName(name: string): boolean {
  return JUNK_FILE_NAMES.has(name) || name.startsWith('._');
}

export function isJunkDirName(name: string): boolean {
  return JUNK_DIR_NAMES.has(name);
}

interface JunkNode {
  dir: string;
  /** Open from the walk until this folder's rmdir: its inode number cannot be reused meanwhile. */
  handle: FileHandle;
  dev: bigint;
  ino: bigint;
  files: string[];
}

/**
 * A junk folder the walk accepted: folders deepest first, each with the files directly in it.
 * It holds the folders open: removeJunkDir or releaseJunkDir must be called on it.
 */
export interface JunkDirPlan {
  root: string;
  nodes: JunkNode[];
}

class Refusal extends Error {}

/** Walk a junk folder; `why` when anything in it means it must stay whole (nothing is left open then). */
export async function planJunkDir(root: string): Promise<{ plan: JunkDirPlan } | { why: string }> {
  const nodes: JunkNode[] = [];
  const opened: FileHandle[] = [];
  let count = 0;

  async function walk(dir: string, depth: number): Promise<void> {
    const stat = await fs.lstat(dir, { bigint: true });
    if (!stat.isDirectory()) throw new Refusal('it is not a folder');
    // open follows links: the handle must be the folder lstat saw
    const handle = await fs.open(dir, 'r');
    opened.push(handle);
    const held = await handle.stat({ bigint: true });
    if (held.dev !== stat.dev || held.ino !== stat.ino) throw new Refusal('it changed while it was checked');
    let entries;
    try {
      entries = await fs.readdir(dir);
    } catch (error) {
      throw new Refusal(`it could not be read (${(error as NodeJS.ErrnoException).code ?? 'error'})`);
    }
    const files: string[] = [];
    for (const name of entries) {
      if (++count > JUNK_MAX_ENTRIES) throw new Refusal(`it holds more than ${JUNK_MAX_ENTRIES} entries`);
      const full = path.join(dir, name);
      const entry = await fs.lstat(full);
      if (entry.isSymbolicLink()) throw new Refusal('it holds a link');
      if (entry.isDirectory()) {
        if (depth + 1 > JUNK_MAX_DEPTH) throw new Refusal('it is nested too deep');
        await walk(full, depth + 1);
      } else if (!entry.isFile()) {
        throw new Refusal('it holds a special file');
      } else if (isAudioFile(name) || isEbookFile(name)) {
        throw new Refusal('it holds an audio or ebook file');
      } else {
        files.push(full);
      }
    }
    nodes.push({ dir, handle, dev: stat.dev, ino: stat.ino, files });
  }

  try {
    await walk(root, 0);
  } catch (error) {
    await closeAll(opened);
    if (error instanceof Refusal) return { why: error.message };
    return { why: `it could not be checked (${(error as NodeJS.ErrnoException).code ?? 'error'})` };
  }
  return { plan: { root, nodes } };
}

async function closeAll(handles: FileHandle[]): Promise<void> {
  await Promise.all(handles.map((handle) => handle.close().catch(() => undefined)));
}

/** Close the folders a plan holds open without removing anything (safe to call more than once). */
export async function releaseJunkDir(plan: JunkDirPlan): Promise<void> {
  await closeAll(plan.nodes.map((node) => node.handle));
}

/**
 * Remove a walked junk folder one entry at a time, deepest first. Each folder is
 * checked to still be the same folder (lstat dev/ino, held open since the walk)
 * before its files are unlinked; a file that is no longer a regular file, or a
 * folder that changed, stops the removal there. rmdir errors are ignored (a later
 * rmdir up the tree then fails too). Releases the plan. Returns the first error code, or null.
 */
export async function removeJunkDir(plan: JunkDirPlan): Promise<string | null> {
  try {
    for (const node of plan.nodes) {
      const now = await fs.lstat(node.dir, { bigint: true }).catch(() => null);
      if (!now || !now.isDirectory() || now.dev !== node.dev || now.ino !== node.ino) return 'changed';
      for (const file of node.files) {
        try {
          const entry = await fs.lstat(file);
          if (!entry.isFile()) return 'changed';
          await fs.unlink(file);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code ?? 'error';
          if (code !== 'ENOENT') return code;
        }
      }
      // Closed before its rmdir: on Windows an open folder can linger until closed
      await node.handle.close().catch(() => undefined);
      await fs.rmdir(node.dir).catch(() => undefined);
    }
    return null;
  } finally {
    await releaseJunkDir(plan);
  }
}
