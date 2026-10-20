/**
 * Component: Chapter Merge ASIN Tag Integration Tests (real ffmpeg/ffprobe)
 * Documentation: documentation/features/chapter-merging.md
 *
 * The organizer's pipeline on real files: merge, optional tagging pass, then
 * the one ASIN step (addMp4FreeformTags) on the file about to be placed.
 * Merging on + tagging off: the merged file; merging on + tagging on: the
 * tagged copy of it. Skips without ffmpeg/ffprobe on PATH.
 */

import * as fs from 'fs';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzeChapterFiles, mergeChapters } from '@/lib/utils/chapter-merger';
import { PARTIAL_FILE_PATTERN } from '@/lib/utils/copy-file';
import { addMp4FreeformTags, tagAudioFileMetadata } from '@/lib/utils/metadata-tagger';
import { available, chapters, makeWorkDir, removeWorkDir } from './merge-audio.helpers';
import { audioMd5, countFreeform, probe, topLevelTypes } from './mp4-tags.helpers';

let dir: string;
const AAC = ['-c:a', 'aac', '-b:a', '64k'];
const BOOK = { title: 'Book', author: 'Author', asin: 'B0TESTASIN' };

async function mergeBook(name: string) {
  const files = await chapters(name, 2, 4, AAC, 'm4a');
  const outputPath = path.join(dir, 'out', `${name}.m4b`);
  const result = await mergeChapters(await analyzeChapterFiles(files), { title: BOOK.title, author: BOOK.author, outputPath });
  return { result, outputPath };
}

const partials = (folder: string) => fs.readdirSync(folder).filter((f) => PARTIAL_FILE_PATTERN.test(f));

describe.skipIf(!available)('chapter merge ASIN tag (real ffmpeg)', () => {
  beforeAll(() => {
    dir = makeWorkDir();
  });
  afterAll(() => removeWorkDir());

  it('merging on, tagging off: the verified merged file gets the ASIN, moov first, chapters and audio intact', async () => {
    const { result, outputPath } = await mergeBook('tagging-off');
    expect(result.success).toBe(true);
    expect(result.durationVerified).toBe(true); // the merge is checked before the ASIN step runs
    expect((await probe(outputPath)).tags.ASIN).toBeUndefined(); // the merger never writes it
    const md5 = await audioMd5(outputPath);

    expect(await addMp4FreeformTags(outputPath, '.m4b', BOOK)).toEqual({ written: true });
    const { tags, chapters: marks } = await probe(outputPath);
    expect(tags.ASIN).toBe('B0TESTASIN');
    expect(tags.album_artist).toBe('Author');
    expect(marks).toHaveLength(2);
    expect(countFreeform(outputPath, 'ASIN')).toBe(1);
    expect(topLevelTypes(outputPath).slice(0, 2)).toEqual(['ftyp', 'moov']);
    expect(await audioMd5(outputPath)).toBe(md5);
    expect(partials(path.join(dir, 'out'))).toEqual([]);
  }, 120_000);

  it('merging on, tagging on: the tagged copy of the merge gets the ASIN once, moov first', async () => {
    const { result, outputPath } = await mergeBook('tagging-on');
    expect(result.success).toBe(true);
    const md5 = await audioMd5(outputPath);

    const tagged = await tagAudioFileMetadata(outputPath, BOOK);
    expect(tagged.success).toBe(true);
    const file = tagged.taggedFilePath!;
    expect(topLevelTypes(file).slice(0, 2)).toEqual(['ftyp', 'moov']); // +faststart, before the ASIN step
    expect((await probe(file)).tags.ASIN).toBeUndefined();

    expect(await addMp4FreeformTags(file, '.m4b', BOOK)).toEqual({ written: true });
    expect((await probe(file)).tags.ASIN).toBe('B0TESTASIN');
    expect(countFreeform(file, 'ASIN')).toBe(1);
    expect(topLevelTypes(file).slice(0, 2)).toEqual(['ftyp', 'moov']);
    expect(await audioMd5(file)).toBe(md5);
  }, 120_000);
});
