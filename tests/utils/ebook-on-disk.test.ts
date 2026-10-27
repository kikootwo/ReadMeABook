/**
 * Component: Ebook On Disk Check Tests (#313)
 * Documentation: documentation/integrations/ebook-sidecar.md
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { findEbookOnDisk } from '@/lib/utils/ebook-on-disk';

let root: string;

async function bookFolder(files: string[]): Promise<string> {
  const dir = await fs.mkdtemp(path.join(root, 'book-'));
  for (const file of files) {
    await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await fs.writeFile(path.join(dir, file), 'x');
  }
  return dir;
}

function debugLogger() {
  return { debug: vi.fn() } as unknown as Parameters<typeof findEbookOnDisk>[1] & { debug: ReturnType<typeof vi.fn> };
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rmab-313-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('findEbookOnDisk', () => {
  it.each([
    ['an epub', ['01.mp3', '02.mp3', 'Book.epub'], 'Book.epub'],
    ['an azw3', ['01.mp3', 'Book.azw3'], 'Book.azw3'],
    ['an upper-case extension', ['Book.m4b', 'Book.EPUB'], 'Book.EPUB'],
  ])('finds %s next to the audio', async (_label, files, expected) => {
    const dir = await bookFolder(files);
    expect(await findEbookOnDisk(dir)).toBe(expected);
  });

  it('prefers the organizer order when several ebook formats are present', async () => {
    const dir = await bookFolder(['Book.pdf', 'Book.epub', 'Book.mp3']);
    expect(await findEbookOnDisk(dir)).toBe('Book.epub');
  });

  it.each([
    ['an empty folder', []],
    ['a folder with only audio and a cover', ['01.mp3', '02.mp3', 'cover.jpg']],
    ['an ebook only inside a subfolder (no recursion)', ['01.mp3', 'Other Book/Other.epub']],
    ['a macOS resource-fork sidecar', ['01.mp3', '._Book.epub']],
  ])('answers no for %s', async (_label, files) => {
    const dir = await bookFolder(files);
    expect(await findEbookOnDisk(dir)).toBeNull();
  });

  it('answers no for a folder named like an ebook', async () => {
    const dir = await bookFolder(['01.mp3']);
    await fs.mkdir(path.join(dir, 'Extras.epub'));
    expect(await findEbookOnDisk(dir)).toBeNull();
  });

  it('answers no and logs once at debug for a missing folder', async () => {
    const logger = debugLogger();
    expect(await findEbookOnDisk(path.join(root, 'gone'), logger)).toBeNull();
    expect(logger.debug).toHaveBeenCalledTimes(1);
  });

  it('answers no and logs once at debug when the stored path is a file', async () => {
    const dir = await bookFolder(['Book.m4b']);
    const logger = debugLogger();
    expect(await findEbookOnDisk(path.join(dir, 'Book.m4b'), logger)).toBeNull();
    expect(logger.debug).toHaveBeenCalledTimes(1);
  });

  it.each([null, undefined, ''])('answers no without touching the disk for path %j', async (value) => {
    const logger = debugLogger();
    expect(await findEbookOnDisk(value, logger)).toBeNull();
    expect(logger.debug).toHaveBeenCalledTimes(1);
  });

  it('never changes the folder', async () => {
    const dir = await bookFolder(['01.mp3', 'Book.epub']);
    await findEbookOnDisk(dir);
    expect((await fs.readdir(dir)).sort()).toEqual(['01.mp3', 'Book.epub']);
  });
});
