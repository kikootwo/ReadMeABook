/**
 * Component: Bulk Import Scanner Tests
 * Documentation: documentation/features/bulk-import.md
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'path';
import os from 'os';

const execMock = vi.hoisted(() => {
  const mockFn = vi.fn();
  // util.promisify on child_process.exec resolves to { stdout, stderr }
  // (via the [util.promisify.custom] symbol). Attach the same shape here so
  // code that destructures `{ stdout } = await execPromise(...)` works.
  const customSymbol = Symbol.for('nodejs.util.promisify.custom');
  (mockFn as unknown as Record<symbol, unknown>)[customSymbol] = (
    ...args: unknown[]
  ) =>
    new Promise((resolve, reject) => {
      mockFn(
        ...args,
        (err: Error | null, stdout: string, stderr: string) => {
          if (err) reject(err);
          else resolve({ stdout, stderr });
        },
      );
    });
  return mockFn;
});

vi.mock('child_process', () => ({
  exec: execMock,
}));

import fs from 'fs/promises';
import {
  buildSearchTerm,
  cleanSearchString,
  discoverAudiobooks,
  extractAsinFromString,
} from '@/lib/utils/bulk-import-scanner';

/**
 * Configure the ffprobe mock so each invocation returns canned tags
 * keyed by the file path embedded in the command string.
 */
function mockFfprobeByFile(tagsByFile: Record<string, Record<string, string>>) {
  execMock.mockImplementation(
    (command: string, options: unknown, callback?: unknown) => {
      const cb = (typeof options === 'function' ? options : callback) as (
        err: Error | null,
        stdout: string,
        stderr: string,
      ) => void;
      const match = command.match(/"([^"]+)"\s*$/);
      const filePath = match ? match[1].replace(/\\/g, '/') : '';
      const tags = tagsByFile[filePath] ?? {};
      const payload = JSON.stringify({ format: { tags } });
      cb(null, payload, '');
    },
  );
}

describe('extractAsinFromString', () => {
  it.each([
    ['parenthesized', 'Stephen King - The Gunslinger (B019NOKST6)', 'B019NOKST6'],
    ['bracketed', 'Some Book [B019NOKST6]', 'B019NOKST6'],
    ['whitespace-separated', 'Some Book B019NOKST6 extra', 'B019NOKST6'],
    ['at start of string', 'B019NOKST6 some title', 'B019NOKST6'],
    ['at end of string', 'some title B019NOKST6', 'B019NOKST6'],
    ['hyphen-delimited', 'Some Book-B019NOKST6-end', 'B019NOKST6'],
    ['lowercase folder name', 'some book (b019nokst6)', 'B019NOKST6'],
    ['mixed case', 'Some Book (b019nOkSt6)', 'B019NOKST6'],
  ])('extracts ASIN from %s', (_label, input, expected) => {
    expect(extractAsinFromString(input)).toBe(expected);
  });

  it.each([
    ['no ASIN at all', 'Stephen King - The Gunslinger'],
    ['does not start with B', 'Some Book (A019NOKST6)'],
    ['too short', 'Some Book (B019NOKST)'],
    ['too long is rejected by boundary', 'Some Book (B019NOKST6A)'],
    ['embedded in longer alphanumeric word', 'fooB019NOKST6bar'],
    ['not starting with B at all', '0019NOKST6'],
  ])('returns null when %s', (_label, input) => {
    expect(extractAsinFromString(input)).toBeNull();
  });
});

describe('cleanSearchString', () => {
  it('strips a file extension', () => {
    expect(cleanSearchString('The Gunslinger.m4b')).toBe('The Gunslinger');
  });

  it('strips a bracketed ASIN', () => {
    expect(cleanSearchString('The Gunslinger [B019NOKST6]')).toBe('The Gunslinger');
  });

  it('strips a parenthesized ASIN', () => {
    expect(cleanSearchString('The Gunslinger (B019NOKST6)')).toBe('The Gunslinger');
  });

  it('strips a bracketed year', () => {
    expect(cleanSearchString('The Gunslinger (1982)')).toBe('The Gunslinger');
  });

  it.each([
    ['01 - The Gunslinger', 'The Gunslinger'],
    ['001_The Gunslinger', 'The Gunslinger'],
    ['12 The Gunslinger.m4b', 'The Gunslinger'],
  ])('strips leading track number from "%s"', (input, expected) => {
    expect(cleanSearchString(input)).toBe(expected);
  });

  it('converts underscores to spaces', () => {
    expect(cleanSearchString('The_Gunslinger')).toBe('The Gunslinger');
  });

  it('collapses internal whitespace', () => {
    expect(cleanSearchString('The   Gunslinger    Book')).toBe('The Gunslinger Book');
  });

  it('combines multiple transformations', () => {
    expect(
      cleanSearchString('01_The_Gunslinger_[B019NOKST6]_(1982).m4b'),
    ).toBe('The Gunslinger');
  });
});

describe('buildSearchTerm', () => {
  it('uses tags when title is present (title + author + narrator)', () => {
    expect(
      buildSearchTerm(
        { title: 'The Gunslinger', author: 'Stephen King', narrator: 'George Guidall' },
        'whatever.m4b',
      ),
    ).toEqual({
      searchTerm: 'The Gunslinger Stephen King George Guidall',
      source: 'tags',
    });
  });

  it('uses title alone when no other metadata fields are present', () => {
    expect(buildSearchTerm({ title: 'The Gunslinger' }, 'whatever.m4b')).toEqual({
      searchTerm: 'The Gunslinger',
      source: 'tags',
    });
  });

  it('falls back to folder name when no title and folder is non-generic', () => {
    expect(
      buildSearchTerm({}, 'track01.m4b', 'The Gunslinger (B019NOKST6)'),
    ).toEqual({ searchTerm: 'The Gunslinger', source: 'folder_name' });
  });

  it('falls back to file name when folder name is generic', () => {
    expect(buildSearchTerm({}, 'The Gunslinger Chapter 1.m4b', 'CD1')).toEqual({
      searchTerm: 'The Gunslinger Chapter 1',
      source: 'file_name',
    });
  });

  it.each([
    'CD1',
    'CD 1',
    'cd2',
    'Disc 2',
    'disc3',
    'Disk 4',
    'DISK 5',
    'Part 1',
    'part2',
    'Vol 1',
    'vol2',
    'Volume 3',
    'VOLUME 99',
  ])('treats "%s" as a generic folder name', (folderName) => {
    const result = buildSearchTerm({}, 'whatever.m4b', folderName);
    expect(result.source).toBe('file_name');
  });

  it.each(['CD Player', 'Discworld', 'Particle Physics', 'Volumetric Sound'])(
    'does not treat "%s" as a generic folder name',
    (folderName) => {
      const result = buildSearchTerm({}, 'whatever.m4b', folderName);
      expect(result.source).toBe('folder_name');
    },
  );

  it('falls back to file name when no title and no folder is provided', () => {
    expect(buildSearchTerm({}, '01 - The Gunslinger.m4b')).toEqual({
      searchTerm: 'The Gunslinger',
      source: 'file_name',
    });
  });
});

describe('discoverAudiobooks integration', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rmab-bulk-import-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function createAudioFiles(dir: string, names: string[]): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
    for (const name of names) {
      await fs.writeFile(path.join(dir, name), '');
    }
  }

  function fwd(p: string): string {
    return p.replace(/\\/g, '/');
  }

  it('absorbs untagged files into the single tagged group in the same folder', async () => {
    const bookDir = path.join(tmpDir, 'The Gunslinger');
    await createAudioFiles(bookDir, ['01.m4b', '02.m4b', '03.m4b']);

    mockFfprobeByFile({
      [fwd(path.join(bookDir, '01.m4b'))]: {
        album: 'The Gunslinger',
        album_artist: 'Stephen King',
      },
      [fwd(path.join(bookDir, '02.m4b'))]: {
        album: 'The Gunslinger',
        album_artist: 'Stephen King',
      },
      // 03.m4b returns empty tags -> ungrouped, then absorbed
    });

    const results = await discoverAudiobooks(tmpDir);

    expect(results).toHaveLength(1);
    expect(results[0].audioFileCount).toBe(3);
    expect(results[0].audioFiles).toEqual(['01.m4b', '02.m4b', '03.m4b']);
    expect(results[0].metadata.title).toBe('The Gunslinger');
    expect(results[0].metadataSource).toBe('tags');
  });

  it('keeps untagged group separate when multiple tagged groups exist in the same folder', async () => {
    const mixedDir = path.join(tmpDir, 'Mixed');
    await createAudioFiles(mixedDir, ['a1.m4b', 'b1.m4b', 'untagged.m4b']);

    mockFfprobeByFile({
      [fwd(path.join(mixedDir, 'a1.m4b'))]: {
        album: 'Book A',
        album_artist: 'Author A',
      },
      [fwd(path.join(mixedDir, 'b1.m4b'))]: {
        album: 'Book B',
        album_artist: 'Author B',
      },
      // untagged.m4b empty
    });

    const results = await discoverAudiobooks(tmpDir);

    expect(results).toHaveLength(3);
    const titles = results.map((r) => r.metadata.title).sort();
    expect(titles).toEqual(['Book A', 'Book B', undefined]);

    const untagged = results.find((r) => !r.metadata.title);
    expect(untagged?.audioFiles).toEqual(['untagged.m4b']);
    expect(untagged?.metadataSource).toBe('folder_name');
  });

  it('re-derives extractedAsin from the common parent on cross-folder merge', async () => {
    const parentDir = path.join(tmpDir, 'Some Book (B019NOKST6)');
    const cd1Dir = path.join(parentDir, 'CD1');
    const cd2Dir = path.join(parentDir, 'CD2');
    await createAudioFiles(cd1Dir, ['01.m4b']);
    await createAudioFiles(cd2Dir, ['02.m4b']);

    mockFfprobeByFile({
      [fwd(path.join(cd1Dir, '01.m4b'))]: {
        album: 'Some Book',
        album_artist: 'Some Author',
      },
      [fwd(path.join(cd2Dir, '02.m4b'))]: {
        album: 'Some Book',
        album_artist: 'Some Author',
      },
    });

    const results = await discoverAudiobooks(tmpDir);

    expect(results).toHaveLength(1);
    const merged = results[0];
    expect(merged.folderName).toBe('Some Book (B019NOKST6)');
    expect(merged.extractedAsin).toBe('B019NOKST6');
    expect(merged.audioFileCount).toBe(2);
    expect(merged.audioFiles.sort()).toEqual(['CD1/01.m4b', 'CD2/02.m4b']);
  });

  it('extracts ASIN from a single-folder book', async () => {
    const bookDir = path.join(tmpDir, 'The Gunslinger (B019NOKST6)');
    await createAudioFiles(bookDir, ['01.m4b']);

    mockFfprobeByFile({
      [fwd(path.join(bookDir, '01.m4b'))]: {
        album: 'The Gunslinger',
        album_artist: 'Stephen King',
      },
    });

    const results = await discoverAudiobooks(tmpDir);

    expect(results).toHaveLength(1);
    expect(results[0].extractedAsin).toBe('B019NOKST6');
  });
});
