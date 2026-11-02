/**
 * Component: Delivered-request library link tests (#284)
 * Documentation: documentation/fixes/file-hash-matching.md
 *
 * findDeliveredLibraryItem ties a delivered request's RMAB folder to the Audiobookshelf item that
 * holds it, by path first and by file hash second. Real: path helper, files hash, canonical paths
 * (on a temp media_dir). The ABS item fetch is a plain stub.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateFilesHash } from '@/lib/utils/files-hash';
import {
  deliveryTime,
  findDeliveredLibraryItem,
  HASH_FALLBACK_LIMIT,
  LINK_HASH_LOOKUP_BUDGET,
  LINK_WINDOW_AFTER_MS,
  logAmbiguousLink,
  newLinkContext,
  type LinkRow,
} from '@/lib/services/library/request-library-link';
import { libraryRelativePath } from '@/lib/utils/library-item-path';
import { ITEM_CACHE_MS, ITEM_ERROR_CACHE_MS, type ItemCache } from '@/lib/services/library/library-item-lookup';

const HASH = generateFilesHash(['01 - Part One.mp3', '02 - Part Two.mp3']);
const OTHER_HASH = generateFilesHash(['track01.mp3']);
const DELIVERED = new Date('2026-10-20T12:00:00Z');
const minutes = (m: number) => new Date(DELIVERED.getTime() + m * 60_000);

let media: string;
const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };

/** An ABS item as GET /api/items/:id returns it (only the fields the link reads). */
function absItem(opts: { hash?: string; relPath?: string; isMissing?: boolean } = {}) {
  const names = opts.hash === OTHER_HASH ? ['track01.mp3'] : opts.hash === '' ? [] : ['01 - Part One.mp3', '02 - Part Two.mp3'];
  return {
    relPath: opts.relPath,
    isMissing: opts.isMissing ?? false,
    media: { audioFiles: names.map((filename) => ({ metadata: { filename } })) },
  };
}

function book(over: Partial<{ filePath: string | null; filesHash: string | null }> = {}) {
  return {
    id: 'ab-1',
    title: 'Delivered Book',
    filePath: path.join(media, 'Author', 'Delivered Book B0REQUEST1'),
    filesHash: HASH,
    ...over,
  };
}

function ctxWith(rows: LinkRow[], opts: {
  fetchItem?: (id: string) => Promise<unknown>;
  listed?: { externalId: string; isMissing?: boolean }[];
  audiobooks?: { id: string; absItemId?: string | null; filePath?: string | null }[];
  cache?: ItemCache;
  now?: () => number;
} = {}) {
  return newLinkContext({
    rows,
    mediaDir: media,
    audiobooks: opts.audiobooks ?? [],
    listedItems: opts.listed ?? [],
    fetchItem: opts.fetchItem ?? (async () => absItem()),
    logger,
    cache: opts.cache,
    now: opts.now,
  });
}

beforeAll(async () => {
  media = await fs.mkdtemp(path.join(os.tmpdir(), 'rmab-284-'));
});
afterAll(async () => {
  await fs.rm(media, { recursive: true, force: true });
});
beforeEach(() => {
  vi.clearAllMocks();
});

describe('path link', () => {
  it("links RMAB's own folder (exact path) without fetching the item", async () => {
    const fetchItem = vi.fn();
    const rows = [{ plexGuid: 'abs-1', filePath: book().filePath!, addedAt: minutes(-600) }];
    const ctx = ctxWith(rows, { fetchItem, listed: [{ externalId: 'abs-1', isMissing: false }] });

    expect(await findDeliveredLibraryItem(book(), DELIVERED, ctx)).toEqual({ status: 'linked', plexGuid: 'abs-1', via: 'path' });
    expect(fetchItem).not.toHaveBeenCalled();
  });

  it('the same relative path under another folder, outside the window, links only by files hash', async () => {
    const rows = [{ plexGuid: 'abs-1', filePath: '/audiobooks/Author/Delivered Book B0REQUEST1', addedAt: minutes(-600) }];
    const ctx = ctxWith(rows, { listed: [{ externalId: 'abs-1', isMissing: false }] });

    expect(await findDeliveredLibraryItem(book(), DELIVERED, ctx)).toEqual({ status: 'linked', plexGuid: 'abs-1', via: 'hash' });
  });

  it('links an exact path match even when the hash differs (files renamed by an ABS tool)', async () => {
    const filePath = book().filePath!;
    const fetchItem = vi.fn(async () => absItem({ hash: OTHER_HASH, relPath: 'other' }));
    const ctx = ctxWith([{ plexGuid: 'abs-1', filePath, addedAt: minutes(-600) }], { fetchItem });

    expect(await findDeliveredLibraryItem(book(), DELIVERED, ctx)).toEqual({ status: 'linked', plexGuid: 'abs-1', via: 'path' });
  });

  it('a suffix-only match (another ABS mount) links when the item was added after delivery', async () => {
    const rows = [{ plexGuid: 'abs-1', filePath: '/mnt/abs/audiobooks/Author/Delivered Book B0REQUEST1', addedAt: minutes(5) }];
    const ctx = ctxWith(rows, { listed: [{ externalId: 'abs-1', isMissing: false }] });

    expect(await findDeliveredLibraryItem(book(), DELIVERED, ctx)).toEqual({ status: 'linked', plexGuid: 'abs-1', via: 'path' });
  });

  it('a suffix-only match from before delivery, without a hash match, does not link', async () => {
    const rows = [{ plexGuid: 'own-copy', filePath: '/books2/Old/Author/Delivered Book B0REQUEST1', addedAt: minutes(-24 * 60) }];
    const fetchItem = vi.fn(async () => absItem({ hash: OTHER_HASH, relPath: 'Old/Author/Delivered Book B0REQUEST1' }));
    const ctx = ctxWith(rows, { fetchItem });

    expect(await findDeliveredLibraryItem(book(), DELIVERED, ctx)).toEqual({ status: 'none' });
  });

  it('a suffix-only match from before delivery links when its files hash matches', async () => {
    const rows = [{ plexGuid: 'abs-1', filePath: '/books2/Old/Author/Delivered Book B0REQUEST1', addedAt: minutes(-24 * 60) }];
    const fetchItem = vi.fn(async () => absItem({ relPath: 'Old/Author/Delivered Book B0REQUEST1' }));
    const ctx = ctxWith(rows, { fetchItem });

    expect(await findDeliveredLibraryItem(book(), DELIVERED, ctx)).toEqual({ status: 'linked', plexGuid: 'abs-1', via: 'hash' });
  });

  it('normalizes trailing slashes, backslashes and NFD vs NFC on both sides', async () => {
    const nfd = 'Ame\u0301lie Poulain';
    const rmabFolder = path.join(media, 'Author', nfd) + path.sep;
    const rows = [{ plexGuid: 'abs-1', filePath: 'D:\\abs\\Author\\Am\u00e9lie Poulain\\', addedAt: minutes(10) }];
    const ctx = ctxWith(rows, { listed: [{ externalId: 'abs-1', isMissing: false }] });

    expect(await findDeliveredLibraryItem(book({ filePath: rmabFolder }), DELIVERED, ctx)).toEqual({ status: 'linked', plexGuid: 'abs-1', via: 'path' });
  });

  it('skips an item ABS reports as missing (from the listing or the item fetch)', async () => {
    const filePath = book().filePath!;
    const listed = ctxWith([{ plexGuid: 'gone', filePath, addedAt: minutes(5) }], { listed: [{ externalId: 'gone', isMissing: true }] });
    expect(await findDeliveredLibraryItem(book({ filesHash: null }), DELIVERED, listed)).toEqual({ status: 'none' });

    const fetched = ctxWith([{ plexGuid: 'gone', filePath, addedAt: minutes(5) }], { fetchItem: async () => absItem({ isMissing: true }) });
    expect(await findDeliveredLibraryItem(book(), DELIVERED, fetched)).toEqual({ status: 'none' });
  });

  it('two path candidates: the one whose files hash matches wins', async () => {
    const rows = [
      { plexGuid: 'lib-a', filePath: '/a/Author/Delivered Book B0REQUEST1', addedAt: minutes(5) },
      { plexGuid: 'lib-b', filePath: '/b/Author/Delivered Book B0REQUEST1', addedAt: minutes(6) },
    ];
    const fetchItem = vi.fn(async (id: string) => absItem({ hash: id === 'lib-b' ? HASH : OTHER_HASH, relPath: 'Author/Delivered Book B0REQUEST1' }));
    const ctx = ctxWith(rows, { fetchItem });

    expect(await findDeliveredLibraryItem(book(), DELIVERED, ctx)).toEqual({ status: 'linked', plexGuid: 'lib-b', via: 'hash' });
  });

  it('two path candidates and no single hash match: ambiguous, no link', async () => {
    const rows = [
      { plexGuid: 'lib-a', filePath: '/a/Author/Delivered Book B0REQUEST1', addedAt: minutes(5) },
      { plexGuid: 'lib-b', filePath: '/b/Author/Delivered Book B0REQUEST1', addedAt: minutes(6) },
    ];
    const ctx = ctxWith(rows, { fetchItem: async () => absItem({ hash: OTHER_HASH, relPath: 'Author/Delivered Book B0REQUEST1' }) });

    expect(await findDeliveredLibraryItem(book(), DELIVERED, ctx)).toEqual({ status: 'ambiguous', ids: ['lib-a', 'lib-b'] });
  });

  it('rejects an empty relative path (the folder is media_dir itself) and one outside media_dir', async () => {
    expect(await libraryRelativePath(media, media)).toBeNull();
    expect(await libraryRelativePath(path.join(media, '..', 'elsewhere', 'Book'), media)).toBeNull();
    expect(await libraryRelativePath(path.join(media, 'Author', 'Book'), media)).toBe('Author/Book');

    // filePath === media_dir: no path candidate even though a row "ends with" nothing; no hash → none
    const rows = [{ plexGuid: 'abs-1', filePath: '/audiobooks', addedAt: minutes(5) }];
    const ctx = ctxWith(rows, { listed: [{ externalId: 'abs-1', isMissing: false }] });
    expect(await findDeliveredLibraryItem(book({ filePath: media, filesHash: null }), DELIVERED, ctx)).toEqual({ status: 'none' });
  });
});

describe('hash fallback (no path candidate)', () => {
  const outside = () => path.join(media, '..', 'not-the-library', 'Delivered Book');

  it('a folder outside media_dir uses the hash fallback only', async () => {
    const rows = [{ plexGuid: 'abs-1', filePath: '/audiobooks/Somewhere/Else', addedAt: minutes(5) }];
    const ctx = ctxWith(rows);

    expect(await findDeliveredLibraryItem(book({ filePath: outside() }), DELIVERED, ctx)).toEqual({ status: 'linked', plexGuid: 'abs-1', via: 'hash' });
  });

  it('considers only unlinked rows added in the window, oldest first, at most 20', async () => {
    const rows: LinkRow[] = [
      { plexGuid: 'too-old', filePath: '/x/old', addedAt: minutes(-61) },
      { plexGuid: 'linked', filePath: '/x/linked', addedAt: minutes(1) },
      ...Array.from({ length: HASH_FALLBACK_LIMIT }, (_, i) => ({ plexGuid: `new-${i}`, filePath: `/x/new-${i}`, addedAt: minutes(2 + i) })),
      { plexGuid: 'past-cap', filePath: '/x/past-cap', addedAt: minutes(500) },
    ];
    const fetchItem = vi.fn(async (id: string) => absItem({ hash: ['too-old', 'linked', 'past-cap'].includes(id) ? HASH : OTHER_HASH }));
    const ctx = ctxWith(rows, { fetchItem, audiobooks: [{ id: 'other-book', absItemId: 'linked' }] });

    expect(await findDeliveredLibraryItem(book({ filePath: outside() }), DELIVERED, ctx)).toEqual({ status: 'none' });
    const fetched = fetchItem.mock.calls.map((c) => c[0]);
    expect(fetched).toEqual(Array.from({ length: HASH_FALLBACK_LIMIT }, (_, i) => `new-${i}`));
  });

  it('includes a row added up to 1 h before delivery', async () => {
    const ctx = ctxWith([{ plexGuid: 'early', filePath: '/x/early', addedAt: minutes(-59) }]);
    expect(await findDeliveredLibraryItem(book({ filePath: outside() }), DELIVERED, ctx)).toEqual({ status: 'linked', plexGuid: 'early', via: 'hash' });
  });

  it('two equal hashes: ambiguous, no link', async () => {
    const rows = [
      { plexGuid: 'one', filePath: '/x/one', addedAt: minutes(1) },
      { plexGuid: 'two', filePath: '/x/two', addedAt: minutes(2) },
    ];
    const ctx = ctxWith(rows);
    expect(await findDeliveredLibraryItem(book({ filePath: outside() }), DELIVERED, ctx)).toEqual({ status: 'ambiguous', ids: ['one', 'two'] });
  });

  it('an item ABS no longer has (404) is skipped and the loop goes on', async () => {
    const rows = [
      { plexGuid: 'deleted', filePath: '/x/deleted', addedAt: minutes(1) },
      { plexGuid: 'good', filePath: '/x/good', addedAt: minutes(2) },
    ];
    const fetchItem = vi.fn(async (id: string) => {
      if (id === 'deleted') throw new Error('ABS API error: 404 Not Found');
      return absItem();
    });
    const ctx = ctxWith(rows, { fetchItem });
    expect(await findDeliveredLibraryItem(book({ filePath: outside() }), DELIVERED, ctx)).toEqual({ status: 'linked', plexGuid: 'good', via: 'hash' });
  });

  it('an item that cannot be read (5xx) leaves the book undecided this run', async () => {
    const rows = [
      { plexGuid: 'broken', filePath: '/x/broken', addedAt: minutes(1) },
      { plexGuid: 'good', filePath: '/x/good', addedAt: minutes(2) },
    ];
    const fetchItem = vi.fn(async (id: string) => {
      if (id === 'broken') throw new Error('ABS API error: 500 Internal Server Error');
      return absItem();
    });
    const ctx = ctxWith(rows, { fetchItem });
    expect(await findDeliveredLibraryItem(book({ filePath: outside() }), DELIVERED, ctx)).toEqual({ status: 'unknown' });
  });

  it('the window ends 72 h after delivery', async () => {
    const inside = ctxWith([{ plexGuid: 'late', filePath: '/x/late', addedAt: new Date(DELIVERED.getTime() + LINK_WINDOW_AFTER_MS) }]);
    expect(await findDeliveredLibraryItem(book({ filePath: outside() }), DELIVERED, inside)).toEqual({ status: 'linked', plexGuid: 'late', via: 'hash' });
    const after = ctxWith([{ plexGuid: 'later', filePath: '/x/later', addedAt: minutes(73 * 60) }]);
    expect(await findDeliveredLibraryItem(book({ filePath: outside() }), DELIVERED, after)).toEqual({ status: 'none' });
  });

  it('no stored hash: no fallback', async () => {
    const fetchItem = vi.fn(async () => absItem());
    const ctx = ctxWith([{ plexGuid: 'abs-1', filePath: '/x/a', addedAt: minutes(1) }], { fetchItem });
    expect(await findDeliveredLibraryItem(book({ filePath: outside(), filesHash: null }), DELIVERED, ctx)).toEqual({ status: 'none' });
    expect(fetchItem).not.toHaveBeenCalled();
  });
});

describe('per-run guards', () => {
  it('fetches each item at most once per run', async () => {
    const fetchItem = vi.fn(async () => absItem({ hash: OTHER_HASH }));
    const ctx = ctxWith([{ plexGuid: 'abs-1', filePath: '/x/a', addedAt: minutes(1) }], { fetchItem });
    const outside = path.join(media, '..', 'elsewhere', 'Book');

    await findDeliveredLibraryItem({ ...book({ filePath: outside }), id: 'ab-1' }, DELIVERED, ctx);
    await findDeliveredLibraryItem({ ...book({ filePath: outside }), id: 'ab-2' }, DELIVERED, ctx);
    expect(fetchItem).toHaveBeenCalledTimes(1);
  });

  it(`stops fetching after ${LINK_HASH_LOOKUP_BUDGET} item lookups in one run`, async () => {
    // One row every 10 min; each book's window (delivery - 1 h, 20 oldest) covers 20 new rows
    const rows = Array.from({ length: 70 }, (_, i) => ({ plexGuid: `i-${i}`, filePath: `/x/${i}`, addedAt: minutes(i * 10) }));
    const fetchItem = vi.fn(async (id: string) => absItem({ hash: id === 'i-65' ? HASH : OTHER_HASH }));
    const ctx = ctxWith(rows, { fetchItem });
    const outside = path.join(media, '..', 'elsewhere', 'Book');

    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push(await findDeliveredLibraryItem({ ...book({ filePath: outside }), id: `ab-${i}` }, minutes(60 + i * 200), ctx));
    }
    expect(fetchItem).toHaveBeenCalledTimes(LINK_HASH_LOOKUP_BUDGET);
    // the third book's pool hits the budget halfway: undecided, as is the fourth (its match i-65 is never read)
    expect(results.map((r) => r.status)).toEqual(['none', 'none', 'unknown', 'unknown']);
  });

  it('a later run reuses a read item for 6 h, then reads it again', async () => {
    let now = DELIVERED.getTime();
    const cache: ItemCache = new Map();
    const fetchItem = vi.fn(async () => absItem({ hash: OTHER_HASH }));
    const rows = [{ plexGuid: 'abs-1', filePath: '/x/a', addedAt: minutes(1) }];
    const run = () => findDeliveredLibraryItem(book({ filePath: path.join(media, '..', 'elsewhere', 'Book') }), DELIVERED, ctxWith(rows, { fetchItem, cache, now: () => now }));

    await run();
    now += ITEM_CACHE_MS - 1;
    await run();
    expect(fetchItem).toHaveBeenCalledTimes(1);
    now += 1;
    await run();
    expect(fetchItem).toHaveBeenCalledTimes(2);
  });

  it('a later run asks again for an unreadable item only after 1 h', async () => {
    let now = DELIVERED.getTime();
    const cache: ItemCache = new Map();
    const fetchItem = vi.fn(async () => { throw new Error('ABS API error: 502 Bad Gateway'); });
    const rows = [{ plexGuid: 'abs-1', filePath: '/x/a', addedAt: minutes(1) }];
    const run = () => findDeliveredLibraryItem(book({ filePath: path.join(media, '..', 'elsewhere', 'Book') }), DELIVERED, ctxWith(rows, { fetchItem, cache, now: () => now }));

    expect(await run()).toEqual({ status: 'unknown' });
    now += ITEM_ERROR_CACHE_MS - 1;
    expect(await run()).toEqual({ status: 'unknown' });
    expect(fetchItem).toHaveBeenCalledTimes(1);
    now += 1;
    await run();
    expect(fetchItem).toHaveBeenCalledTimes(2);
  });

  it('warns once per audiobook about an ambiguous link, then logs at debug', () => {
    logAmbiguousLink({ id: 'ab-warn', title: 'Twice' }, ['x', 'y'], logger);
    logAmbiguousLink({ id: 'ab-warn', title: 'Twice' }, ['x', 'y'], logger);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.debug).toHaveBeenCalledTimes(1);
  });
});

describe('delivery time', () => {
  it('is the audiobook request completion time, not the shared audiobook row (ebook finished first)', async () => {
    // The audio was delivered at DELIVERED and ABS added the item 10 min later. An ebook import then
    // took over the shared audiobook row: filePath = the ebook folder (separate ebook path template)
    // and completedAt 3 h later. No path candidate is left, so the hash fallback decides, and its
    // window must start at the audiobook request's delivery.
    const request = { completedAt: DELIVERED, updatedAt: minutes(200) };
    const ebookRow = { ...book({ filePath: path.join(media, 'Ebooks', 'Author', 'Delivered Book') }), fileFormat: 'epub', completedAt: minutes(180) };
    const rows = [{ plexGuid: 'abs-1', filePath: '/audiobooks/Author/Delivered Book B0REQUEST1', addedAt: minutes(10) }];
    const ctx = ctxWith(rows, { listed: [{ externalId: 'abs-1', isMissing: false }] });

    expect(deliveryTime(request)).toEqual(DELIVERED);
    expect(await findDeliveredLibraryItem(ebookRow, deliveryTime(request), ctx)).toEqual({ status: 'linked', plexGuid: 'abs-1', via: 'hash' });
    // With the row's (ebook) completion time the item would fall outside the window
    expect(await findDeliveredLibraryItem({ ...ebookRow, id: 'ab-other' }, ebookRow.completedAt, ctxWith(rows))).toEqual({ status: 'none' });
  });

  it('falls back to updatedAt when the request has no completion time', () => {
    expect(deliveryTime({ completedAt: null, updatedAt: DELIVERED })).toEqual(DELIVERED);
  });
});
