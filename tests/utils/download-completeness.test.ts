/**
 * Component: Download completeness tests
 * Documentation: documentation/backend/services/list-sync.md
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { audioBytes, truncatedDownloadReason } from '@/lib/utils/download-completeness';

const MB = 1024 * 1024;

describe('truncatedDownloadReason', () => {
  it('refuses a single part of a long book (the Defiant case)', () => {
    const reason = truncatedDownloadReason(29 * MB, 540, 0.15);
    expect(reason).toContain('Incomplete download');
    expect(reason).toContain('29 MB');
    expect(reason).toContain('9-hour');
  });
  it('accepts a normal download and a low-bitrate one just above the floor', () => {
    expect(truncatedDownloadReason(400 * MB, 540, 0.15)).toBeNull();
    expect(truncatedDownloadReason(82 * MB, 540, 0.15)).toBeNull();
  });
  it('does not judge when the runtime is unknown or the check is off', () => {
    expect(truncatedDownloadReason(29 * MB, undefined, 0.15)).toBeNull();
    expect(truncatedDownloadReason(29 * MB, 0, 0.15)).toBeNull();
    expect(truncatedDownloadReason(29 * MB, 540, 0)).toBeNull();
    expect(truncatedDownloadReason(0, 540, 0.15)).toBeNull();
  });
});

describe('audioBytes', () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('adds audio files in nested folders and ignores everything else', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'completeness-'));
    await mkdir(path.join(dir, 'CD1'));
    await writeFile(path.join(dir, 'CD1', 'part1.mp3'), Buffer.alloc(1000));
    await writeFile(path.join(dir, 'book.m4b'), Buffer.alloc(2000));
    await writeFile(path.join(dir, 'cover.jpg'), Buffer.alloc(5000));
    await writeFile(path.join(dir, 'info.nfo'), Buffer.alloc(300));
    expect(await audioBytes(dir)).toBe(3000);
  });
  it('measures a single file path and returns 0 for a missing one', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'completeness-'));
    const file = path.join(dir, 'one.mp3');
    await writeFile(file, Buffer.alloc(777));
    expect(await audioBytes(file)).toBe(777);
    expect(await audioBytes(path.join(dir, 'missing'))).toBe(0);
  });
});
