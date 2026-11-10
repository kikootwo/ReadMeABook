/**
 * Component: Deleting a Hard-Linked Book (download cleanup, request delete) - real filesystem
 * Documentation: documentation/features/library-placement.md
 *
 * A linked library file and its download are two names for one file. Every delete path
 * unlinks names, never content: removing one side leaves the other byte-identical at nlink 1.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeImportedFilesOnly } from '@/lib/processors/shared-category-cleanup';
import { removeBookFolderFiles } from '@/lib/utils/book-folder-delete';
import { generateFilesHash } from '@/lib/utils/files-hash';
import type { ImportEvidence } from '@/lib/utils/import-inventory';

let root: string;
let download: string;
let book: string;

function mkfile(filePath: string, content: string): string {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

/** A download of two audio files plus a cover, hard-linked into the book folder (cover copied). */
function linkedBook() {
  const sources = ['Part 1.mp3', 'Part 2.mp3'].map((name, i) => mkfile(path.join(download, name), `audio-${i}`));
  const cover = mkfile(path.join(download, 'folder.jpg'), 'cover-bytes');
  fs.mkdirSync(book, { recursive: true });
  const targets = sources.map((source) => {
    const target = path.join(book, path.basename(source));
    fs.linkSync(source, target);
    return target;
  });
  fs.copyFileSync(cover, path.join(book, 'cover.jpg'));
  mkfile(path.join(book, 'metadata.opf'), '<?xml version="1.0"?><package/>');
  const evidence: ImportEvidence = {
    records: sources.map((source, i) => ({ source, target: targets[i], status: 'copied', verified: true, linked: true })),
    coverRecord: { source: cover, target: path.join(book, 'cover.jpg'), status: 'copied', verified: true },
  } as ImportEvidence;
  return { sources, targets, cover, evidence };
}

const snapshot = (files: string[]) => files.map((f) => ({ bytes: fs.readFileSync(f, 'utf8'), nlink: fs.statSync(f).nlink }));

describe('deleting a hard-linked book', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-linked-delete-'));
    download = path.join(root, 'downloads', 'Book [123]');
    book = path.join(root, 'media', 'Author', 'Book');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('starts with each audio file shared by two names', () => {
    const { sources } = linkedBook();
    expect(snapshot(sources).map((s) => s.nlink)).toEqual([2, 2]);
  });

  it('careful download cleanup unlinks only the download names; the library files stay at nlink 1 (#587)', async () => {
    const { targets, evidence } = linkedBook();
    const before = targets.map((t) => fs.readFileSync(t, 'utf8'));

    const gone = await removeImportedFilesOnly(download, download, evidence, { info: vi.fn() } as any);

    expect(gone).toBe(true);
    expect(fs.existsSync(download)).toBe(false);
    expect(snapshot(targets)).toEqual(before.map((bytes) => ({ bytes, nlink: 1 })));
    expect(fs.readdirSync(book).sort()).toEqual(['Part 1.mp3', 'Part 2.mp3', 'cover.jpg', 'metadata.opf']);
  });

  it('whole-folder download cleanup (own category) leaves the library intact', () => {
    const { targets } = linkedBook();
    const before = targets.map((t) => fs.readFileSync(t, 'utf8'));

    fs.rmSync(download, { recursive: true, force: true });

    expect(snapshot(targets)).toEqual(before.map((bytes) => ({ bytes, nlink: 1 })));
  });

  it('request delete removes the book folder (metadata.opf with it) and leaves the download byte-identical', async () => {
    const { sources, cover } = linkedBook();
    const before = [...sources, cover].map((f) => fs.readFileSync(f, 'utf8'));

    const result = await removeBookFolderFiles(book, generateFilesHash(['Part 1.mp3', 'Part 2.mp3']), []);

    expect(result).toMatchObject({ kind: 'removed', folderRemoved: true, kept: [] });
    expect(fs.existsSync(book)).toBe(false);
    expect([...sources, cover].map((f) => fs.readFileSync(f, 'utf8'))).toEqual(before);
    expect(snapshot(sources).map((s) => s.nlink)).toEqual([1, 1]);
  });

  it('request delete keeps metadata.opf when something unrecorded stays beside it', async () => {
    linkedBook();
    mkfile(path.join(book, 'notes.txt'), 'mine');

    const result = await removeBookFolderFiles(book, generateFilesHash(['Part 1.mp3', 'Part 2.mp3']), []);

    expect(result).toMatchObject({ kind: 'removed', folderRemoved: false });
    expect(fs.readdirSync(book).sort()).toEqual(['cover.jpg', 'metadata.opf', 'notes.txt']);
  });
});
