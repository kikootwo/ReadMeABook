/**
 * Component: Cover Art Placement Tests (real filesystem)
 * Documentation: documentation/phase3/file-organization.md
 *
 * The real organizer on real temp folders: a cover.jpg already in the library
 * is never replaced, and an interrupted cover write never leaves a partial
 * cover.jpg behind.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const coverState = vi.hoisted(() => ({ cacheDir: '', data: Buffer.from(''), failWrites: false, partialPrefix: '' }));

/** Write half of the data, then fail (an interrupted write: full disk, I/O error, ...). */
function interruptedError(): NodeJS.ErrnoException {
  return Object.assign(new Error('EIO: i/o error, write (simulated interruption)'), { code: 'EIO' });
}

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  const open = (async (file: unknown, ...rest: unknown[]) => {
    const handle = await (actual.open as (...a: unknown[]) => Promise<import('fs/promises').FileHandle>)(file, ...rest);
    if (!coverState.failWrites || !path.basename(String(file)).startsWith(coverState.partialPrefix)) return handle;
    const write = handle.write.bind(handle) as (buffer: Buffer, offset: number, length: number) => Promise<unknown>;
    return Object.assign(handle, {
      write: async (buffer: Buffer, offset = 0, length = buffer.length - offset) => {
        await write(buffer, offset, Math.floor(length / 2));
        throw interruptedError();
      },
    });
  }) as typeof actual.open;
  const writeFile = (async (file: unknown, data: unknown, ...rest: unknown[]) => {
    if (coverState.failWrites && String(file).endsWith('cover.jpg')) {
      const bytes = Buffer.from(data as Buffer);
      await actual.writeFile(String(file), bytes.subarray(0, Math.floor(bytes.length / 2)));
      throw interruptedError();
    }
    return (actual.writeFile as (...a: unknown[]) => Promise<void>)(file, data, ...rest);
  }) as typeof actual.writeFile;
  return { ...actual, default: { ...actual, open, writeFile }, open, writeFile };
});

vi.mock('@/lib/db', () => ({
  prisma: { configuration: { findUnique: vi.fn(async () => null) } },
}));

vi.mock('axios', () => {
  const get = vi.fn(async () => ({ data: coverState.data }));
  return { default: { get }, get };
});

vi.mock('@/lib/utils/cover-art-url', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils/cover-art-url')>();
  return {
    ...actual,
    cachedThumbnailPath: (url: string | null | undefined) => {
      const resolved = actual.cachedThumbnailPath(url);
      return resolved ? path.join(coverState.cacheDir, path.basename(resolved)) : null;
    },
  };
});

import axios from 'axios';
import { partialNameHash } from '@/lib/utils/copy-file';
import { FileOrganizer } from '@/lib/utils/file-organizer';

const REMOTE_COVER = 'https://m.media-amazon.com/images/I/cover.jpg';
const CACHED_COVER = '/api/cache/thumbnails/abc123.jpg';

let root: string;
let media: string;
let source: string;
let libraryCover: string;

function write(file: string, data: string | Buffer): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  return file;
}

async function organize(coverArtUrl: string) {
  const organizer = new FileOrganizer(media, path.join(root, 'tmp'));
  return organizer.organize(source, { title: 'Book', author: 'Author', coverArtUrl }, '{author}/{title}');
}

function partialsIn(dir: string): string[] {
  return fs.readdirSync(dir).filter((name) => name.startsWith('.rmab-partial-'));
}

describe('FileOrganizer cover art', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-cover-')));
    media = path.join(root, 'media');
    source = path.join(root, 'downloads', 'Book.Name');
    libraryCover = path.join(media, 'Author', 'Book', 'cover.jpg');
    coverState.cacheDir = path.join(root, 'cache');
    coverState.data = Buffer.from('downloaded-cover-bytes');
    coverState.failWrites = false;
    // Only the cover's partial is interrupted; the audio copy goes through
    coverState.partialPrefix = `.rmab-partial-${partialNameHash('cover.jpg')}-`;
    write(path.join(source, 'Book.m4b'), 'audio');
    write(path.join(coverState.cacheDir, 'abc123.jpg'), 'cached-cover-bytes');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.each([
    ['a downloaded cover', REMOTE_COVER],
    ['a cached thumbnail', CACHED_COVER],
  ])('leaves an existing, different cover.jpg untouched (%s)', async (_label, coverArtUrl) => {
    write(libraryCover, 'the-library-cover');

    const result = await organize(coverArtUrl);

    expect(result.success).toBe(true);
    expect(fs.readFileSync(libraryCover, 'utf8')).toBe('the-library-cover');
    expect(result.coverArtFile).toBe(libraryCover);
    expect(result.errors).toEqual([]);
    expect(partialsIn(path.dirname(libraryCover))).toEqual([]);
    // A cover that will be kept is not fetched
    expect(axios.get).not.toHaveBeenCalled();
  });

  it.each([
    ['a downloaded cover', REMOTE_COVER, 'downloaded-cover-bytes'],
    ['a cached thumbnail', CACHED_COVER, 'cached-cover-bytes'],
  ])('writes cover.jpg when the library has none (%s)', async (_label, coverArtUrl, expected) => {
    const result = await organize(coverArtUrl);

    expect(fs.readFileSync(libraryCover, 'utf8')).toBe(expected);
    expect(result.coverArtFile).toBe(libraryCover);
    expect(partialsIn(path.dirname(libraryCover))).toEqual([]);
  });

  it.each([
    ['a downloaded cover', REMOTE_COVER, 'downloaded-cover-bytes'],
    ['a cached thumbnail', CACHED_COVER, 'cached-cover-bytes'],
  ])('replaces an empty cover.jpg (left by an older interrupted write) with %s', async (_label, coverArtUrl, expected) => {
    write(libraryCover, '');

    const result = await organize(coverArtUrl);

    expect(fs.readFileSync(libraryCover, 'utf8')).toBe(expected);
    expect(result.errors).toEqual([]);
    expect(partialsIn(path.dirname(libraryCover))).toEqual([]);
  });

  it('keeps the existing cover on a re-import with the same cover', async () => {
    write(libraryCover, 'downloaded-cover-bytes');

    const result = await organize(REMOTE_COVER);

    expect(fs.readFileSync(libraryCover, 'utf8')).toBe('downloaded-cover-bytes');
    expect(result.errors).toEqual([]);
  });

  it('leaves no partial cover.jpg after an interrupted write, and reports the failure', async () => {
    coverState.failWrites = true;

    const result = await organize(REMOTE_COVER);

    expect(result.success).toBe(true);
    expect(fs.existsSync(libraryCover)).toBe(false);
    expect(partialsIn(path.dirname(libraryCover))).toEqual([]);
    expect(result.errors).toContain('Failed to download cover art');
    expect(result.coverArtFile).toBeUndefined();
  });

  it('writes the cover on the next import after a crash left only a hidden partial', async () => {
    const crashLeftover = write(path.join(path.dirname(libraryCover), '.rmab-partial-0123456789ab-0011223344556677.part'), 'half');
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    fs.utimesSync(crashLeftover, old, old);

    await organize(REMOTE_COVER);

    expect(fs.readFileSync(libraryCover, 'utf8')).toBe('downloaded-cover-bytes');
    expect(partialsIn(path.dirname(libraryCover))).toEqual([]);
  });
});
