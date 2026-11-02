/**
 * Component: MP4 Freeform Tags Integration Tests (real ffmpeg/ffprobe)
 * Documentation: documentation/phase3/file-organization.md
 *
 * Both layouts ffmpeg writes for RMAB (moov last: the tagger; moov first: the
 * merger's faststart), with a cover and text-track chapters (no Nero chpl, so
 * a wrong text-track offset shows as wrong chapter titles). Skips without
 * ffmpeg/ffprobe on PATH.
 */

import * as fs from 'fs';
import * as path from 'path';
import fsp from 'fs/promises';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PARTIAL_FILE_PATTERN } from '@/lib/utils/copy-file';
import { shiftedOffset, type RewritePlan } from '@/lib/utils/mp4-boxes';
import { addFreeformTags, testHooks, writeFreeformTaggedCopy } from '@/lib/utils/mp4-freeform-tags';
import { TAGS, audioMd5, available, countFreeform, ffmpeg, makeDir, makeM4b, probe, topLevelTypes } from './mp4-tags.helpers';

const ASIN = [{ name: 'ASIN', value: 'B0TESTASIN' }];
let dir: string;

beforeAll(() => {
  if (available) dir = makeDir('rmab-freeform-it-');
});
afterAll(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});
afterEach(() => {
  testHooks.afterPlan = undefined;
  testHooks.afterWrite = undefined;
});

const leftovers = () => fs.readdirSync(dir).filter((f) => PARTIAL_FILE_PATTERN.test(f));

/** Flip one byte of the written copy (before its after-write check) at the position `at(plan)` picks. */
function corruptWrittenCopy(at: (plan: RewritePlan) => number) {
  let plan: RewritePlan | undefined;
  testHooks.afterPlan = (p) => {
    plan = p;
  };
  testHooks.afterWrite = (outputPath) => {
    const fd = fs.openSync(outputPath, 'r+');
    try {
      const byte = Buffer.alloc(1);
      const position = at(plan!);
      fs.readSync(fd, byte, 0, 1, position);
      byte[0] ^= 0xff;
      fs.writeSync(fd, byte, 0, 1, position);
    } finally {
      fs.closeSync(fd);
    }
  };
}

describe.skipIf(!available)('addFreeformTags on ffmpeg output (real ffmpeg)', () => {
  it.each([
    ['moov last (tagger output)', false],
    ['moov first (merger faststart output)', true],
  ])('%s: ASIN readable, moov first, tags/cover/chapters/audio unchanged', async (_name, faststart) => {
    const file = await makeM4b(dir, `layout-${faststart}.m4b`, { faststart });
    const before = await probe(file);
    const md5 = await audioMd5(file);
    expect(before.tags.ASIN).toBeUndefined();

    const result = await addFreeformTags(file, ASIN);
    expect(result).toEqual({ written: true });

    const after = await probe(file);
    expect(after.tags.ASIN).toBe('B0TESTASIN');
    for (const [key, value] of Object.entries(TAGS)) expect(after.tags[key]).toBe(value);
    expect(after.streams).toEqual(before.streams);
    expect(after.streams.some((s) => s.disposition?.attached_pic === 1)).toBe(true);
    expect(after.chapters).toEqual(before.chapters);
    expect(after.chapters.map((c) => c.tags?.title)).toEqual(['Chapter One', 'Chapter Two']);
    expect(await audioMd5(file)).toBe(md5);
    expect(topLevelTypes(file).slice(0, 2)).toEqual(['ftyp', 'moov']);
    expect(leftovers()).toEqual([]);
  }, 60_000);

  it('running twice leaves exactly one ASIN item (counted in the file) with the new value', async () => {
    const file = await makeM4b(dir, 'twice.m4b', { faststart: false });
    await addFreeformTags(file, [{ name: 'ASIN', value: 'B0FIRST000' }]);
    expect((await addFreeformTags(file, ASIN)).written).toBe(true);
    expect(countFreeform(file, 'ASIN')).toBe(1);
    expect((await probe(file)).tags.ASIN).toBe('B0TESTASIN');
  }, 60_000);

  it("keeps an unrelated '----' item ffmpeg wrote itself (9.0.2's DISCSUBTITLE)", async (ctx) => {
    const file = await makeM4b(dir, 'disc.m4b', { faststart: false, extra: ['-metadata', 'disc_subtitle=Disc A'] });
    if (countFreeform(file, 'DISCSUBTITLE') !== 1) ctx.skip(); // ffmpeg older than 9.0 writes no freeform item
    await addFreeformTags(file, ASIN);
    expect(countFreeform(file, 'DISCSUBTITLE')).toBe(1);
    const tags = (await probe(file)).tags;
    expect(tags.ASIN).toBe('B0TESTASIN');
    // 9.0.2's demuxer maps it back to its own key, disc_subtitle
    expect(Object.entries(tags).find(([k]) => /^disc_?subtitle$/i.test(k))?.[1]).toBe('Disc A');
  }, 60_000);

  it('a writer fault (one track table left unshifted) is rejected and the file is untouched', async () => {
    const file = await makeM4b(dir, 'fault.m4b', { faststart: false });
    const original = fs.readFileSync(file);
    testHooks.afterPlan = (plan) => {
      // Undo the text track's shift in the moov about to be written
      const at = plan.newMoov.indexOf('stco', plan.newMoov.indexOf('text', 0, 'latin1'), 'latin1');
      plan.newMoov.writeUInt32BE(plan.oldTracks[1].offsets[0], at + 12);
    };
    const result = await addFreeformTags(file, ASIN);
    expect(result.written).toBe(false);
    expect(result.warning).toMatch(/ASIN tag not written \(track 2 chunk offsets/);
    expect(fs.readFileSync(file).equals(original)).toBe(true);
    expect(leftovers()).toEqual([]);
  }, 60_000);

  it.each([
    [
      'a byte at the first audio chunk',
      /ASIN tag not written \(track \d+ chunk 1 moved to the wrong place\)/,
      (plan: RewritePlan) => shiftedOffset(plan.mdatShifts, plan.oldTracks.find((t) => t.handler === 'soun')!.offsets[0]),
    ],
    [
      'a byte inside the written moov',
      /ASIN tag not written \(written moov differs from the plan\)/,
      (plan: RewritePlan) => plan.ftyp.size + Math.floor(plan.newMoov.length / 2),
    ],
  ])('the after-write check catches %s changed on disk; the input is untouched', async (name, warning, at) => {
    const file = await makeM4b(dir, `after-write-${name.endsWith('moov') ? 'moov' : 'chunk'}.m4b`, { faststart: false });
    const original = fs.readFileSync(file);
    corruptWrittenCopy(at);
    const result = await addFreeformTags(file, ASIN);
    expect(result.written).toBe(false);
    expect(result.warning).toMatch(warning);
    expect(fs.readFileSync(file).equals(original)).toBe(true);
    expect(leftovers()).toEqual([]);
  }, 60_000);

  it('a failure mid-copy (input ends early) removes the partial copy; the input is untouched', async () => {
    const file = await makeM4b(dir, 'midcopy.m4b', { faststart: false });
    const original = fs.readFileSync(file);
    testHooks.afterPlan = (plan) => {
      // The last segment now runs past the end of the input: copyRange hits EOF after writing ftyp, moov and the rest
      const last = plan.segments[plan.segments.length - 1];
      plan.segments[plan.segments.length - 1] = { ...last, end: last.end + 4096 };
    };
    const result = await addFreeformTags(file, ASIN);
    expect(result.written).toBe(false);
    expect(result.warning).toMatch(/ASIN tag not written \(input ended while copying\)/);
    expect(fs.readFileSync(file).equals(original)).toBe(true);
    expect(leftovers()).toEqual([]);
  }, 60_000);

  it('a failed rename removes the verified copy and keeps ffmpeg output as it was', async () => {
    const file = await makeM4b(dir, 'rename.m4b', { faststart: true });
    const original = fs.readFileSync(file);
    const rename = vi.spyOn(fsp, 'rename').mockRejectedValueOnce(Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' }));
    try {
      const result = await addFreeformTags(file, ASIN);
      expect(result).toEqual({ written: false, warning: 'ASIN tag not written (EBUSY: resource busy)' });
    } finally {
      rename.mockRestore();
    }
    expect(fs.readFileSync(file).equals(original)).toBe(true);
    expect(leftovers()).toEqual([]);
  }, 60_000);

  it('a crash leftover for the same file is swept before the next run; another file is kept', async () => {
    const file = await makeM4b(dir, 'sweep.m4b', { faststart: true });
    const { partialNameFor } = await import('@/lib/utils/copy-file');
    const mine = path.join(dir, partialNameFor('sweep.m4b'));
    const other = path.join(dir, partialNameFor('other.m4b'));
    fs.writeFileSync(mine, 'stale');
    fs.writeFileSync(other, 'in progress');
    expect((await addFreeformTags(file, ASIN)).written).toBe(true);
    expect(fs.existsSync(mine)).toBe(false);
    expect(fs.readFileSync(other, 'utf8')).toBe('in progress');
    fs.unlinkSync(other);
  }, 60_000);

  it('refuses mdta (use_metadata_tags) files and leaves them untouched', async () => {
    const src = await makeM4b(dir, 'for-mdta.m4b', { faststart: false });
    const file = path.join(dir, 'mdta.m4b');
    await ffmpeg(['-y', '-i', src, '-c', 'copy', '-movflags', 'use_metadata_tags', '-f', 'mp4', file]);
    const original = fs.readFileSync(file);
    const result = await addFreeformTags(file, ASIN);
    expect(result.written).toBe(false);
    expect(result.warning).toMatch(/not mdir/);
    expect(fs.readFileSync(file).equals(original)).toBe(true);
  }, 60_000);

  it('closes every handle: the tagged file can be renamed and deleted at once (Windows)', async () => {
    const file = await makeM4b(dir, 'handles.m4b', { faststart: true });
    expect((await addFreeformTags(file, ASIN)).written).toBe(true);
    const moved = `${file}.moved`;
    fs.renameSync(file, moved);
    fs.unlinkSync(moved);
    expect(fs.existsSync(moved)).toBe(false);
  }, 60_000);

  it('no tags: nothing is written', async () => {
    const file = await makeM4b(dir, 'none.m4b', { faststart: false });
    const original = fs.readFileSync(file);
    expect(await addFreeformTags(file, [])).toEqual({ written: false });
    expect(fs.readFileSync(file).equals(original)).toBe(true);
  }, 60_000);

  it('writeFreeformTaggedCopy never writes over its input or an existing file', async () => {
    const file = await makeM4b(dir, 'guard.m4b', { faststart: false });
    const original = fs.readFileSync(file);
    await expect(writeFreeformTaggedCopy(file, path.join(dir, '.', 'guard.m4b'), ASIN)).rejects.toThrow(/must differ/);
    const existing = path.join(dir, 'existing.m4b');
    fs.writeFileSync(existing, 'keep');
    await expect(writeFreeformTaggedCopy(file, existing, ASIN)).rejects.toThrow(/EEXIST/);
    expect(fs.readFileSync(existing, 'utf8')).toBe('keep');
    expect(fs.readFileSync(file).equals(original)).toBe(true);
  }, 60_000);
});
