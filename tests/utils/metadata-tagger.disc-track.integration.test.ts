/**
 * Component: Metadata Tagging Integration Tests (disc and track of a multi-disc book; real ffmpeg)
 * Documentation: documentation/features/multi-disc-folders.md
 *
 * A multi-disc import writes each file's disc (`d/D`) and its track across the
 * book (`n/N`), replacing the per-disc numbers the source carries. Read back with
 * ffprobe, the reader Audiobookshelf uses, under the keys it reads (`track`, `disc`).
 */

import fs from 'fs';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { addMp4FreeformTags, tagAudioFileMetadata } from '@/lib/utils/metadata-tagger';
import { available, ffmpeg, makeDir, probe } from './mp4-tags.helpers';

const BOOK = { title: 'Book', author: 'Author' };

let dir = '';
const workDir = () => (dir ||= makeDir('rmab-disc-track-it-'));
afterAll(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

const FORMATS: Array<[string, string[]]> = [
  ['m4a', ['-c:a', 'aac', '-b:a', '32k', '-f', 'mp4']],
  ['mp3', ['-c:a', 'libmp3lame', '-f', 'mp3']],
  ['flac', ['-c:a', 'flac', '-f', 'flac']],
];

/** A one-second file carrying a per-disc track number, as a ripper writes it. */
async function makeSource(ext: string, codec: string[]): Promise<string> {
  const out = path.join(workDir(), `src.${ext}`);
  await ffmpeg(['-y', '-f', 'lavfi', '-i', 'anullsrc=channel_layout=mono:sample_rate=22050', '-t', '1', ...codec,
    '-metadata', 'track=2/10', '-metadata', 'title=Chapter Two', out]);
  return out;
}

/** The ffprobe tag keys whose name is `key` in any case, with their values. */
async function tagEntries(file: string, key: string): Promise<Array<[string, string]>> {
  const { tags } = await probe(file);
  return Object.entries(tags).filter(([k]) => k.toLowerCase() === key);
}

describe.skipIf(!available)('disc and track tags (real ffmpeg)', () => {
  it.each(FORMATS)('%s: track n/N and disc d/D replace the source numbers, read back as `track` and `disc`', async (ext, codec) => {
    const src = await makeSource(ext, codec);
    const result = await tagAudioFileMetadata(src, BOOK, { disc: '2/3', track: '12/20' });
    expect(result.success, result.error).toBe(true);
    const tagged = result.taggedFilePath!;
    if (ext === 'm4a') {
      // The organizer's ASIN step on the tagged copy keeps the trkn and disk atoms
      expect(await addMp4FreeformTags(tagged, '.m4a', { asin: 'B0TESTASIN' })).toEqual({ written: true });
    }
    expect(await tagEntries(tagged, 'track')).toEqual([['track', '12/20']]);
    expect(await tagEntries(tagged, 'disc')).toEqual([['disc', '2/3']]);
    expect((await probe(tagged)).tags.title).toBe('Book');
  }, 60_000);

  it.each(FORMATS)('%s: without a position the source track number is left as it is (as before)', async (ext, codec) => {
    const src = await makeSource(ext, codec);
    const result = await tagAudioFileMetadata(src, BOOK);
    expect(result.success, result.error).toBe(true);
    expect(await tagEntries(result.taggedFilePath!, 'track')).toEqual([['track', '2/10']]);
    expect(await tagEntries(result.taggedFilePath!, 'disc')).toEqual([]);
  }, 60_000);
});
