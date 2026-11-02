/**
 * Component: Metadata Tagging chapter tests (real ffmpeg, #511)
 * Documentation: documentation/phase3/file-organization.md
 *
 * An M4B with a cover and chapters longer than 487 s, tagged the way the
 * organizer does it (ffmpeg remux, then the freeform step). Without
 * `-movie_timescale 1000`, ffmpeg 9.x drops or clamps those chapters' samples
 * in the QuickTime chapter track and still exits 0. The chapter table ffprobe
 * shows can look intact (it is rebuilt from the Nero `chpl` list) while the
 * track has lost samples, so the track's sample count and time base are
 * checked too. Fixtures are generated silence (about 0.7 MB in all). Skips
 * without ffmpeg/ffprobe.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMp4FreeformTags, tagAudioFileMetadata } from '@/lib/utils/metadata-tagger';
import { audioMd5, available, ffmpeg, makeDir } from './mp4-tags.helpers';

const execFileP = promisify(execFile);

interface Chapter { title: string; start: number; end: number }

/** The critic's trailing-long case: every chapter after the first short one is over 487 s. */
const TRAILING_LONG: Chapter[] = [
  { title: 'One', start: 0, end: 100 },
  { title: 'Two', start: 100, end: 700 },
  { title: 'Three', start: 700, end: 1300 },
];
/** The #511 repro shape: short and long chapters mixed, non-ASCII titles. */
const SIX_MIXED: Chapter[] = [
  { title: 'Kapitel 1 Straße', start: 0, end: 20.572 },
  { title: '第二章', start: 20.572, end: 1533.352 },
  { title: 'Глава 3', start: 1533.352, end: 2500 },
  { title: 'Kapitel 4', start: 2500, end: 2600 },
  { title: 'Kapitel 5', start: 2600, end: 2800 },
  { title: 'Kapitel 6 Ünïcode', start: 2800, end: 3000 },
];

const BOOK = { title: 'Tagged Title', author: 'Tag Author', narrator: 'Tag Narrator', asin: 'B0CHAPTERS' };

let dir = '';
let cover = '';

/**
 * Cover (attached_pic) + chapters over generated silence, 22.05 kHz mono AAC.
 * Audio and mux are separate runs (one run with lavfi + chapters + cover wrote
 * no audio stream). The mux pins the timescale, as ffmpeg 8 wrote it.
 */
async function makeSource(name: string, chapters: Chapter[]): Promise<string> {
  const total = chapters.at(-1)!.end;
  const audio = path.join(dir, `${name}.m4a`);
  const meta = path.join(dir, `${name}.txt`);
  const out = path.join(dir, `${name}.m4b`);
  await ffmpeg(['-y', '-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono', '-t', String(total), '-c:a', 'aac', '-b:a', '16k', audio]);
  const ms = (s: number) => Math.round(s * 1000);
  fs.writeFileSync(
    meta,
    ';FFMETADATA1\n' + chapters.map((c) => `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${ms(c.start)}\nEND=${ms(c.end)}\ntitle=${c.title}\n`).join('')
  );
  await ffmpeg([
    '-y', '-i', audio, '-i', cover, '-i', meta,
    '-map', '0:a', '-map', '1:v', '-map_chapters', '2', '-c', 'copy', '-disposition:v:0', 'attached_pic',
    '-metadata', 'title=Source Title', '-metadata', 'artist=Source Author',
    '-movie_timescale', '1000', '-f', 'mp4', out,
  ]);
  return out;
}

async function chapterTable(file: string): Promise<Chapter[]> {
  const { stdout } = await execFileP('ffprobe', ['-v', 'error', '-show_chapters', '-of', 'json', file]);
  return (JSON.parse(stdout).chapters ?? []).map((c: { start_time: string; end_time: string; tags?: { title?: string } }) => ({
    title: c.tags?.title ?? '',
    start: Number(c.start_time),
    end: Number(c.end_time),
  }));
}

/** The QuickTime chapter (text) track: one sample per chapter, in its time base. */
async function chapterTrack(file: string): Promise<{ samples: number; timeBase: string }> {
  const { stdout } = await execFileP('ffprobe', ['-v', 'error', '-select_streams', 'd', '-show_entries', 'stream=nb_frames,time_base', '-of', 'json', file]);
  const [stream] = JSON.parse(stdout).streams ?? [];
  return { samples: Number(stream?.nb_frames ?? 0), timeBase: stream?.time_base ?? 'none' };
}

async function hasCover(file: string): Promise<boolean> {
  const { stdout } = await execFileP('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream_disposition=attached_pic', '-of', 'csv=p=0', file]);
  return stdout.trim().split('\n').includes('1');
}

/** The organizer's two steps: ffmpeg tagging remux, then the MP4 freeform tags. */
async function tagLikeTheOrganizer(src: string): Promise<string> {
  const result = await tagAudioFileMetadata(src, BOOK);
  expect(result.error).toBeUndefined();
  const tagged = result.taggedFilePath!;
  expect(await addMp4FreeformTags(tagged, '.m4b', BOOK)).toEqual({ written: true });
  return tagged;
}

function expectSameTable(actual: Chapter[], expected: Chapter[]): void {
  expect(actual.map((c) => c.title)).toEqual(expected.map((c) => c.title));
  actual.forEach((c, i) => {
    expect(Math.abs(c.start - expected[i].start), `start of "${c.title}"`).toBeLessThanOrEqual(0.1);
    expect(Math.abs(c.end - expected[i].end), `end of "${c.title}"`).toBeLessThanOrEqual(0.1);
  });
}

describe.skipIf(!available)('tagging an M4B with a cover and long chapters keeps every chapter (real ffmpeg, #511)', () => {
  beforeAll(async () => {
    dir = makeDir('rmab-511-');
    cover = path.join(dir, 'cover.jpg');
    await ffmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=1', '-frames:v', '1', cover]);
  }, 60_000);

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it.each([
    ['trailing long chapters (100/600/600 s)', 'trail', TRAILING_LONG],
    ['six mixed chapters (20 s to 1513 s), non-ASCII titles', 'six', SIX_MIXED],
  ] as const)('%s: chapter table, chapter track samples and time base, cover and audio kept', async (_name, name, chapters) => {
    const src = await makeSource(name, chapters);
    // The source is sound: the table, and one 1/1000 sample per chapter
    expectSameTable(await chapterTable(src), chapters);
    expect(await chapterTrack(src)).toEqual({ samples: chapters.length, timeBase: '1/1000' });

    const tagged = await tagLikeTheOrganizer(src);

    // Values first, then the assertions (one run shows every difference)
    const table = await chapterTable(tagged);
    const track = await chapterTrack(tagged);
    const coverKept = await hasCover(tagged);
    const [srcMd5, taggedMd5] = await Promise.all([audioMd5(src), audioMd5(tagged)]);
    expect.soft(track, 'chapter track: one sample per chapter, 1/1000').toEqual({ samples: chapters.length, timeBase: '1/1000' });
    expect.soft(table.length, 'chapter count').toBe(chapters.length);
    expectSameTable(table, chapters);
    expect(coverKept, 'attached cover').toBe(true);
    expect(taggedMd5, 'audio packets').toBe(srcMd5);
  }, 120_000);
});
