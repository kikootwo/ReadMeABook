/**
 * Component: Delivered-request library link, cases that must not link (#284)
 * Documentation: documentation/fixes/file-hash-matching.md
 *
 * The rule: never link a request to an item that might be another copy or another book; when
 * unsure, link nothing. Each case here linked the wrong item before (reviewers' probes). Real:
 * path helper, files hash, canonical paths (temp media_dir). The ABS item fetch is a plain stub.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { generateFilesHash } from '@/lib/utils/files-hash';
import { findDeliveredLibraryItem, markLinked, newLinkContext, type LinkRow } from '@/lib/services/library/request-library-link';

const GENERIC = ['01.mp3', '02.mp3', '03.mp3'];
const HASH = generateFilesHash(GENERIC);
const DELIVERED = new Date('2026-10-20T12:00:00Z');
const minutes = (m: number) => new Date(DELIVERED.getTime() + m * 60_000);
const DAY = 24 * 60;
const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
let media: string;

const item = (names: string[], relPath?: string) => ({ relPath, isMissing: false, media: { audioFiles: names.map((filename) => ({ metadata: { filename } })) } });
const notLinked = (r: { status: string }) => r.status !== 'linked';

function ctxWith(
  rows: LinkRow[],
  fetchItem: (id: string) => Promise<unknown>,
  listed: { externalId: string; relPath?: string; isMissing?: boolean }[] = [],
  audiobooks: { id: string; absItemId?: string | null; filePath?: string | null }[] = []
) {
  return newLinkContext({ rows, mediaDir: media, audiobooks, listedItems: listed, fetchItem, logger });
}

beforeAll(async () => { media = await fs.mkdtemp(path.join(os.tmpdir(), 'rmab-284w-')); });
afterAll(async () => { await fs.rm(media, { recursive: true, force: true }); });

describe('path rule', () => {
  it('an exact relPath in another ABS library folder (old, other files) does not link: the user\'s own copy', async () => {
    const book = { id: 'ab-1', title: 'T', filePath: path.join(media, 'Author', 'Title'), filesHash: HASH };
    const rows = [{ plexGuid: 'own-copy', filePath: '/books2/Author/Title', addedAt: minutes(-30 * DAY) }];
    const ctx = ctxWith(rows, async () => item(['other.m4b'], 'Author/Title'), [{ externalId: 'own-copy', relPath: 'Author/Title', isMissing: false }]);
    expect(await findDeliveredLibraryItem(book, DELIVERED, ctx)).toEqual({ status: 'none' });
  });

  it('two exact path candidates, one unreadable (ABS 500): no link this run', async () => {
    const book = { id: 'ab-2', title: 'T', filePath: path.join(media, 'Author', 'Title'), filesHash: HASH };
    const rows = [
      { plexGuid: 'own-copy', filePath: '/books2/Author/Title', addedAt: minutes(30) },
      { plexGuid: 'rmab-item', filePath: '/audiobooks/Author/Title', addedAt: minutes(-600) },
    ];
    const fetchItem = async (id: string) => { if (id === 'rmab-item') throw new Error('ABS API error: 500 Internal Server Error'); return item(['other.m4b'], 'Author/Title'); };
    const ctx = ctxWith(rows, fetchItem, [{ externalId: 'own-copy', relPath: 'Author/Title', isMissing: false }]);
    expect(notLinked(await findDeliveredLibraryItem(book, DELIVERED, ctx))).toBe(true);
  });

  it('the exact item is unreadable and a suffix-only item is in the window: no link this run', async () => {
    const book = { id: 'ab-3', title: 'Book E', filePath: path.join(media, 'Author', 'Book E'), filesHash: HASH };
    const rows = [
      { plexGuid: 'item-exact', filePath: book.filePath, addedAt: minutes(-600) },
      { plexGuid: 'item-suffix', filePath: '/other/x/Author/Book E', addedAt: minutes(DAY) },
    ];
    const fetchItem = async (id: string) => { if (id === 'item-exact') throw new Error('ABS API error: 503 Service Unavailable'); return item(GENERIC); };
    const ctx = ctxWith(rows, fetchItem, [{ externalId: 'item-suffix', isMissing: false }]);
    expect(notLinked(await findDeliveredLibraryItem(book, DELIVERED, ctx))).toBe(true);
  });

  it('a single-segment folder (template {title}): a suffix-only match by folder name alone does not link', async () => {
    const book = { id: 'ab-4', title: 'Dune', filePath: path.join(media, 'Dune'), filesHash: HASH };
    const rows = [{ plexGuid: 'item-other', filePath: '/audiobooks/Other Author/Dune', addedAt: minutes(10) }];
    const ctx = ctxWith(rows, async () => item(['other.m4b']), [{ externalId: 'item-other', isMissing: false }]);
    expect(await findDeliveredLibraryItem(book, DELIVERED, ctx)).toEqual({ status: 'none' });
  });

  it('filePath left at an ebook folder that holds an older audio item: RMAB\'s own item links by hash, not the old one', async () => {
    // audio template {author}/{title} {asin}, ebook template {author}/{title}; the ebook import overwrote filePath
    const book = { id: 'ab-5', title: 'T', filePath: path.join(media, 'Author', 'Title'), filesHash: HASH, fileFormat: 'epub' };
    const rows = [
      { plexGuid: 'own-copy', filePath: path.join(media, 'Author', 'Title'), addedAt: minutes(-90 * DAY) },
      { plexGuid: 'rmab-item', filePath: path.join(media, 'Author', 'Title B0REQUEST1'), addedAt: minutes(5) },
    ];
    const ctx = ctxWith(rows, async (id) => item(id === 'rmab-item' ? GENERIC : ['other.m4b']), [
      { externalId: 'own-copy', isMissing: false },
      { externalId: 'rmab-item', isMissing: false },
    ]);
    expect(await findDeliveredLibraryItem(book, DELIVERED, ctx)).toEqual({ status: 'linked', plexGuid: 'rmab-item', via: 'hash' });
  });
});

describe('hash fallback', () => {
  const outside = () => path.join(media, '..', 'outside', 'T');

  it('an item added long after delivery (30 days) is outside the window', async () => {
    const book = { id: 'ab-6', title: 'A', filePath: outside(), filesHash: HASH };
    const rows = [{ plexGuid: 'item-b', filePath: '/audiobooks/Author B/Book B B0BBBBBBBB', addedAt: minutes(30 * DAY) }];
    expect(await findDeliveredLibraryItem(book, DELIVERED, ctxWith(rows, async () => item(GENERIC)))).toEqual({ status: 'none' });
  });

  it('skips an item at another audiobook\'s folder, even when that book comes later in the run', async () => {
    const a = { id: 'ab-a', title: 'A', filePath: path.join(media, 'Author A', 'Book A'), filesHash: HASH }; // ABS has not scanned A yet
    const b = { id: 'ab-b', title: 'B', filePath: path.join(media, 'Author B', 'Book B'), filesHash: HASH };
    const rows = [{ plexGuid: 'item-b', filePath: '/audiobooks/Author B/Book B', addedAt: minutes(20) }];
    const ctx = ctxWith(rows, async () => item(GENERIC), [{ externalId: 'item-b', isMissing: false }], [
      { id: 'ab-a', filePath: a.filePath },
      { id: 'ab-b', filePath: b.filePath },
    ]);
    const ra = await findDeliveredLibraryItem(a, DELIVERED, ctx);
    if (ra.status === 'linked') markLinked(ctx, ra.plexGuid, a.id);
    const rb = await findDeliveredLibraryItem(b, minutes(10), ctx);
    expect([ra, rb]).toEqual([{ status: 'none' }, { status: 'linked', plexGuid: 'item-b', via: 'path' }]);
  });

  it('the first equal row is unreadable: no link this run (the second is not taken alone)', async () => {
    const book = { id: 'ab-7', title: 'T', filePath: outside(), filesHash: HASH };
    const rows = [
      { plexGuid: 'true-item', filePath: '/x/true', addedAt: minutes(1) },
      { plexGuid: 'other-book', filePath: '/x/other', addedAt: minutes(2) },
    ];
    const fetchItem = async (id: string) => { if (id === 'true-item') throw new Error('The operation was aborted due to timeout'); return item(GENERIC); };
    expect(notLinked(await findDeliveredLibraryItem(book, DELIVERED, ctxWith(rows, fetchItem)))).toBe(true);
  });
});
