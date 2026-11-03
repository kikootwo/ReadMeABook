/**
 * Component: E2E regression #511 (tagging an M4B with a cover keeps every chapter)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * ffmpeg 9 takes the LCM of every stream's time base as the mp4 movie timescale; with a cover
 * (1/90000) next to 22.05 kHz audio that is 4,410,000, and a chapter over 487 s no longer fits
 * the QuickTime chapter track: ffmpeg drops its sample and still exits 0. The fixture's chapters
 * are 100/600/600 s, so the chapter table ffprobe and Audiobookshelf show is rebuilt intact from
 * the Nero `chpl` list (the #524 guard passes it) while the chapter track keeps one sample of
 * three. Real import path: torrent download, organize with tagging on and merging off, real
 * Audiobookshelf scan. The fixture's own tags are not the book's, so the book's title and author
 * in the library file prove the tagged copy was placed. Values are read first, then checked with
 * expect.soft, so one run on main shows every difference. Exec bridge required.
 */

import { test, expect } from '@playwright/test';
import { Abs, authState, execBridgeAvailable, EXEC_BRIDGE_SKIP, fakeArr, stackExecSync, waitFor, writeEvidence, Rmab, type Book } from '../../lib/harness';
import { psql, setConfig, sqlStr } from './library-delete-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);

/** The fixture's chapters (manifest `martian-m4b-cover`): title, start, end in seconds. */
const CHAPTERS: Array<[string, number, number]> = [['One', 0, 100], ['第二章', 100, 700], ['Глава 3', 700, 1300]];
const SETTINGS = { chapter_merging_enabled: 'false', metadata_tagging_enabled: 'true' };

const getConfig = (key: string): string | null =>
  psql(`select count(*) from configuration where key = ${sqlStr(key)}`) === '0' ? null : psql(`select value from configuration where key = ${sqlStr(key)}`);

const ffprobeJson = (args: string[], file: string) => JSON.parse(stackExecSync('rmab', ['ffprobe', '-v', 'error', '-of', 'json', ...args, file]));

const near = (a: number, b: number) => Math.abs(a - b) <= 0.1;

test('#511: an M4B with a cover and long chapters keeps its chapter track when tagged', async () => {
  const saved = Object.keys(SETTINGS).map((key) => [key, getConfig(key)] as const);
  try {
    for (const [key, value] of Object.entries(SETTINGS)) setConfig(key, value);

    await fakeArr.scenario('chapters-cover');
    const book: Book = (await fakeArr.books()).martian;
    const rmab = await Rmab.loginAdmin();
    const requestId = (await rmab.requestBook(book)).request.id;
    const status = () => psql(`select status from requests where id = ${sqlStr(requestId)}`);
    await waitFor('request downloaded/available', async () => (['downloaded', 'available'].includes(status()) ? true : null), {
      timeoutMs: 300_000,
      intervalMs: 3_000,
    });

    const abs = await Abs.login();
    const libraryId = authState().absLibraryId;
    const titles = [book.title, 'Fixture Source Title'];
    const summary = await waitFor(
      'ABS library item',
      async () => {
        await abs.req('POST', `/api/libraries/${libraryId}/scan`).catch(() => undefined);
        return (await abs.libraryItems(libraryId)).find((i) => titles.includes(i.media?.metadata?.title)) || null;
      },
      { timeoutMs: 180_000, intervalMs: 5_000 }
    );
    const item = await abs.req('GET', `/api/items/${summary.id}?expanded=1`);
    const file: string = item.media.audioFiles[0].metadata.path;

    // Values first
    const table = (ffprobeJson(['-show_chapters'], file).chapters as any[]).map((c) => [c.tags?.title, Number(c.start_time), Number(c.end_time)]);
    const streams = ffprobeJson(['-show_entries', 'stream=codec_type,nb_frames,time_base:stream_disposition=attached_pic'], file).streams as any[];
    const chapterTrack = streams.filter((s) => s.codec_type === 'data').map((s) => ({ samples: Number(s.nb_frames), timeBase: s.time_base }));
    const tags = ffprobeJson(['-show_entries', 'format_tags'], file).format?.tags ?? {};
    const guardWarnings = psql(
      `select count(*) from job_events e join jobs j on j.id = e.job_id where j.request_id = ${sqlStr(requestId)} and e.message like 'Tagging changed the chapter table%'`
    );
    const requestMessage = psql(`select coalesce(error_message, '') from requests where id = ${sqlStr(requestId)}`);
    const absChapters = (item.media.chapters as any[]).map((c) => [c.title, Number(c.start), Number(c.end)]);
    const evidence = {
      requestId, status: status(), file, table, chapterTrack,
      attachedCover: streams.some((s) => s.codec_type === 'video' && s.disposition?.attached_pic === 1),
      tags: { title: tags.title, album_artist: tags.album_artist, media_type: tags.media_type, ASIN: tags.ASIN },
      guardWarnings, requestMessage, absChapters,
    };
    writeEvidence('511/result.json', evidence);

    const sameTable = (rows: Array<[string, number, number]>) =>
      rows.length === CHAPTERS.length && rows.every(([t, s, e], i) => t === CHAPTERS[i][0] && near(s, CHAPTERS[i][1]) && near(e, CHAPTERS[i][2]));
    expect.soft(chapterTrack, 'chapter track: one sample per chapter, 1/1000').toEqual([{ samples: CHAPTERS.length, timeBase: '1/1000' }]);
    expect.soft(sameTable(table as any), `ffprobe chapter table ${JSON.stringify(table)}`).toBe(true);
    expect.soft(sameTable(absChapters as any), `Audiobookshelf chapters ${JSON.stringify(absChapters)}`).toBe(true);
    expect.soft(evidence.attachedCover, 'cover kept').toBe(true);
    expect.soft(evidence.tags.title, 'the tagged copy was placed (book title, not the fixture\'s)').toBe(book.title);
    expect.soft(evidence.tags.album_artist).toBe(book.author);
    expect.soft(evidence.tags.media_type, 'stik: audiobook').toBe('2');
    expect.soft(evidence.tags.ASIN, 'ASIN freeform tag').toBe(book.asin);
    expect.soft(guardWarnings, 'no chapter guard warning').toBe('0');
    expect.soft(requestMessage, 'not imported without tags').not.toContain('without metadata tags');
  } finally {
    for (const [key, value] of saved) setConfig(key, value);
  }
});
