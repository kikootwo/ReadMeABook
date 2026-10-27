/**
 * Component: Bulk Import Grouping Tests, every script (real folders, ffprobe mocked)
 * Documentation: documentation/features/bulk-import.md
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fsSync from 'fs';
import path from 'path';
import os from 'os';

const tagsByFile = vi.hoisted(() => new Map<string, Record<string, string>>());
const execMock = vi.hoisted(() => {
  const mockFn = vi.fn();
  (mockFn as unknown as Record<symbol, unknown>)[Symbol.for('nodejs.util.promisify.custom')] = async (
    _file: string,
    args: string[]
  ) => ({ stdout: JSON.stringify({ format: { tags: tagsByFile.get(args[args.length - 1].replace(/\\/g, '/')) ?? {} } }), stderr: '' });
  return mockFn;
});
vi.mock('child_process', () => ({ execFile: execMock }));

import { discoverAudiobooks } from '@/lib/utils/bulk-import-scanner';

let tmp: string;
const fwd = (p: string) => p.replace(/\\/g, '/');

/** Create audio files under `tmp` (paths relative to it), each with its own album and author tags. */
function book(rels: string[], album: string | ((rel: string) => string), author?: string) {
  for (const rel of rels) {
    const full = path.join(tmp, rel);
    fsSync.mkdirSync(path.dirname(full), { recursive: true });
    fsSync.writeFileSync(full, 'x');
    const tags: Record<string, string> = { album: typeof album === 'function' ? album(rel) : album };
    if (author) tags.album_artist = author;
    tagsByFile.set(fwd(full), tags);
  }
}

/** Each entry as `folder: files`, sorted, so tests read as the expected review list. */
const entries = async () =>
  (await discoverAudiobooks(tmp))
    .map((r) => `${path.posix.relative(fwd(tmp), r.folderPath) || '.'}: ${[...r.audioFiles].sort().join(', ')}`)
    .sort();

beforeEach(() => {
  tmp = fsSync.realpathSync(fsSync.mkdtempSync(path.join(os.tmpdir(), 'rmab-scripts-')));
  tagsByFile.clear();
});

afterEach(() => {
  fsSync.rmSync(tmp, { recursive: true, force: true });
});

describe('Bulk Import keeps different books apart in every script', () => {
  it('two Cyrillic books by one author in two folders stay 2 entries', async () => {
    book(['Война и мир/01.mp3', 'Война и мир/02.mp3'], 'Война и мир', 'Лев Толстой');
    book(['Анна Каренина/01.mp3'], 'Анна Каренина', 'Лев Толстой');
    expect(await entries()).toEqual(['Анна Каренина: 01.mp3', 'Война и мир: 01.mp3, 02.mp3']);
  });

  it('two Chinese books by one author in two folders stay 2 entries', async () => {
    book(['三体/01.mp3'], '三体', '刘慈欣');
    book(['黑暗森林/01.mp3'], '黑暗森林', '刘慈欣');
    expect(await entries()).toEqual(['三体: 01.mp3', '黑暗森林: 01.mp3']);
  });

  it('two Cyrillic books in one folder stay 2 entries', async () => {
    book(['Толстой/a.mp3'], 'Война и мир', 'Лев Толстой');
    book(['Толстой/b.mp3'], 'Анна Каренина', 'Лев Толстой');
    expect(await entries()).toEqual(['Толстой: a.mp3', 'Толстой: b.mp3']);
  });

  it('mixed-script titles that share only their Latin part stay 2 entries', async () => {
    book(['HP1/01.mp3'], 'Harry Potter и философский камень', 'J.K. Rowling');
    book(['HP2/01.mp3'], 'Harry Potter и Тайная комната', 'J.K. Rowling');
    expect(await entries()).toEqual(['HP1: 01.mp3', 'HP2: 01.mp3']);
  });

  it('albums with no letter or digit never merge two folders, even by one author', async () => {
    book(['Shelf A/01.mp3'], '\u{1F4DA}', 'Same Author');
    book(['Shelf B/01.mp3'], '\u{1F4DA}', 'Same Author');
    expect(await entries()).toEqual(['Shelf A: 01.mp3', 'Shelf B: 01.mp3']);
  });

  it('a blank-album folder with two authors stays 2 entries', async () => {
    book(['Mixed/a1.mp3', 'Mixed/a2.mp3'], ' ', 'Author A');
    book(['Mixed/b1.mp3'], ' ', 'Author B');
    expect(await entries()).toEqual(['Mixed: a1.mp3, a2.mp3', 'Mixed: b1.mp3']);
  });

  it('a book and a symbol-album book by another author in one folder stay 2 entries', async () => {
    book(['Mixed/a1.mp3', 'Mixed/a2.mp3'], 'Book A', 'Author A');
    book(['Mixed/x.mp3'], '\u{1F4DA}', 'Author X');
    expect(await entries()).toEqual(['Mixed: a1.mp3, a2.mp3', 'Mixed: x.mp3']);
  });
});

describe('Bulk Import still merges one book in every script', () => {
  it('Cyrillic CD1/CD2 with per-disc albums fold into the book folder', async () => {
    book(['Война и мир/CD1/01.mp3', 'Война и мир/CD2/01.mp3'], (rel) => `Война и мир (Disc ${rel.split('/')[1][2]})`, 'Лев Толстой');
    const results = await discoverAudiobooks(tmp);
    expect(results).toHaveLength(1);
    expect(results[0].metadata.title).toBe('Война и мир');
    expect(results[0].audioFiles).toEqual(['CD1/01.mp3', 'CD2/01.mp3']);
  });

  it('one Cyrillic book split over two plain folders merges at their parent', async () => {
    book(['Война и мир/A/01.mp3', 'Война и мир/B/02.mp3'], 'Война и мир', 'Лев Толстой');
    expect(await entries()).toEqual(['Война и мир: A/01.mp3, B/02.mp3']);
  });

  it('blank-album Part 1/Part 2 fold, one entry per book folder', async () => {
    book(['Book A/Part 1/01.mp3', 'Book A/Part 2/01.mp3'], ' ', 'Author A');
    book(['Book B/Part 1/01.mp3', 'Book B/Part 2/01.mp3'], ' ', 'Author B');
    expect(await entries()).toEqual(['Book A: Part 1/01.mp3, Part 2/01.mp3', 'Book B: Part 1/01.mp3, Part 2/01.mp3']);
  });

  it('"!!! (Disc N)" albums fold per book folder and never merge two books by one author', async () => {
    const album = (rel: string) => `!!! (Disc ${rel.split('/')[1][2]})`;
    book(['Book1/CD1/01.mp3', 'Book1/CD2/01.mp3'], album, 'Same Author');
    book(['Book2/CD1/01.mp3', 'Book2/CD2/01.mp3'], album, 'Same Author');
    expect(await entries()).toEqual(['Book1: CD1/01.mp3, CD2/01.mp3', 'Book2: CD1/01.mp3, CD2/01.mp3']);
  });
});
