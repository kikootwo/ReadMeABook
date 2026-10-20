/**
 * Component: Synthetic MP4 box builder (tests for the freeform tag rewrite)
 * Documentation: documentation/phase3/file-organization.md
 *
 * Builds just enough of an ffmpeg-shaped moov (trak/mdia/hdlr/minf/dinf/stbl,
 * udta/meta/ilst) to exercise the pure planner; mdat payloads are never read
 * by it, so a layout can describe multi-GB files without any bytes.
 */

import type { BoxRef } from '@/lib/utils/mp4-boxes';

export function box(type: string, ...payload: Buffer[]): Buffer {
  const body = Buffer.concat(payload);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + body.length, 0);
  header.write(type, 4, 'latin1');
  return Buffer.concat([header, body]);
}

export const full = (type: string, flags: number, ...payload: Buffer[]) => box(type, u32(flags), ...payload);

export function u32(...values: number[]): Buffer {
  const b = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => b.writeUInt32BE(v, i * 4));
  return b;
}

function u64(...values: number[]): Buffer {
  const b = Buffer.alloc(values.length * 8);
  values.forEach((v, i) => b.writeBigUInt64BE(BigInt(v), i * 8));
  return b;
}

export interface TrackSpec {
  handler?: string;
  offsets: number[];
  /** Bytes per chunk. */
  chunkSize?: number;
  /** Samples per chunk (default 1), each chunkSize / samplesPerChunk bytes. */
  samplesPerChunk?: number;
  /** Write a per-sample stsz table instead of one fixed sample size. */
  sampleTable?: boolean;
  wide?: boolean;
  externalData?: boolean;
  /** Number of stco boxes in stbl (default 1). */
  tables?: number;
  /** Extra box inside stbl (e.g. one hiding a table the parser does not walk). */
  extraStbl?: Buffer;
}

export function trak(spec: TrackSpec): Buffer {
  const n = spec.offsets.length;
  const size = spec.chunkSize ?? 100;
  const per = spec.samplesPerChunk ?? 1;
  const sampleSize = size / per;
  const stsz = spec.sampleTable
    ? full('stsz', 0, u32(0, n * per, ...Array.from({ length: n * per }, () => sampleSize)))
    : full('stsz', 0, u32(sampleSize, n * per));
  const table = spec.wide ? full('co64', 0, u32(n), u64(...spec.offsets)) : full('stco', 0, u32(n), u32(...spec.offsets));
  const tables = Array.from({ length: spec.tables ?? 1 }, () => table);
  const stbl = box(
    'stbl',
    full('stsd', 0, u32(0)),
    full('stts', 0, u32(0)),
    full('stsc', 0, u32(1), u32(1, per, 1)),
    stsz,
    ...tables,
    ...(spec.extraStbl ? [spec.extraStbl] : [])
  );
  const dref = full('dref', 0, u32(1), full('url ', spec.externalData ? 0 : 1));
  const hdlr = full('hdlr', 0, u32(0), Buffer.from(spec.handler ?? 'soun', 'latin1'), u32(0, 0, 0), Buffer.from('h\0'));
  return box('trak', box('mdia', full('mdhd', 0, Buffer.alloc(20)), hdlr, box('minf', box('dinf', dref), stbl)));
}

export const textItem = (type: string, text: string) => box(type, box('data', u32(1, 0), Buffer.from(text, 'utf8')));

export const freeform = (name: string, value: string, mean = 'com.apple.iTunes') =>
  box('----', full('mean', 0, Buffer.from(mean)), full('name', 0, Buffer.from(name)), box('data', u32(1, 0), Buffer.from(value, 'utf8')));

export interface MoovSpec {
  tracks: TrackSpec[];
  items?: Buffer[];
  handler?: string; // meta hdlr (default mdir)
  noUdta?: boolean;
  noMeta?: boolean;
  noIlst?: boolean;
  quickTimeMeta?: boolean; // meta without version/flags
  moovExtra?: Buffer[];
}

export function moov(spec: MoovSpec): Buffer {
  const items = spec.items ?? [textItem('\xa9nam', 'Title')];
  const hdlr = full('hdlr', 0, u32(0), Buffer.from(spec.handler ?? 'mdir', 'latin1'), Buffer.from('appl'), u32(0, 0), Buffer.from([0]));
  const metaKids = [hdlr, ...(spec.noIlst ? [] : [box('ilst', ...items)])];
  const meta = spec.quickTimeMeta ? box('meta', ...metaKids) : full('meta', 0, ...metaKids);
  const udta = box('udta', ...(spec.noMeta ? [] : [meta]));
  return box(
    'moov',
    full('mvhd', 0, Buffer.alloc(96)),
    ...spec.tracks.map(trak),
    ...(spec.moovExtra ?? []),
    ...(spec.noUdta ? [] : [udta])
  );
}

export interface Layout {
  top: BoxRef[];
  moov: Buffer;
  /** Payload start of each mdat in `order`. */
  mdatPayloads: number[];
}

/**
 * Top-level boxes in `order` ('mdat' sizes from `mdatSizes`, 'mdat64' = 64-bit header);
 * `tracks(payloads)` returns the track specs once mdat payload offsets are known.
 */
export function layout(
  order: string[],
  mdatSizes: number[],
  tracks: (payloads: number[]) => TrackSpec[],
  spec: Omit<MoovSpec, 'tracks'> = {}
): Layout {
  const build = (payloads: number[]) => moov({ ...spec, tracks: tracks(payloads) });
  const placeholder = build(mdatSizes.map(() => 0));
  const top: BoxRef[] = [];
  const payloads: number[] = [];
  let pos = 0;
  let m = 0;
  for (const type of order) {
    let b: BoxRef;
    if (type === 'ftyp') b = { type, start: pos, size: 24, headerSize: 8 };
    else if (type === 'free') b = { type, start: pos, size: 8, headerSize: 8 };
    else if (type === 'moov') b = { type, start: pos, size: placeholder.length, headerSize: 8 };
    else {
      const headerSize = type === 'mdat64' ? 16 : 8;
      b = { type: 'mdat', start: pos, size: mdatSizes[m++] + headerSize, headerSize };
      payloads.push(pos + headerSize);
    }
    top.push(b);
    pos += b.size;
  }
  const real = build(payloads);
  if (real.length !== placeholder.length) throw new Error('moov size depends on offsets');
  return { top, moov: real, mdatPayloads: payloads };
}

/** Chunk offsets of every stco/co64 in a moov, in order (independent of the module's parser). */
export function tableOffsets(moovBuf: Buffer): number[][] {
  const result: number[][] = [];
  for (const code of ['stco', 'co64']) {
    let at = moovBuf.indexOf(code, 0, 'latin1');
    while (at !== -1) {
      const count = moovBuf.readUInt32BE(at + 8);
      const wide = code === 'co64';
      const offsets: number[] = [];
      for (let i = 0; i < count; i++) {
        offsets.push(wide ? Number(moovBuf.readBigUInt64BE(at + 12 + i * 8)) : moovBuf.readUInt32BE(at + 12 + i * 4));
      }
      result.push(offsets);
      at = moovBuf.indexOf(code, at + 1, 'latin1');
    }
  }
  return result;
}
