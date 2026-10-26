/**
 * Component: Bulk Import Disc Folder Fold Tests (real folders, ffprobe mocked)
 * Documentation: documentation/features/multi-disc-folders.md
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

function files(base: string, rels: string[], tags?: (rel: string) => Record<string, string> | undefined) {
  for (const rel of rels) {
    const full = path.join(base, rel);
    fsSync.mkdirSync(path.dirname(full), { recursive: true });
    fsSync.writeFileSync(full, 'x');
    const t = tags?.(rel);
    if (t) tagsByFile.set(fwd(full), t);
  }
}

beforeEach(() => {
  tmp = fsSync.realpathSync(fsSync.mkdtempSync(path.join(os.tmpdir(), 'rmab-fold-')));
  tagsByFile.clear();
});

afterEach(() => {
  fsSync.rmSync(tmp, { recursive: true, force: true });
});

describe('Bulk Import folds disc folders into their book folder', () => {
  it('untagged Disc 1/Disc 2 become one entry at the book folder with every file', async () => {
    const book = path.join(tmp, 'The Book [B0E2E43401]');
    files(book, ['Disc 1/01.m4a', 'Disc 1/02.m4a', 'Disc 2/01.m4a', 'Disc 2/02.m4a']);
    const results = await discoverAudiobooks(tmp);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      folderPath: fwd(book),
      folderName: 'The Book [B0E2E43401]',
      relativePath: 'The Book [B0E2E43401]',
      audioFileCount: 4,
      audioFiles: ['Disc 1/01.m4a', 'Disc 1/02.m4a', 'Disc 2/01.m4a', 'Disc 2/02.m4a'],
      extractedAsin: 'B0E2E43401',
      searchTerm: 'The Book',
      metadataSource: 'folder_name',
    });
  });

  it('per-disc album tags fold, and the search term drops the disc suffix', async () => {
    const book = path.join(tmp, 'Book');
    files(book, ['CD1/01.mp3', 'CD2/01.mp3'], (rel) => ({
      album: `The Long Book (Disc ${rel[2]})`, album_artist: 'An Author',
    }));
    const results = await discoverAudiobooks(tmp);
    expect(results).toHaveLength(1);
    expect(results[0].metadata.title).toBe('The Long Book');
    expect(results[0].searchTerm).toBe('The Long Book An Author');
    expect(results[0].audioFiles).toEqual(['CD1/01.mp3', 'CD2/01.mp3']);
  });

  it('orders Disc 2 before Disc 10 and puts the book folder\'s own intro first', async () => {
    const book = path.join(tmp, 'Book');
    files(book, ['Intro.mp3', 'Disc 10/01.mp3', 'Disc 2/01.mp3', 'Disc 1/01.mp3']);
    const results = await discoverAudiobooks(tmp);
    expect(results).toHaveLength(1);
    expect(results[0].audioFiles).toEqual(['Intro.mp3', 'Disc 1/01.mp3', 'Disc 2/01.mp3', 'Disc 10/01.mp3']);
  });

  it('scan root = the book folder folds into the scan root', async () => {
    files(tmp, ['CD1/01.mp3', 'CD2/01.mp3']);
    const results = await discoverAudiobooks(tmp);
    expect(results).toHaveLength(1);
    expect(results[0].folderPath).toBe(fwd(tmp));
    expect(results[0].relativePath).toBe(path.basename(tmp));
  });

  it('scan root = a disc folder: its sibling is never read and the disc folder stays one entry', async () => {
    const book = path.join(tmp, 'Book');
    files(book, ['CD1/01.mp3', 'CD2/01.mp3']);
    const results = await discoverAudiobooks(path.join(book, 'CD1'));
    expect(results).toHaveLength(1);
    expect(results[0].folderPath).toBe(fwd(path.join(book, 'CD1')));
    expect(results[0].audioFiles).toEqual(['01.mp3']);
  });

  it('never folds into a configured root, also when the root is configured through a link', async (ctx) => {
    files(tmp, ['CD1/01.mp3', 'CD2/01.mp3']);
    expect((await discoverAudiobooks(tmp, undefined, undefined, [tmp])).map((r) => r.folderName).sort()).toEqual(['CD1', 'CD2']);
    // A plain string compare would not match the link's path to the scanned folder
    const link = `${tmp}-link`;
    try {
      fsSync.symlinkSync(tmp, link, 'junction');
    } catch {
      ctx.skip();
    }
    try {
      const results = await discoverAudiobooks(tmp, undefined, undefined, [link]);
      expect(results.map((r) => r.folderName).sort()).toEqual(['CD1', 'CD2']);
    } finally {
      fsSync.unlinkSync(link);
    }
  });

  it('nested disc folders (Box/CD1 holds its own Disc 1 and Disc 2) never put a file in two entries', async () => {
    const box = path.join(tmp, 'Box');
    files(box, ['CD1/own.mp3', 'CD1/Disc 1/01.mp3', 'CD1/Disc 2/01.mp3', 'CD2/01.mp3']);
    const results = await discoverAudiobooks(tmp);
    const claimed = results.flatMap((r) => r.audioFiles.map((f) => fwd(path.join(r.folderPath, f))));
    expect(new Set(claimed).size).toBe(claimed.length);
    expect(claimed.sort()).toEqual(
      ['CD1/Disc 1/01.mp3', 'CD1/Disc 2/01.mp3', 'CD1/own.mp3', 'CD2/01.mp3'].map((f) => fwd(path.join(box, f)))
    );
    // The deepest book folder folds first: Box/CD1 with its discs; CD2 stays its own entry
    expect(results.find((r) => r.folderPath === fwd(path.join(box, 'CD1')))?.audioFiles).toEqual(['own.mp3', 'Disc 1/01.mp3', 'Disc 2/01.mp3']);
    expect(results).toHaveLength(2);
  });
});

describe('Bulk Import keeps separate entries', () => {
  it('untagged Part 1 / Part 2 (possibly separate titles)', async () => {
    files(path.join(tmp, 'Series'), ['Part 1/01.mp3', 'Part 2/01.mp3']);
    expect((await discoverAudiobooks(tmp)).map((r) => r.folderName).sort()).toEqual(['Part 1', 'Part 2']);
  });

  it('tagged Part 1 / Part 2 with different albums; the same album folds', async () => {
    files(path.join(tmp, 'Series'), ['Part 1/01.mp3', 'Part 2/01.mp3'], (rel) => ({ album: `Saga ${rel.slice(0, 6)}` }));
    expect(await discoverAudiobooks(tmp)).toHaveLength(2);
    tagsByFile.clear();
    files(path.join(tmp, 'Other'), ['Part 1/01.mp3', 'Part 2/01.mp3'], () => ({ album: 'One Book' }));
    const results = await discoverAudiobooks(path.join(tmp, 'Other'));
    expect(results).toHaveLength(1);
    expect(results[0].audioFiles).toEqual(['Part 1/01.mp3', 'Part 2/01.mp3']);
  });

  it('a mix of tagged and untagged discs', async () => {
    files(path.join(tmp, 'Book'), ['CD1/01.mp3', 'CD2/01.mp3'], (rel) => (rel.startsWith('CD1') ? { album: 'Book' } : undefined));
    expect(await discoverAudiobooks(tmp)).toHaveLength(2);
  });

  it('tag keys that disagree after the disc suffix is stripped', async () => {
    files(path.join(tmp, 'Box'), ['CD1/01.mp3', 'CD2/01.mp3'], (rel) => ({ album: rel.startsWith('CD1') ? 'Book One' : 'Book Two' }));
    expect(await discoverAudiobooks(tmp)).toHaveLength(2);
  });

  it('a disc folder holding two books', async () => {
    files(path.join(tmp, 'Box'), ['CD1/a.mp3', 'CD1/b.mp3', 'CD2/a.mp3'], (rel) => ({ album: rel === 'CD1/b.mp3' ? 'Other' : 'Book' }));
    const results = await discoverAudiobooks(tmp);
    expect(results.some((r) => r.audioFiles.includes('CD1/b.mp3') || r.audioFiles.includes('b.mp3'))).toBe(true);
    expect(results.find((r) => r.metadata.title === 'Other')?.audioFiles).toEqual(['b.mp3']);
  });

  it('the book folder\'s own audio with a different key stays its own entry', async () => {
    files(path.join(tmp, 'Book'), ['Sample.mp3', 'CD1/01.mp3', 'CD2/01.mp3'], (rel) => ({ album: rel === 'Sample.mp3' ? 'Another Title' : `Book (CD ${rel[2]})` }));
    const results = await discoverAudiobooks(tmp);
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.metadata.title === 'Book')?.audioFiles).toEqual(['CD1/01.mp3', 'CD2/01.mp3']);
    expect(results.find((r) => r.metadata.title === 'Another Title')?.audioFiles).toEqual(['Sample.mp3']);
  });

  it('Vol 1 / Vol 2, Extras and a single nested folder', async () => {
    files(path.join(tmp, 'Series'), ['Vol 1/01.mp3', 'Vol 2/01.mp3']);
    files(path.join(tmp, 'Book'), ['Unabridged/01.mp3', 'Extras/x.mp3']);
    const names = (await discoverAudiobooks(tmp)).map((r) => r.folderName).sort();
    expect(names).toEqual(['Extras', 'Unabridged', 'Vol 1', 'Vol 2']);
  });

  it('disc folders with audio only deeper inside (Book/CD1/Unabridged)', async () => {
    files(path.join(tmp, 'Book'), ['CD1/Unabridged/01.mp3', 'CD2/Unabridged/01.mp3']);
    expect(await discoverAudiobooks(tmp)).toHaveLength(2);
  });
});

describe('disc suffixes in per-disc album tags', () => {
  const albums = (byDisc: Record<string, Record<string, string>>) => (rel: string) => byDisc[rel.split('/')[0]];
  const single = async () => {
    const results = await discoverAudiobooks(tmp);
    expect(results).toHaveLength(1);
    return results[0];
  };

  it.each([
    ['Disc 1', 'Disc 2', 'The Hobbit Disc 1', 'The Hobbit Disc 2', 'The Hobbit'],
    ['CD1', 'CD2', 'The Hobbit CD1', 'The Hobbit CD2', 'The Hobbit'],
    ['Disc 1', 'Disc 2', 'Book Disc 1 of 3', 'Book Disc 2 of 3', 'Book'],
  ])('%s/%s tagged "%s"/"%s" fold, searched as "%s"', async (d1, d2, a1, a2, stem) => {
    files(path.join(tmp, 'Rip'), [`${d1}/01.mp3`, `${d2}/01.mp3`], albums({ [d1]: { album: a1 }, [d2]: { album: a2 } }));
    const folded = await single();
    expect(folded.audioFiles).toEqual([`${d1}/01.mp3`, `${d2}/01.mp3`]);
    expect(folded.searchTerm).toBe(stem);
  });

  it('the same album on every disc folds unchanged: "Hard Disk 3" stays the search term', async () => {
    files(path.join(tmp, 'Rip'), ['CD1/01.mp3', 'CD2/01.mp3'], () => ({ album: 'Hard Disk 3' }));
    const folded = await single();
    expect(folded.metadata.title).toBe('Hard Disk 3');
    expect(folded.searchTerm).toBe('Hard Disk 3');
  });

  it('"OCD 1"/"OCD 2" in CD1/CD2 stay separate, as before', async () => {
    files(path.join(tmp, 'Rip'), ['CD1/01.mp3', 'CD2/01.mp3'], albums({ CD1: { album: 'OCD 1' }, CD2: { album: 'OCD 2' } }));
    expect(await discoverAudiobooks(tmp)).toHaveLength(2);
  });

  it('a suffix number that is not its folder\'s own is not stripped', async () => {
    files(path.join(tmp, 'Rip'), ['CD1/01.mp3', 'CD2/01.mp3'],
      albums({ CD1: { album: 'The Hobbit Disc 2' }, CD2: { album: 'The Hobbit Disc 1' } }));
    expect(await discoverAudiobooks(tmp)).toHaveLength(2);
  });

  it('a blank album keeps author and narrator in the key: two books by different authors stay 2 entries', async () => {
    files(path.join(tmp, 'Book A'), ['CD1/01.mp3', 'CD2/01.mp3'], () => ({ album: ' ', album_artist: 'Author A' }));
    files(path.join(tmp, 'Book B'), ['CD1/01.mp3', 'CD2/01.mp3'], () => ({ album: ' ', album_artist: 'Author B' }));
    const results = await discoverAudiobooks(tmp);
    expect(results.map((r) => r.folderName).sort()).toEqual(['Book A', 'Book B']);
  });
});
