/**
 * Component: Ebook Placement Record Tests (#497)
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * Reading, building and merging Request.placedEbookFiles, and the record write
 * (only a 'copied' placement adds an entry; it never throws).
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

const { mergePlacements, placementEntry, readPlacements, recordEbookPlacement, otherRecordedEntries, UNRECORDED_EARLIER_IMPORT } = await import('@/lib/utils/ebook-placement');

const sha = (data: string) => createHash('sha256').update(data).digest('hex');
const logger = { info: vi.fn(), warn: vi.fn() } as unknown as Parameters<typeof recordEbookPlacement>[2];

let root: string;

beforeEach(() => {
  vi.clearAllMocks();
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-497-entry-')));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** An absolute library folder for record values (nothing is read from it). */
const LIB = path.resolve('/library/Author/Book');

describe('readPlacements', () => {
  const good = () => ({ path: path.join(LIB, 'Book.epub'), size: 5, sha256: 'f'.repeat(64), placedAt: '2026-10-01T00:00:00.000Z' });

  it('null and undefined are "no record" (SQL NULL and JSON null read the same)', () => {
    expect(readPlacements(null)).toBeNull();
    expect(readPlacements(undefined)).toBeNull();
  });

  it('[] is a record with no entries', () => {
    expect(readPlacements([])).toEqual({ entries: [], unreadable: 0, unrecordedEarlier: false });
  });

  it('keeps well-formed entries and counts the rest', () => {
    const ok = good();
    expect(readPlacements([ok, { ...ok, path: 'relative/Book.epub' }, 'x', null])).toEqual({ entries: [ok], unreadable: 3, unrecordedEarlier: false });
  });

  it.each([
    ['a relative path', { path: 'Book.epub' }],
    ['a NUL in the path', { path: `${path.join(LIB, 'Book')}\0.epub` }],
    ['a non-ebook file', { path: path.join(LIB, 'Book.m4b') }],
    ['an upper-case sha256', { sha256: 'F'.repeat(64) }],
    ['a 63-char sha256', { sha256: 'f'.repeat(63) }],
    ['a fractional size', { size: 1.5 }],
    ['a string size', { size: '5' }],
    ['a negative size', { size: -1 }],
    ['an unsafe size', { size: 2 ** 53 }],
  ])('rejects %s', (_label, change) => {
    expect(readPlacements([{ ...good(), ...change }])).toEqual({ entries: [], unreadable: 1, unrecordedEarlier: false });
  });

  it('accepts every organizer ebook format, any case', () => {
    for (const name of ['B.epub', 'B.PDF', 'B.azw3', 'B.mobi']) {
      expect(readPlacements([{ ...good(), path: path.join(LIB, name) }])?.entries).toHaveLength(1);
    }
  });

  it('the earlier-import marker is neither an entry nor unreadable', () => {
    const ok = good();
    expect(readPlacements([{ ...UNRECORDED_EARLIER_IMPORT }, ok])).toEqual({ entries: [ok], unreadable: 0, unrecordedEarlier: true });
    expect(readPlacements([{ ...UNRECORDED_EARLIER_IMPORT, path: ok.path }])?.entries).toEqual([]);
  });

  it('a non-array value is one unreadable item', () => {
    expect(readPlacements({ path: '/x.epub' })).toEqual({ entries: [], unreadable: 1, unrecordedEarlier: false });
  });
});

describe('placementEntry', () => {
  it('reads the size and sha256 of the placed file', async () => {
    const file = path.join(root, 'Book.epub');
    fs.writeFileSync(file, 'epub bytes');
    expect(await placementEntry(file)).toEqual({ path: file, size: 10, sha256: sha('epub bytes'), placedAt: expect.any(String) });
  });

  it('refuses anything that is not a regular file', async () => {
    fs.mkdirSync(path.join(root, 'Book.epub'));
    await expect(placementEntry(path.join(root, 'Book.epub'))).rejects.toThrow('not a regular file');
  });
});

describe('mergePlacements', () => {
  const a = { path: '/m/A.epub', size: 1, sha256: 'a'.repeat(64), placedAt: 't1' };
  const b = { path: '/m/B.epub', size: 1, sha256: 'b'.repeat(64), placedAt: 't1' };

  it('starts a record from NULL ([] when nothing was placed)', () => {
    expect(mergePlacements(null, null)).toEqual([]);
    expect(mergePlacements(null, a)).toEqual([a]);
  });

  it('appends; the same path is replaced by the newest entry', () => {
    const newer = { ...a, sha256: 'c'.repeat(64), placedAt: 't2' };
    expect(mergePlacements([a, b], newer)).toEqual([b, newer]);
  });

  it('NULL from a request that delivered before: the record starts with the earlier-import marker', () => {
    expect(mergePlacements(null, a, true)).toEqual([UNRECORDED_EARLIER_IMPORT, a]);
    expect(mergePlacements(undefined, null, true)).toEqual([UNRECORDED_EARLIER_IMPORT]);
    expect(mergePlacements([], a, true)).toEqual([a]);
  });

  it('keeps whatever was stored, readable or not', () => {
    expect(mergePlacements([a, 'junk'], b)).toEqual([a, 'junk', b]);
    expect(mergePlacements({ odd: true }, b)).toEqual([{ odd: true }, b]);
  });
});

describe('recordEbookPlacement', () => {
  function placed(status: string) {
    const file = path.join(root, 'Book.epub');
    fs.writeFileSync(file, 'placed');
    return { source: '/dl/Book.epub', target: file, status, verified: true } as Parameters<typeof recordEbookPlacement>[1];
  }

  it('copied: writes the entry, merged into the stored record', async () => {
    const earlier = { path: '/m/A.pdf', size: 1, sha256: 'a'.repeat(64), placedAt: 't1' };
    prismaMock.request.findUnique.mockResolvedValue({ placedEbookFiles: [earlier] });
    const record = placed('copied');

    await recordEbookPlacement('req-1', record, logger);

    expect(prismaMock.request.findUnique).toHaveBeenCalledWith({ where: { id: 'req-1' }, select: { placedEbookFiles: true, completedAt: true } });
    expect(prismaMock.request.update).toHaveBeenCalledWith({
      where: { id: 'req-1' },
      data: { placedEbookFiles: [earlier, { path: record!.target, size: 6, sha256: sha('placed'), placedAt: expect.any(String) }] },
    });
  });

  it.each(['identical', 'present', 'differs'])('%s: writes the stored record unchanged ([] from NULL), no entry', async (status) => {
    prismaMock.request.findUnique.mockResolvedValue({ placedEbookFiles: null });

    await recordEbookPlacement('req-1', placed(status), logger);

    expect(prismaMock.request.update).toHaveBeenCalledWith({ where: { id: 'req-1' }, data: { placedEbookFiles: [] } });
  });

  it('no record yet but an earlier delivery (completedAt set before this import): the marker goes first', async () => {
    prismaMock.request.findUnique.mockResolvedValue({ placedEbookFiles: null, completedAt: new Date('2026-01-01T00:00:00Z') });
    const record = placed('copied');

    await recordEbookPlacement('req-1', record, logger);

    expect(prismaMock.request.update).toHaveBeenCalledWith({
      where: { id: 'req-1' },
      data: { placedEbookFiles: [UNRECORDED_EARLIER_IMPORT, expect.objectContaining({ path: record!.target })] },
    });
  });

  it('a record that exists is never marked, whatever completedAt says', async () => {
    prismaMock.request.findUnique.mockResolvedValue({ placedEbookFiles: [], completedAt: new Date('2026-01-01T00:00:00Z') });

    await recordEbookPlacement('req-1', placed('identical'), logger);

    expect(prismaMock.request.update).toHaveBeenCalledWith({ where: { id: 'req-1' }, data: { placedEbookFiles: [] } });
  });

  it('never throws: a database failure is logged and the import goes on', async () => {
    prismaMock.request.findUnique.mockRejectedValue(new Error('db down'));

    await expect(recordEbookPlacement('req-1', placed('copied'), logger)).resolves.toBeUndefined();
    expect(prismaMock.request.update).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('deleting this request will keep it'));
  });

  it('never throws: a placed file that cannot be read leaves the field as it was', async () => {
    const record = { source: '/dl/x.epub', target: path.join(root, 'missing.epub'), status: 'copied', verified: true } as Parameters<typeof recordEbookPlacement>[1];

    await recordEbookPlacement('req-1', record, logger);

    expect(prismaMock.request.update).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('otherRecordedEntries', () => {
  it('collects readable entries of other active ebook requests, of any book', async () => {
    const entry = { path: path.join(root, 'A.epub'), size: 1, sha256: 'a'.repeat(64), placedAt: 't' };
    prismaMock.request.findMany.mockResolvedValue([{ placedEbookFiles: [entry, 'junk'] }, { placedEbookFiles: null }]);

    expect(await otherRecordedEntries('req-1')).toEqual([entry]);
    expect(prismaMock.request.findMany).toHaveBeenCalledWith({
      where: { id: { not: 'req-1' }, deletedAt: null, type: 'ebook' },
      select: { placedEbookFiles: true },
    });
  });
});
