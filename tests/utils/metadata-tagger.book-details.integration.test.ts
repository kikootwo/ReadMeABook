/**
 * Component: Metadata Tagging Integration Tests (publisher, subtitle, language; real ffmpeg)
 * Documentation: documentation/phase3/file-organization.md
 *
 * The organizer's order: the tagging pass, then the one ASIN step on the tagged copy.
 * Every source already carries old values for the three fields: a new tag must
 * replace the source's, never sit next to it (#397: a second FLAC DESCRIPTION read
 * as "old;new"). Read back with ffprobe, the reader Audiobookshelf uses, matching
 * keys case-insensitively as Audiobookshelf does; MP3 also frame by frame, since
 * ffprobe merges ID3 frames with the same key and could not show a duplicate.
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

/** An ID3 text frame's body as text: the encoding byte read, NUL separators shown as '|'. */
function id3Text(body: Buffer): string {
  const data = body.subarray(1);
  let text: string;
  if (body[0] === 1 || body[0] === 2) {
    const be = data[0] === 0xfe && data[1] === 0xff;
    const units = Buffer.from(data.subarray(body[0] === 1 ? 2 : 0));
    if (be || body[0] === 2) units.swap16();
    text = units.toString('utf16le');
  } else {
    text = data.toString(body[0] === 3 ? 'utf8' : 'latin1');
  }
  return text.replace(/\0+$/, '').replace(/\0+/g, '|');
}

/** The ID3v2 frames of an mp3 as written, in file order. */
function id3Frames(file: string): Array<{ id: string; text: string }> {
  const buf = fs.readFileSync(file);
  if (buf.toString('latin1', 0, 3) !== 'ID3') throw new Error('no ID3v2 tag');
  if (buf[5] & 0x40) throw new Error('ID3 extended header not handled');
  const syncsafe = (o: number) => (buf[o] << 21) | (buf[o + 1] << 14) | (buf[o + 2] << 7) | buf[o + 3];
  const end = 10 + syncsafe(6);
  const frames: Array<{ id: string; text: string }> = [];
  for (let o = 10; o + 10 <= end && buf[o] !== 0; ) {
    const size = buf[3] >= 4 ? syncsafe(o + 4) : buf.readUInt32BE(o + 4);
    frames.push({ id: buf.toString('latin1', o, o + 4), text: id3Text(buf.subarray(o + 10, o + 10 + size)) });
    o += 10 + size;
  }
  return frames;
}

const framesOf = (frames: Array<{ id: string; text: string }>, id: string) => frames.filter((f) => f.id === id).map((f) => f.text);
const txxxSubtitles = (frames: Array<{ id: string; text: string }>) =>
  framesOf(frames, 'TXXX').filter((text) => text.toLowerCase().startsWith('subtitle|'));

describe('the MP4 post-step refuses all tags or none', () => {
  it('a refused write names every tag it was given (the file is unchanged)', async () => {
    const file = path.join(workDir(), 'refused.m4b');
    fs.writeFileSync(file, 'not an mp4');

    const result = await addFreeformTags(file, [
      { name: 'ASIN', value: 'B0TESTASIN' },
      { name: 'PUBLISHER', value: 'Pen\u0000guin' },
    ]);

    expect(result).toEqual({ written: false, warning: 'ASIN, PUBLISHER tags not written (Invalid value for freeform tag PUBLISHER)' });
    expect(fs.readFileSync(file, 'utf8')).toBe('not an mp4');
  });
});

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
    // Before the ASIN step: the remux carried none of the source's three over
    for (const key of ['publisher', 'subtitle', 'language']) expect(await valuesOf(tagged, key), `${key} before the ASIN step`).toEqual([]);
    for (const name of ['PUBLISHER', 'subtitle', 'LANGUAGE']) expect(countFreeform(tagged, name), `${name} item before the ASIN step`).toBe(0);
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
    expect(await valuesOf(tagged, 'subtitle')).toEqual(['Half \uFFFD pair']);
    expect(await valuesOf(tagged, 'publisher')).toEqual([]);
  }, 60_000);

  it.each([
    ['U+FFFE', '\uFFFE'],
    ['U+FFFF', '\uFFFF'],
  ])('m4b: a %s in a value (ffprobe would not read it back) is replaced, so the ASIN still lands', async (_label, char) => {
    const file = await makeM4b(workDir(), `details-nchar-${char.charCodeAt(0).toString(16)}.m4b`, { faststart: true });

    const step = await addMp4FreeformTags(file, '.m4b', { asin: 'B0TESTASIN', publisher: `Pub ${char} lisher` });

    expect(step).toEqual({ written: true });
    expect(await valuesOf(file, 'asin')).toEqual(['B0TESTASIN']);
    expect(await valuesOf(file, 'publisher')).toEqual(['Pub \uFFFD lisher']);
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
    const before = id3Frames(src);
    expect([framesOf(before, 'TPUB'), framesOf(before, 'TIT3'), framesOf(before, 'TLAN')]).toEqual([['Old Publisher'], ['Old TIT3'], ['deu']]);
    expect(txxxSubtitles(before)).toEqual(['SUBTITLE|Old custom subtitle']);

    const result = await tagAudioFileMetadata(src, BOOK);
    expect(result.success).toBe(true);
    const tagged = result.taggedFilePath!;

    expect(await valuesOf(tagged, 'tit3')).toEqual(['An Easy & Proven Way']);
    expect(await valuesOf(tagged, 'subtitle')).toEqual([]);
    expect(await valuesOf(tagged, 'publisher')).toEqual(['Penguin Audio']);
    expect(await valuesOf(tagged, 'language')).toEqual(['English']);
    // Frame by frame: exactly one of each, no TXXX subtitle left
    const after = id3Frames(tagged);
    expect([framesOf(after, 'TPUB'), framesOf(after, 'TIT3'), framesOf(after, 'TLAN')]).toEqual([
      ['Penguin Audio'],
      ['An Easy & Proven Way'],
      ['English'],
    ]);
    expect(txxxSubtitles(after)).toEqual([]);
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
