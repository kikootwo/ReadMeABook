/**
 * Component: MP4 Box Parsing and Freeform Tag Rewrite Planning (pure, no I/O)
 * Documentation: documentation/phase3/file-organization.md
 *
 * Plans the rewrite of an ffmpeg-written MP4/M4B as [ftyp][moov][every other
 * top-level box in order] (moov first, i.e. faststart) with iTunes freeform
 * items ('----', mean com.apple.iTunes) added to moov/udta/meta/ilst, and the
 * chunk offsets of every track moved with the box that holds their data.
 * Anything outside the layout ffmpeg itself emits is refused, never guessed.
 */

export const ITUNES_MEAN = 'com.apple.iTunes';

/** The file cannot be rewritten safely; it is left exactly as it is. */
export class Mp4UnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Mp4UnsupportedError';
  }
}

export interface FreeformTag {
  /** Item name, e.g. 'ASIN' (readers match it case-insensitively). */
  name: string;
  value: string;
}

/** A box: absolute offsets (top level) or offsets inside the buffer it was parsed from. */
export interface BoxRef {
  type: string;
  start: number;
  size: number;
  headerSize: number;
}

export interface TrackTables {
  handler: string;
  /** Offset of the first stco/co64 entry inside the moov buffer. */
  entriesStart: number;
  wide: boolean; // co64
  /** Typed arrays: 16 bytes per chunk, about what the moov's own tables hold. */
  offsets: Float64Array;
  chunkSizes: Float64Array;
}

interface MetaPath {
  udta: BoxRef;
  meta: BoxRef;
  metaSkip: number; // 4 for a full box (ISO), 0 for the QuickTime form
  ilst: BoxRef;
}

export interface MoovAnalysis extends MetaPath {
  /** The moov box and its children (offsets inside the moov buffer). */
  moov: BoxRef;
  kids: BoxRef[];
  tracks: TrackTables[];
  /** ilst items (offsets inside the moov buffer). */
  items: BoxRef[];
}

/** Payload range [start, end) of a top-level mdat and how far the rewrite moves it. */
export interface MdatShift {
  start: number;
  end: number;
  shift: number;
}

export interface CopySegment {
  /** Source range [start, end) of the input file. */
  start: number;
  end: number;
  /** Where it lands in the output. */
  newStart: number;
}

export interface RewritePlan {
  ftyp: BoxRef;
  newMoov: Buffer;
  segments: CopySegment[];
  outputSize: number;
  oldTracks: TrackTables[];
  /** Where each chunk lands: its input offset plus the shift of its mdat (see shiftedOffset). */
  mdatShifts: MdatShift[];
}

/** Output offset of the chunk at input `offset` (refused when no mdat payload holds it). */
export function shiftedOffset(shifts: MdatShift[], offset: number, length = 0): number {
  const owner = shifts.find((m) => offset >= m.start && offset + length <= m.end);
  return owner ? offset + owner.shift : fail(`chunk at ${offset} is not inside an mdat box`);
}

const TOP_LEVEL_ALLOWED = new Set(['ftyp', 'free', 'skip', 'wide', 'mdat', 'moov']);
const fail = (message: string): never => {
  throw new Mp4UnsupportedError(message);
};

/** The box whose header starts at `header[0]` (absolute offset `start`); it must end by `limit`. */
export function parseBoxHeader(header: Buffer, start: number, limit: number): BoxRef {
  if (header.length < 8 || start + 8 > limit) fail(`truncated box header at ${start}`);
  let size = header.readUInt32BE(0);
  const type = header.toString('latin1', 4, 8);
  let headerSize = 8;
  if (size === 1) {
    if (header.length < 16 || start + 16 > limit) fail(`truncated 64-bit box header at ${start}`);
    const big = header.readBigUInt64BE(8);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) fail(`box '${type}' at ${start} is too large`);
    size = Number(big);
    headerSize = 16;
  } else if (size === 0) {
    size = limit - start; // extends to the end of the enclosing range
  }
  if (size < headerSize || start + size > limit) fail(`box '${type}' at ${start} has an invalid size ${size}`);
  return { type, start, size, headerSize };
}

/** The boxes filling buf[start, end) exactly. */
export function parseChildren(buf: Buffer, start: number, end: number): BoxRef[] {
  const boxes: BoxRef[] = [];
  let pos = start;
  while (pos < end) {
    const box = parseBoxHeader(buf.subarray(pos, Math.min(pos + 16, end)), pos, end);
    boxes.push(box);
    pos += box.size;
  }
  return boxes;
}

function only(boxes: BoxRef[], type: string, where: string): BoxRef {
  const found = boxes.filter((b) => b.type === type);
  if (found.length !== 1) fail(`expected exactly one '${type}' in ${where}, found ${found.length}`);
  return found[0];
}

const childrenOf = (buf: Buffer, box: BoxRef, skip = 0) =>
  parseChildren(buf, box.start + box.headerSize + skip, box.start + box.size);

/** Payload start of a full box (after version/flags). */
const fullPayload = (box: BoxRef) => box.start + box.headerSize + 4;

function handlerType(buf: Buffer, hdlr: BoxRef): string {
  if (hdlr.size < hdlr.headerSize + 12) fail('truncated hdlr box');
  return buf.toString('latin1', fullPayload(hdlr) + 4, fullPayload(hdlr) + 8);
}

/** Checks the top-level layout is one ffmpeg writes: ftyp first, one moov, at least one mdat. */
export function validateTopLevel(top: BoxRef[]): { ftyp: BoxRef; moov: BoxRef; mdats: BoxRef[] } {
  for (const box of top) {
    if (!TOP_LEVEL_ALLOWED.has(box.type)) fail(`unexpected top-level box '${box.type}'`);
  }
  if (top[0]?.type !== 'ftyp') fail('file does not start with ftyp');
  only(top, 'ftyp', 'the file');
  const moov = only(top, 'moov', 'the file');
  const mdats = top.filter((b) => b.type === 'mdat');
  if (mdats.length === 0) fail('no mdat box');
  return { ftyp: top[0], moov, mdats };
}

function readTrack(buf: Buffer, trak: BoxRef): TrackTables {
  const mdia = only(childrenOf(buf, trak), 'mdia', 'trak');
  const mdiaKids = childrenOf(buf, mdia);
  const handler = handlerType(buf, only(mdiaKids, 'hdlr', 'mdia'));
  const minfKids = childrenOf(buf, only(mdiaKids, 'minf', 'mdia'));

  const dref = only(childrenOf(buf, only(minfKids, 'dinf', 'minf')), 'dref', 'dinf');
  const entries = childrenOf(buf, dref, 8); // version/flags + entry_count
  if (entries.length !== buf.readUInt32BE(fullPayload(dref))) fail('dref entry count mismatch');
  for (const entry of entries) {
    const flags = buf.readUInt32BE(entry.start + entry.headerSize) & 0xffffff;
    if ((entry.type !== 'url ' && entry.type !== 'urn ') || (flags & 1) !== 1) fail('track data is not self-contained');
  }

  const stblKids = childrenOf(buf, only(minfKids, 'stbl', 'minf'));
  const tables = stblKids.filter((b) => b.type === 'stco' || b.type === 'co64');
  if (tables.length !== 1) fail(`expected exactly one stco/co64 per track, found ${tables.length}`);
  const table = tables[0];
  const wide = table.type === 'co64';
  const count = buf.readUInt32BE(fullPayload(table));
  if (table.size !== table.headerSize + 8 + count * (wide ? 8 : 4)) fail(`${table.type} size does not match its entry count`);
  const offsets = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const at = fullPayload(table) + 4 + i * (wide ? 8 : 4);
    offsets[i] = wide ? Number(buf.readBigUInt64BE(at)) : buf.readUInt32BE(at);
  }
  if (stblKids.some((b) => b.type === 'stz2')) fail('stz2 sample sizes are not supported');
  const chunkSizes = readChunkSizes(buf, only(stblKids, 'stsc', 'stbl'), only(stblKids, 'stsz', 'stbl'), count);
  return { handler, entriesStart: fullPayload(table) + 4, wide, offsets, chunkSizes };
}

/** Byte size of each chunk, from stsc (samples per chunk) and stsz (sample sizes). */
function readChunkSizes(buf: Buffer, stsc: BoxRef, stsz: BoxRef, chunkCount: number): Float64Array {
  const runs = buf.readUInt32BE(fullPayload(stsc));
  if (stsc.size !== stsc.headerSize + 8 + runs * 12) fail('stsc size does not match its entry count');
  const fixedSize = buf.readUInt32BE(fullPayload(stsz));
  const sampleCount = buf.readUInt32BE(fullPayload(stsz) + 4);
  const sizesAt = fullPayload(stsz) + 8;
  if (fixedSize === 0 && stsz.size !== stsz.headerSize + 12 + sampleCount * 4) fail('stsz size does not match its sample count');

  const sizes = new Float64Array(chunkCount);
  let filled = 0;
  let sample = 0;
  for (let r = 0; r < runs; r++) {
    const at = fullPayload(stsc) + 4 + r * 12;
    const first = buf.readUInt32BE(at);
    const perChunk = buf.readUInt32BE(at + 4);
    const next = r + 1 < runs ? buf.readUInt32BE(at + 12) : chunkCount + 1;
    if (first !== filled + 1 || next <= first) fail('invalid stsc run');
    for (let chunk = first; chunk < next && chunk <= chunkCount; chunk++) {
      if (sample + perChunk > sampleCount) fail('stsc references more samples than stsz holds');
      let bytes = perChunk * fixedSize; // fixed sample size: no per-sample table
      if (fixedSize === 0) for (let s = 0; s < perChunk; s++) bytes += buf.readUInt32BE(sizesAt + (sample + s) * 4);
      sizes[filled++] = bytes;
      sample += perChunk;
    }
  }
  if (filled !== chunkCount) fail('stsc does not cover every chunk');
  return sizes;
}

/** Number of 'stco'/'co64' four-character codes in buf[start, end). */
function countTableCodes(buf: Buffer, start: number, end: number): number {
  let count = 0;
  for (const code of ['stco', 'co64']) {
    let at = buf.indexOf(code, start, 'latin1');
    while (at !== -1 && at + 4 <= end) {
      count++;
      at = buf.indexOf(code, at + 1, 'latin1');
    }
  }
  return count;
}

function findMeta(buf: Buffer, moovKids: BoxRef[]): MetaPath {
  const udta = only(moovKids, 'udta', 'moov');
  const meta = only(childrenOf(buf, udta), 'meta', 'udta');
  const body = meta.start + meta.headerSize;
  const metaSkip = buf.toString('latin1', body + 4, body + 8) === 'hdlr' ? 0 : 4;
  const metaKids = childrenOf(buf, meta, metaSkip);
  if (handlerType(buf, only(metaKids, 'hdlr', 'meta')) !== 'mdir') fail('meta handler is not mdir (iTunes tags)');
  return { udta, meta, metaSkip, ilst: only(metaKids, 'ilst', 'meta') };
}

/** Tracks and tags of a moov box (buf holds exactly the moov box). */
export function analyzeMoov(buf: Buffer): MoovAnalysis {
  const moov = parseBoxHeader(buf.subarray(0, 16), 0, buf.length);
  if (moov.type !== 'moov' || moov.size !== buf.length) fail('not a moov box');
  const kids = childrenOf(buf, moov);
  if (kids.some((b) => b.type === 'mvex')) fail('fragmented MP4 is not supported');
  const tracks = kids.filter((b) => b.type === 'trak').map((trak) => readTrack(buf, trak));
  if (tracks.length === 0) fail('no tracks');
  const metaPath = findMeta(buf, kids);
  const { udta, ilst } = metaPath;

  // Census: a chunk offset table the parser did not reach (e.g. inside a box it
  // does not walk) would leave stale offsets, so every table code outside the
  // tag box must be one we read. A false match only refuses the file.
  const census = countTableCodes(buf, 0, udta.start) + countTableCodes(buf, udta.start + udta.size, buf.length);
  if (census !== tracks.length) fail(`found ${census} chunk offset table codes for ${tracks.length} tables`);

  return { ...metaPath, moov, kids, tracks, items: childrenOf(buf, ilst) };
}

/** mean/name/value of a '----' item, or null for any other item. */
export function readFreeform(buf: Buffer, item: BoxRef): { mean: string; name: string; value: string } | null {
  if (item.type !== '----') return null;
  const parts = childrenOf(buf, item);
  const text = (type: string, skip: number) => {
    const box = only(parts, type, "'----' item");
    return buf.toString('utf8', box.start + box.headerSize + skip, box.start + box.size);
  };
  return { mean: text('mean', 4), name: text('name', 4), value: text('data', 8) };
}

function box(type: string, ...payload: Buffer[]): Buffer {
  const body = Buffer.concat(payload);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + body.length, 0);
  header.write(type, 4, 'latin1');
  return Buffer.concat([header, body]);
}

/** A '----' item: mean com.apple.iTunes, name, UTF-8 data (type 1, locale 0). */
export function freeformItem(tag: FreeformTag): Buffer {
  const dataHeader = Buffer.alloc(8);
  dataHeader.writeUInt32BE(1, 0);
  return box(
    '----',
    box('mean', Buffer.alloc(4), Buffer.from(ITUNES_MEAN, 'latin1')),
    box('name', Buffer.alloc(4), Buffer.from(tag.name, 'latin1')),
    box('data', dataHeader, Buffer.from(tag.value, 'utf8'))
  );
}

export function validateTags(tags: FreeformTag[]): void {
  const seen = new Set<string>();
  for (const tag of tags) {
    if (!/^[\x20-\x7e]{1,255}$/.test(tag.name)) throw new Error(`Invalid freeform tag name: ${JSON.stringify(tag.name)}`);
    if (!tag.value || tag.value.includes('\x00')) throw new Error(`Invalid value for freeform tag ${tag.name}`);
    if (seen.has(tag.name.toLowerCase())) throw new Error(`Duplicate freeform tag ${tag.name}`);
    seen.add(tag.name.toLowerCase());
  }
}

/** `buf[box]` with its children replaced by `body` (size rewritten, header form kept). */
function rebox(buf: Buffer, b: BoxRef, prefix: Buffer, body: Buffer[]): Buffer {
  const header = Buffer.from(buf.subarray(b.start, b.start + b.headerSize));
  const total = header.length + prefix.length + body.reduce((n, part) => n + part.length, 0);
  if (b.headerSize === 16) header.writeBigUInt64BE(BigInt(total), 8);
  else if (total > 0xffffffff) fail(`'${b.type}' would exceed 4 GiB`);
  else header.writeUInt32BE(total, 0);
  return Buffer.concat([header, prefix, ...body]);
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Plan the rewrite. `top` is the input's top-level boxes (absolute offsets,
 * covering the file), `moovBuf` the moov box bytes. To keep peak memory near
 * 2x the moov, `moovBuf` is the scratch copy: its chunk offsets are shifted in
 * place and the new moov is assembled from it in one allocation.
 */
export function planFreeformRewrite(top: BoxRef[], moovBuf: Buffer, tags: FreeformTag[]): RewritePlan {
  validateTags(tags);
  const { ftyp, moov } = validateTopLevel(top);
  if (moovBuf.length !== moov.size) fail('moov buffer does not match the moov box');
  const analysis = analyzeMoov(moovBuf);
  const { udta, meta, metaSkip, ilst } = analysis;

  // New ilst: unrelated items unchanged, same-named freeform items replaced.
  const kept = analysis.items.filter((item) => {
    const ff = readFreeform(moovBuf, item);
    return !(ff && ff.mean === ITUNES_MEAN && tags.some((t) => sameName(t.name, ff.name)));
  });
  const slice = (b: BoxRef) => moovBuf.subarray(b.start, b.start + b.size);
  const newIlst = rebox(moovBuf, ilst, Buffer.alloc(0), [...kept.map(slice), ...tags.map(freeformItem)]);
  const metaPrefix = moovBuf.subarray(meta.start + meta.headerSize, meta.start + meta.headerSize + metaSkip);
  const newMeta = rebox(moovBuf, meta, metaPrefix, childrenOf(moovBuf, meta, metaSkip).map((b) => (b.start === ilst.start ? newIlst : slice(b))));
  const newUdta = rebox(moovBuf, udta, Buffer.alloc(0), childrenOf(moovBuf, udta).map((b) => (b.start === meta.start ? newMeta : slice(b))));

  // Output order: ftyp, moov, then every other top-level box in input order.
  const segments: CopySegment[] = [];
  const mdatShifts: MdatShift[] = [];
  let cursor = ftyp.size + moov.size - udta.size + newUdta.length;
  for (const b of top) {
    if (b === ftyp || b === moov) continue;
    segments.push({ start: b.start, end: b.start + b.size, newStart: cursor });
    if (b.type === 'mdat') mdatShifts.push({ start: b.start + b.headerSize, end: b.start + b.size, shift: cursor - b.start });
    cursor += b.size;
  }

  // Every chunk lies wholly inside one mdat payload and moves with it. The
  // tables sit outside udta, so the new udta (already copied) is unaffected.
  for (const t of analysis.tracks) {
    t.offsets.forEach((offset, i) => {
      const next = shiftedOffset(mdatShifts, offset, t.chunkSizes[i]);
      const at = t.entriesStart + i * (t.wide ? 8 : 4);
      if (t.wide) moovBuf.writeBigUInt64BE(BigInt(next), at);
      else if (next > 0xffffffff) fail('a chunk offset would exceed the 32-bit stco range');
      else moovBuf.writeUInt32BE(next, at);
    });
  }
  const newMoov = rebox(moovBuf, analysis.moov, Buffer.alloc(0), analysis.kids.map((b) => (b.start === udta.start ? newUdta : slice(b))));

  return { ftyp, newMoov, segments, outputSize: cursor, oldTracks: analysis.tracks, mdatShifts };
}

/**
 * Check a rewritten moov against the plan: same tracks, every chunk offset
 * where the plan says (computed from the input, not from this moov), same
 * chunk sizes, and each tag present exactly once with its value.
 */
export function verifyRewrittenMoov(plan: RewritePlan, moovBuf: Buffer, tags: FreeformTag[]): void {
  const analysis = analyzeMoov(moovBuf);
  if (analysis.tracks.length !== plan.oldTracks.length) fail('track count changed');
  analysis.tracks.forEach((t, ti) => {
    const old = plan.oldTracks[ti];
    const same =
      t.offsets.length === old.offsets.length &&
      old.offsets.every((o, i) => t.offsets[i] === shiftedOffset(plan.mdatShifts, o) && t.chunkSizes[i] === old.chunkSizes[i]);
    if (!same) fail(`track ${ti + 1} chunk offsets do not match the plan`);
  });
  for (const tag of tags) {
    const matches = analysis.items
      .map((item) => readFreeform(moovBuf, item))
      .filter((ff) => ff && ff.mean === ITUNES_MEAN && sameName(ff.name, tag.name));
    if (matches.length !== 1 || matches[0]?.value !== tag.value) fail(`tag ${tag.name} was not written exactly once`);
  }
}
