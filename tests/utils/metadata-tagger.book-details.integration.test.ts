/**
 * Component: Metadata Tagging Integration Tests (publisher, subtitle, language; real ffmpeg)
 * Documentation: documentation/phase3/file-organization.md
 *
 * The organizer's order: the tagging pass, then the one ASIN step on the tagged copy.
 * Every source already carries old values for the three fields: a new tag must
 * replace the source's, never sit next to it (#397: a second FLAC DESCRIPTION read
 * as "old;new"). Read back with ffprobe, the reader Audiobookshelf uses, matching
 * keys case-insensitively as Audiobookshelf does.
 */

import fs from 'fs';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { addMp4FreeformTags, tagAudioFileMetadata } from '@/lib/utils/metadata-tagger';
import { addFreeformTags } from '@/lib/utils/mp4-freeform-tags';
import { available, countFreeform, ffmpeg, makeDir, makeM4b, probe } from './mp4-tags.helpers';

const DETAILS = { publisher: 'Penguin Audio', subtitle: 'An Easy & Proven Way', language: 'english' };
const BOOK = { title: 'Book', author: 'Author', ...DETAILS };

let dir = '';
const workDir = () => (dir ||= makeDir('rmab-book-details-it-'));
afterAll(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

/** Every value ffprobe reports under `key`, whatever its case. */
async function valuesOf(file: string, key: string): Promise<string[]> {
  const { tags } = await probe(file);
  return Object.entries(tags)
    .filter(([k]) => k.toLowerCase() === key.toLowerCase())
    .map(([, v]) => v);
}

/** A one-second audio file in `codec` carrying `tags` (written by ffmpeg, as a tagger would). */
async function makeTagged(name: string, codec: string[], tags: Record<string, string>): Promise<string> {
  const out = path.join(workDir(), name);
  const metadata = Object.entries(tags).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]);
  await ffmpeg(['-y', '-f', 'lavfi', '-i', 'anullsrc=channel_layout=mono:sample_rate=22050', '-t', '1', ...codec, ...metadata, out]);
  return out;
}

describe.skipIf(!available)('publisher, subtitle, language (real ffmpeg)', () => {
  it('m4b: the tagging pass drops the source\'s freeform tags; the ASIN step writes PUBLISHER, SUBTITLE and LANGUAGE once each, next to the ASIN', async () => {
    const src = await makeM4b(workDir(), 'details-src.m4b', { faststart: true });
    // A source that already carries the three, as other taggers write them
    expect(
      await addFreeformTags(src, [
        { name: 'PUBLISHER', value: 'Old Publisher' },
        { name: 'subtitle', value: 'Old Subtitle' },
        { name: 'LANGUAGE', value: 'german' },
      ])
    ).toEqual({ written: true });

    const result = await tagAudioFileMetadata(src, { ...BOOK, asin: 'B0TESTASIN' });
    expect(result.success).toBe(true);
    const tagged = result.taggedFilePath!;
    expect(await addMp4FreeformTags(tagged, '.m4b', { asin: 'B0TESTASIN', ...DETAILS })).toEqual({ written: true });

    expect(await valuesOf(tagged, 'asin')).toEqual(['B0TESTASIN']);
    expect(await valuesOf(tagged, 'publisher')).toEqual(['Penguin Audio']);
    expect(await valuesOf(tagged, 'subtitle')).toEqual(['An Easy & Proven Way']);
    expect(await valuesOf(tagged, 'language')).toEqual(['English']);
    for (const name of ['ASIN', 'PUBLISHER', 'SUBTITLE', 'LANGUAGE']) expect(countFreeform(tagged, name)).toBe(1);
    expect(countFreeform(tagged, 'subtitle')).toBe(0);
    expect(await valuesOf(tagged, 'title')).toEqual(['Book']);
  }, 60_000);

  it('m4b: the ASIN step replaces same-named freeform tags already in its input (any case)', async () => {
    const file = await makeM4b(workDir(), 'details-replace.m4b', { faststart: true });
    await addFreeformTags(file, [
      { name: 'publisher', value: 'Old Publisher' },
      { name: 'SUBTITLE', value: 'Old Subtitle' },
    ]);

    expect(await addMp4FreeformTags(file, '.m4b', DETAILS)).toEqual({ written: true });

    expect(await valuesOf(file, 'publisher')).toEqual(['Penguin Audio']);
    expect(await valuesOf(file, 'subtitle')).toEqual(['An Easy & Proven Way']);
    expect(countFreeform(file, 'publisher') + countFreeform(file, 'PUBLISHER')).toBe(1);
  }, 60_000);

  it('m4b: a value that sanitizes to nothing is left out, a lone surrogate replaced, and the ASIN still lands', async () => {
    const src = await makeM4b(workDir(), 'details-bad.m4b', { faststart: true });
    const result = await tagAudioFileMetadata(src, { title: 'Book', author: 'Author' });
    expect(result.success).toBe(true);
    const tagged = result.taggedFilePath!;

    const step = await addMp4FreeformTags(tagged, '.m4b', { asin: 'B0TESTASIN', publisher: ' \u0000 ', subtitle: 'Half \ud800 pair' });

    expect(step).toEqual({ written: true });
    expect(await valuesOf(tagged, 'asin')).toEqual(['B0TESTASIN']);
    expect(await valuesOf(tagged, 'subtitle')).toEqual(['Half � pair']);
    expect(await valuesOf(tagged, 'publisher')).toEqual([]);
  }, 60_000);

  it.each([
    ['U+FFFE', '￾'],
    ['U+FFFF', '￿'],
  ])('m4b: a %s in a value (ffprobe would not read it back) is replaced, so the ASIN still lands', async (_label, char) => {
    const file = await makeM4b(workDir(), `details-nchar-${char.charCodeAt(0).toString(16)}.m4b`, { faststart: true });

    const step = await addMp4FreeformTags(file, '.m4b', { asin: 'B0TESTASIN', publisher: `Pub ${char} lisher` });

    expect(step).toEqual({ written: true });
    expect(await valuesOf(file, 'asin')).toEqual(['B0TESTASIN']);
    expect(await valuesOf(file, 'publisher')).toEqual(['Pub � lisher']);
  }, 60_000);

  it('mp3: TPUB, TIT3 and TLAN replace the source\'s, and a source TXXX subtitle is cleared, not left next to TIT3', async () => {
    const src = await makeTagged('details-src.mp3', ['-c:a', 'libmp3lame', '-q:a', '9'], {
      TIT3: 'Old TIT3',
      SUBTITLE: 'Old custom subtitle',
      publisher: 'Old Publisher',
      language: 'deu',
    });
    expect(await valuesOf(src, 'subtitle')).toEqual(['Old custom subtitle']); // the fixture has both subtitle frames
    expect(await valuesOf(src, 'tit3')).toEqual(['Old TIT3']);

    const result = await tagAudioFileMetadata(src, BOOK);
    expect(result.success).toBe(true);
    const tagged = result.taggedFilePath!;

    expect(await valuesOf(tagged, 'tit3')).toEqual(['An Easy & Proven Way']);
    expect(await valuesOf(tagged, 'subtitle')).toEqual([]);
    expect(await valuesOf(tagged, 'publisher')).toEqual(['Penguin Audio']);
    expect(await valuesOf(tagged, 'language')).toEqual(['English']);
  }, 60_000);

  it('flac: publisher, subtitle and language replace the source\'s once each; ORGANIZATION is left as it is', async () => {
    const src = await makeTagged('details-src.flac', ['-c:a', 'flac'], {
      PUBLISHER: 'Old Publisher',
      SUBTITLE: 'Old Subtitle',
      LANGUAGE: 'german',
      ORGANIZATION: 'Old Label',
    });

    const result = await tagAudioFileMetadata(src, BOOK);
    expect(result.success).toBe(true);
    const tagged = result.taggedFilePath!;

    // ffprobe joins repeated Vorbis fields with ';', so one exact value proves there is one field
    expect(await valuesOf(tagged, 'publisher')).toEqual(['Penguin Audio']);
    expect(await valuesOf(tagged, 'subtitle')).toEqual(['An Easy & Proven Way']);
    expect(await valuesOf(tagged, 'language')).toEqual(['English']);
    expect(await valuesOf(tagged, 'organization')).toEqual(['Old Label']);
  }, 60_000);
});
