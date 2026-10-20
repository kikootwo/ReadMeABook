/**
 * Component: MP4 Freeform Tag Rewrite Planning Tests (pure, synthetic boxes)
 * Documentation: documentation/phase3/file-organization.md
 */

import { describe, expect, it } from 'vitest';
import {
  Mp4UnsupportedError,
  analyzeMoov,
  parseChildren,
  planFreeformRewrite,
  readFreeform,
  verifyRewrittenMoov,
  type RewritePlan,
} from '@/lib/utils/mp4-boxes';
import { box, freeform, full, layout, tableOffsets, textItem, u32, type TrackSpec } from '../helpers/mp4-builder';

const ASIN = [{ name: 'ASIN', value: 'B0TESTASIN' }];
const GB = 1024 ** 3;

/** Two tracks (audio 3 chunks, text 2 chunks) in the first mdat payload. */
const twoTracks = (p: number[]): TrackSpec[] => [
  { handler: 'soun', offsets: [p[0], p[0] + 100, p[0] + 200] },
  { handler: 'text', offsets: [p[0] + 300, p[0] + 400] },
];

const ilstOf = (moovBuf: Buffer) => analyzeMoov(moovBuf).items;
const freeformsOf = (moovBuf: Buffer) =>
  ilstOf(moovBuf).map((item) => readFreeform(moovBuf, item)).filter(Boolean);
const refused = (fn: () => unknown, message: RegExp) => {
  expect(fn).toThrow(Mp4UnsupportedError);
  expect(fn).toThrow(message);
};

describe('planFreeformRewrite', () => {
  it('adds the tag, keeps every other ilst item byte-for-byte, and updates the container sizes', () => {
    const items = [textItem('\xa9nam', 'Title'), textItem('\xa9ART', 'Author'), freeform('DISCSUBTITLE', 'Disc A')];
    const l = layout(['ftyp', 'moov', 'free', 'mdat'], [1000], twoTracks, { items });
    const plan = planFreeformRewrite(l.top, Buffer.from(l.moov), ASIN);

    expect(plan.newMoov.readUInt32BE(0)).toBe(plan.newMoov.length);
    const newItems = ilstOf(plan.newMoov).map((b) => plan.newMoov.subarray(b.start, b.start + b.size));
    expect(newItems.slice(0, 3)).toEqual(items);
    expect(freeformsOf(plan.newMoov)).toEqual([
      { mean: 'com.apple.iTunes', name: 'DISCSUBTITLE', value: 'Disc A' },
      { mean: 'com.apple.iTunes', name: 'ASIN', value: 'B0TESTASIN' },
    ]);
    // Every box on the path to ilst still parses to exactly its size
    expect(() => parseChildren(plan.newMoov, 0, plan.newMoov.length)).not.toThrow();
  });

  it('replaces an existing ASIN (any case) instead of adding a second one, and is idempotent', () => {
    const l = layout(['ftyp', 'moov', 'mdat'], [1000], twoTracks, { items: [freeform('asin', 'OLD'), freeform('iTunSMPB', 'x')] });
    const plan = planFreeformRewrite(l.top, Buffer.from(l.moov), ASIN);
    expect(freeformsOf(plan.newMoov).map((f) => f && `${f.name}=${f.value}`)).toEqual(['iTunSMPB=x', 'ASIN=B0TESTASIN']);

    const again = planFreeformRewrite([l.top[0], { ...l.top[1], size: plan.newMoov.length }, { ...l.top[2], start: l.top[0].size + plan.newMoov.length }], Buffer.from(plan.newMoov), ASIN);
    expect(again.newMoov.equals(plan.newMoov)).toBe(true);
  });

  it('moov last: moves moov to the front and shifts every chunk offset by the new moov size', () => {
    const l = layout(['ftyp', 'free', 'mdat', 'moov'], [1000], twoTracks);
    const plan = planFreeformRewrite(l.top, Buffer.from(l.moov), ASIN);
    const shift = plan.newMoov.length;

    expect(plan.segments.map((s) => [s.start, s.newStart])).toEqual([
      [24, 24 + shift],
      [32, 32 + shift],
    ]);
    expect(tableOffsets(plan.newMoov)).toEqual(tableOffsets(l.moov).map((t) => t.map((o) => o + shift)));
    expect(plan.outputSize).toBe(l.top.reduce((n, b) => n + b.size, 0) + shift - l.moov.length);
  });

  it('moov first: shifts the offsets by the growth of moov only', () => {
    const l = layout(['ftyp', 'moov', 'free', 'mdat'], [1000], twoTracks);
    const plan = planFreeformRewrite(l.top, Buffer.from(l.moov), ASIN);
    const delta = plan.newMoov.length - l.moov.length;
    expect(delta).toBeGreaterThan(0);
    expect(tableOffsets(plan.newMoov)).toEqual(tableOffsets(l.moov).map((t) => t.map((o) => o + delta)));
  });

  it.each([
    ['moov first', ['ftyp', 'moov', 'mdat64']],
    ['moov last', ['ftyp', 'mdat64', 'moov']],
  ])('64-bit mdat header, %s', (_name, order) => {
    const l = layout(order, [1000], twoTracks);
    const plan = planFreeformRewrite(l.top, Buffer.from(l.moov), ASIN);
    const mdatNew = plan.segments.find((s) => s.start === l.top.find((b) => b.type === 'mdat')!.start)!;
    const shift = mdatNew.newStart - mdatNew.start;
    expect(tableOffsets(plan.newMoov)).toEqual(tableOffsets(l.moov).map((t) => t.map((o) => o + shift)));
  });

  it('mdat moov mdat: each chunk moves with the mdat that holds it', () => {
    const l = layout(['ftyp', 'mdat', 'moov', 'mdat'], [500, 500], (p) => [
      { handler: 'soun', offsets: [p[0], p[0] + 100, p[1], p[1] + 100] },
    ]);
    const plan = planFreeformRewrite(l.top, Buffer.from(l.moov), ASIN);
    const first = plan.segments[0].newStart - plan.segments[0].start;
    const second = plan.segments[1].newStart - plan.segments[1].start;
    expect(first).toBe(plan.newMoov.length);
    expect(second).toBe(plan.newMoov.length - l.moov.length);
    const [p0, p1] = l.mdatPayloads;
    expect(tableOffsets(plan.newMoov)).toEqual([[p0 + first, p0 + 100 + first, p1 + second, p1 + 100 + second]]);
  });

  it('co64 offsets on both sides of 2^32 are shifted as 64-bit values', () => {
    const l = layout(['ftyp', 'mdat', 'moov'], [6 * GB], (p) => [
      { handler: 'soun', wide: true, offsets: [p[0], 2 ** 32 - 50, 2 ** 32 + 50, 5 * GB] },
    ]);
    const plan = planFreeformRewrite(l.top, Buffer.from(l.moov), ASIN);
    const shift = plan.newMoov.length;
    expect(tableOffsets(plan.newMoov)).toEqual([[l.mdatPayloads[0] + shift, 2 ** 32 - 50 + shift, 2 ** 32 + 50 + shift, 5 * GB + shift]]);
  });

  it('works with the QuickTime form of meta (no version/flags)', () => {
    const l = layout(['ftyp', 'moov', 'mdat'], [1000], twoTracks, { quickTimeMeta: true });
    const plan = planFreeformRewrite(l.top, Buffer.from(l.moov), ASIN);
    expect(freeformsOf(plan.newMoov)).toEqual([{ mean: 'com.apple.iTunes', name: 'ASIN', value: 'B0TESTASIN' }]);
  });
});

describe('planFreeformRewrite refuses layouts ffmpeg does not write', () => {
  const plan = (order: string[], sizes: number[], tracks: (p: number[]) => TrackSpec[], spec = {}) => {
    const l = layout(order, sizes, tracks, spec);
    return () => planFreeformRewrite(l.top, Buffer.from(l.moov), ASIN);
  };

  it('a top-level box outside ftyp/free/skip/wide/mdat/moov (e.g. moof)', () => {
    const l = layout(['ftyp', 'moov', 'mdat'], [1000], twoTracks);
    const top = [...l.top, { type: 'moof', start: l.top[2].start + l.top[2].size, size: 8, headerSize: 8 }];
    refused(() => planFreeformRewrite(top, Buffer.from(l.moov), ASIN), /unexpected top-level box 'moof'/);
  });

  it('missing udta, meta or ilst (they are never created)', () => {
    refused(plan(['ftyp', 'moov', 'mdat'], [1000], twoTracks, { noUdta: true }), /'udta'/);
    refused(plan(['ftyp', 'moov', 'mdat'], [1000], twoTracks, { noMeta: true }), /'meta'/);
    refused(plan(['ftyp', 'moov', 'mdat'], [1000], twoTracks, { noIlst: true }), /'ilst'/);
  });

  it('mdta (use_metadata_tags) tags', () => {
    refused(plan(['ftyp', 'moov', 'mdat'], [1000], twoTracks, { handler: 'mdta' }), /not mdir/);
  });

  it('a track with no chunk offset table, or two', () => {
    refused(plan(['ftyp', 'moov', 'mdat'], [1000], (p) => [{ offsets: [p[0]], tables: 0 }]), /exactly one stco\/co64/);
    refused(plan(['ftyp', 'moov', 'mdat'], [1000], (p) => [{ offsets: [p[0]], tables: 2 }]), /exactly one stco\/co64/);
  });

  it('track data in another file (dref not self-contained)', () => {
    refused(plan(['ftyp', 'moov', 'mdat'], [1000], (p) => [{ offsets: [p[0]], externalData: true }]), /self-contained/);
  });

  it('a chunk outside every mdat payload', () => {
    refused(plan(['ftyp', 'moov', 'mdat'], [1000], (p) => [{ offsets: [p[0] + 950] }]), /not inside an mdat/);
    refused(plan(['ftyp', 'moov', 'mdat'], [1000], () => [{ offsets: [30] }]), /not inside an mdat/);
  });

  it('a chunk offset table the parser does not walk (census)', () => {
    const hidden = box('xtra', full('stco', 0, u32(1, 99)));
    refused(plan(['ftyp', 'moov', 'mdat'], [1000], (p) => [{ offsets: [p[0]], extraStbl: hidden }]), /chunk offset table codes/);
    refused(plan(['ftyp', 'moov', 'mdat'], [1000], twoTracks, { moovExtra: [hidden] }), /chunk offset table codes/);
  });

  it('a 32-bit stco offset that would pass 4 GiB', () => {
    refused(plan(['ftyp', 'mdat', 'moov'], [2 ** 32], (p) => [{ offsets: [p[0], 2 ** 32 - 200] }]), /32-bit stco/);
  });

  it('invalid tag names and values (programming errors, not layout refusals)', () => {
    const l = layout(['ftyp', 'moov', 'mdat'], [1000], twoTracks);
    expect(() => planFreeformRewrite(l.top, Buffer.from(l.moov), [{ name: '', value: 'x' }])).toThrow(/Invalid freeform tag name/);
    expect(() => planFreeformRewrite(l.top, Buffer.from(l.moov), [{ name: 'ASIN', value: 'a\0b' }])).toThrow(/Invalid value/);
    expect(() => planFreeformRewrite(l.top, Buffer.from(l.moov), [...ASIN, { name: 'asin', value: 'x' }])).toThrow(/Duplicate/);
  });
});

describe('chunk tables', () => {
  it.each([
    ['fixed sample size (fast path, no per-sample table)', false],
    ['per-sample stsz table', true],
  ])('chunk sizes from stsc x stsz: %s', (_name, sampleTable) => {
    const l = layout(['ftyp', 'moov', 'mdat'], [5000], (p) => [
      { offsets: [p[0], p[0] + 400, p[0] + 800], chunkSize: 400, samplesPerChunk: 4, sampleTable },
    ]);
    expect([...analyzeMoov(l.moov).tracks[0].chunkSizes]).toEqual([400, 400, 400]);
  });

  it('a chunk running past its mdat is refused with either stsz form', () => {
    for (const sampleTable of [false, true]) {
      const l = layout(['ftyp', 'moov', 'mdat'], [1000], (p) => [{ offsets: [p[0] + 700], chunkSize: 400, samplesPerChunk: 4, sampleTable }]);
      refused(() => planFreeformRewrite(l.top, Buffer.from(l.moov), ASIN), /not inside an mdat/);
    }
  });

  it('the moov buffer passed in is the scratch copy: its offsets come back shifted', () => {
    const l = layout(['ftyp', 'free', 'mdat', 'moov'], [1000], twoTracks);
    const scratch = Buffer.from(l.moov);
    const plan = planFreeformRewrite(l.top, scratch, ASIN);
    expect(tableOffsets(scratch)).toEqual(tableOffsets(plan.newMoov));
    expect(tableOffsets(scratch)).not.toEqual(tableOffsets(l.moov));
  });
});

describe('verifyRewrittenMoov', () => {
  const setup = (): { plan: RewritePlan } => {
    const l = layout(['ftyp', 'free', 'mdat', 'moov'], [1000], twoTracks);
    return { plan: planFreeformRewrite(l.top, Buffer.from(l.moov), ASIN) };
  };

  it('accepts the planned moov', () => {
    const { plan } = setup();
    expect(() => verifyRewrittenMoov(plan, plan.newMoov, ASIN)).not.toThrow();
  });

  it('rejects a moov where one track table was not shifted (writer fault)', () => {
    const { plan } = setup();
    const tampered = Buffer.from(plan.newMoov);
    const at = tampered.indexOf('stco', tampered.indexOf('text', 0, 'latin1'), 'latin1'); // the text track's table
    tampered.writeUInt32BE(plan.oldTracks[1].offsets[0], at + 12);
    refused(() => verifyRewrittenMoov(plan, tampered, ASIN), /track 2 chunk offsets/);
  });

  it('rejects a moov whose chunk sizes changed (stsz)', () => {
    const { plan } = setup();
    const tampered = Buffer.from(plan.newMoov);
    const at = tampered.indexOf('stsz', 0, 'latin1'); // first track: fixed sample size
    tampered.writeUInt32BE(tampered.readUInt32BE(at + 8) + 1, at + 8);
    refused(() => verifyRewrittenMoov(plan, tampered, ASIN), /track 1 chunk offsets/);
  });

  it('rejects a moov without the tag, or with it twice', () => {
    const { plan } = setup();
    refused(() => verifyRewrittenMoov(plan, plan.newMoov, [{ name: 'PUBLISHER', value: 'x' }]), /PUBLISHER was not written/);
    refused(() => verifyRewrittenMoov(plan, plan.newMoov, [{ name: 'ASIN', value: 'OTHER' }]), /ASIN was not written/);
  });
});
