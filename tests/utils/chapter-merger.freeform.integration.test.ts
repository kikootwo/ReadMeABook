/**
 * Component: Chapter Merge ASIN Tag Integration Tests (real ffmpeg/ffprobe)
 * Documentation: documentation/features/chapter-merging.md
 *
 * The merger writes the ASIN only when no tagging pass follows (the tagger
 * re-muxes the file and writes it itself). Covers merging on + tagging off
 * (the merged file goes to the library as the merger wrote it) and merging on
 * + tagging on. Skips without ffmpeg/ffprobe on PATH.
 */

import * as fs from 'fs';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzeChapterFiles, mergeChapters } from '@/lib/utils/chapter-merger';
import { tagAudioFileMetadata } from '@/lib/utils/metadata-tagger';
import { available, chapters, makeWorkDir, removeWorkDir } from './merge-audio.helpers';
import { audioMd5, countFreeform, probe, topLevelTypes } from './mp4-tags.helpers';

let dir: string;
const AAC = ['-c:a', 'aac', '-b:a', '64k'];

async function mergeBook(name: string, writeFreeformTags: boolean) {
  const files = await chapters(name, 2, 4, AAC, 'm4a');
  const outputPath = path.join(dir, 'out', `${name}.m4b`);
  const result = await mergeChapters(await analyzeChapterFiles(files), {
    title: 'Book',
    author: 'Author',
    asin: 'B0TESTASIN',
    outputPath,
    writeFreeformTags,
  });
  return { result, outputPath };
}

describe.skipIf(!available)('chapter merge ASIN tag (real ffmpeg)', () => {
  beforeAll(() => {
    dir = makeWorkDir();
  });
  afterAll(() => removeWorkDir());

  it('merging on, tagging off: the merged file carries the ASIN, moov first, chapters intact, verified', async () => {
    const { result, outputPath } = await mergeBook('tagging-off', true);
    expect(result.success).toBe(true);
    expect(result.durationVerified).toBe(true);
    const { tags, chapters: marks } = await probe(outputPath);
    expect(tags.ASIN).toBe('B0TESTASIN');
    expect(tags.album_artist).toBe('Author');
    expect(marks).toHaveLength(2);
    expect(countFreeform(outputPath, 'ASIN')).toBe(1);
    expect(topLevelTypes(outputPath).slice(0, 2)).toEqual(['ftyp', 'moov']);
    expect(fs.readdirSync(path.join(dir, 'out')).filter((f) => f.includes('.tags-'))).toEqual([]);
  }, 120_000);

  it('merging on, tagging on: the merger leaves the ASIN to the tagger; the tagged copy has it once, moov first', async () => {
    const { result, outputPath } = await mergeBook('tagging-on', false);
    expect(result.success).toBe(true);
    expect((await probe(outputPath)).tags.ASIN).toBeUndefined();
    const md5 = await audioMd5(outputPath);

    const tagged = await tagAudioFileMetadata(outputPath, { title: 'Book', author: 'Author', asin: 'B0TESTASIN' });
    expect(tagged.success).toBe(true);
    const file = tagged.taggedFilePath!;
    expect((await probe(file)).tags.ASIN).toBe('B0TESTASIN');
    expect(countFreeform(file, 'ASIN')).toBe(1);
    expect(topLevelTypes(file).slice(0, 2)).toEqual(['ftyp', 'moov']);
    expect(await audioMd5(file)).toBe(md5);
  }, 120_000);
});
