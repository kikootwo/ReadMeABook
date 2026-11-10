/**
 * Component: Library view query tests (filters, facets, stats, sort, keyset paging, groups)
 * Documentation: documentation/features/library-view.md
 */

import { describe, expect, it } from 'vitest';
import { mergeLibrary } from '@/lib/library-view/merge';
import { runQuery, type LibraryFilters, type LibrarySortSpec } from '@/lib/library-view/query';
import type { LibraryEntry, LibraryRowRecord, RequestRecord } from '@/lib/library-view/types';
import { USERS, request, row } from './fixtures';

const NO_FILTERS: LibraryFilters = { tokens: [], status: null, source: null, requestedBy: null, hideAvailable: false };
const BY_ADDED: LibrarySortSpec = { sort: 'added', order: 'desc', group: 'none' };

function seed(): { rows: LibraryRowRecord[]; requests: RequestRecord[] } {
  const rows = [
    row({ asin: 'B0SCAN0001', title: 'Émile and the Detectives', author: 'Erich Kästner', year: 1929, addedAt: new Date('2026-01-03') }),
    row({ asin: 'B0LIB00001', title: 'Dune', author: 'Frank Herbert', year: 1965, addedAt: new Date('2026-01-02') }),
  ];
  const requests = [
    request({ status: 'available', user: USERS.alice, audiobook: { audibleAsin: 'B0LIB00001', series: 'Dune Chronicles' } }),
    request({ status: 'downloading', user: USERS.bob, createdAt: new Date('2026-02-05'), audiobook: { title: 'Hyperion', author: 'Dan Simmons', year: null } }),
    request({ status: 'failed', user: USERS.goneCarol, createdAt: new Date('2026-02-04'), audiobook: { title: 'Gone Book', author: 'Zed Author' } }),
    request({ status: 'awaiting_approval', user: USERS.carol, createdAt: new Date('2026-02-03'), audiobook: { title: 'Asked Book', author: 'Amy Author' } }),
    request({ status: 'denied', user: USERS.alice, createdAt: new Date('2026-02-02'), audiobook: { title: 'No Book', author: 'Ned Author' } }),
  ];
  return { rows, requests };
}

function entries(): LibraryEntry[] {
  const { rows, requests } = seed();
  return mergeLibrary(rows, requests);
}

describe('runQuery', () => {
  it('computes unfiltered stats and disjunctive facets', () => {
    const result = runQuery(entries(), { ...NO_FILTERS, status: new Set(['problem']) }, BY_ADDED, null, 60);
    expect(result.stats).toEqual({ total: 6, available: 2, onTheWay: 1, needsALook: 2 });
    expect(result.matched).toBe(1);
    // status facet ignores the status filter itself
    expect(result.facets.status).toEqual({ available: 2, on_the_way: 1, needs_approval: 1, awaiting_release: 0, problem: 1, denied: 1 });
    // source facet applies the status filter
    expect(result.facets.source).toEqual({ scan: 0, rmab: 1 });
  });

  it('lists every requester with counts, deleted accounts flagged and same names keyed by id', () => {
    const result = runQuery(entries(), NO_FILTERS, BY_ADDED, null, 60);
    const carols = result.facets.requestedBy.filter((f) => f.username === 'carol');
    expect(carols).toHaveLength(2);
    expect(carols.find((f) => f.userId === USERS.goneCarol.id)).toEqual({ userId: USERS.goneCarol.id, username: 'carol', count: 1, deleted: true });
    expect(carols.find((f) => f.userId === USERS.carol.id)).toEqual({ userId: USERS.carol.id, username: 'carol', count: 1 });
    expect(result.facets.requestedBy.find((f) => f.userId === USERS.alice.id)?.count).toBe(2);
  });

  it('requestedBy drops unknown ids silently; only unknown ids match nothing', () => {
    const unknown = '99999999-0000-4000-8000-000000000999';
    const both = runQuery(entries(), { ...NO_FILTERS, requestedBy: [USERS.bob.id, unknown] }, BY_ADDED, null, 60);
    expect(both.matched).toBe(1);
    expect(JSON.stringify(both)).not.toContain(unknown);
    expect(runQuery(entries(), { ...NO_FILTERS, requestedBy: [unknown] }, BY_ADDED, null, 60).matched).toBe(0);
  });

  it('search folds case and diacritics and needs every token; series and requested metadata count', () => {
    const run = (q: string) => runQuery(entries(), { ...NO_FILTERS, tokens: q.split(' ') }, BY_ADDED, null, 60);
    expect(run('emile kastner').page.map((e) => e.title)).toEqual(['Émile and the Detectives']);
    expect(run('chronicles').page.map((e) => e.title)).toEqual(['Dune']);
    expect(run('dune nomatch').matched).toBe(0);
  });

  it('hideAvailable drops available entries from items and facets', () => {
    const result = runQuery(entries(), { ...NO_FILTERS, hideAvailable: true }, BY_ADDED, null, 60);
    expect(result.matched).toBe(4);
    expect(result.facets.status.available).toBe(0);
    expect(result.stats.available).toBe(2);
  });

  it('sorts with nulls last in both directions and ties by id', () => {
    const years = (order: 'asc' | 'desc') =>
      runQuery(entries(), NO_FILTERS, { sort: 'year', order, group: 'none' }, null, 60).page.map((e) => e.year);
    expect(years('asc')).toEqual([1929, 1965, 2021, 2021, 2021, null]);
    expect(years('desc')).toEqual([2021, 2021, 2021, 1965, 1929, null]);
    const statuses = runQuery(entries(), NO_FILTERS, { sort: 'status', order: 'asc', group: 'none' }, null, 60).page.map((e) => e.statusGroup);
    expect(statuses).toEqual(['problem', 'needs_approval', 'on_the_way', 'available', 'available', 'denied']);
  });

  it('keyset pages cover every entry once and survive a removed boundary entry', () => {
    const all = entries();
    const seen: string[] = [];
    let tuple = null;
    for (let i = 0; i < 10; i++) {
      const page = runQuery(all, NO_FILTERS, { sort: 'title', order: 'asc', group: 'none' }, tuple, 2);
      seen.push(...page.page.map((e) => e.id));
      tuple = page.nextTuple;
      if (!tuple) break;
    }
    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);

    const first = runQuery(all, NO_FILTERS, BY_ADDED, null, 2);
    const without = all.filter((e) => e.id !== first.page[1].id);
    const next = runQuery(without, NO_FILTERS, BY_ADDED, first.nextTuple, 2);
    const expected = runQuery(all, NO_FILTERS, BY_ADDED, first.nextTuple, 2);
    expect(next.page.map((e) => e.id)).toEqual(expected.page.map((e) => e.id));
  });

  it('group=author orders by author then title; groups cover the page only, each counted over all matches', () => {
    const BY_AUTHOR: LibrarySortSpec = { sort: 'author', order: 'asc', group: 'author' };
    const { rows, requests } = seed();
    const more = request({ status: 'pending', user: USERS.bob, audiobook: { title: 'Zebra Book', author: 'Amy Author' } });
    const all = mergeLibrary(rows, [...requests, more]);

    const first = runQuery(all, NO_FILTERS, BY_AUTHOR, null, 2);
    expect(first.page.map((e) => [e.author, e.title])).toEqual([['Amy Author', 'Asked Book'], ['Amy Author', 'Zebra Book']]);
    expect(first.groups).toEqual([{ key: 'amy author', label: 'Amy Author', count: 2 }]);

    const second = runQuery(all, NO_FILTERS, BY_AUTHOR, first.nextTuple, 2);
    expect(second.groups?.map((g) => [g.label, g.count])).toEqual([['Dan Simmons', 1], ['Erich Kästner', 1]]);
    expect(runQuery(entries(), NO_FILTERS, BY_ADDED, null, 60).groups).toBeNull();
  });

  it('ebook seeds change no count (stats, facets, matched, requesters, source)', () => {
    const { rows, requests } = seed();
    const scanFound = rows[0];
    const ebookOnScan = request({ type: 'ebook', status: 'downloaded', user: USERS.bob, audiobook: { audibleAsin: scanFound.asin } });
    const ebookOnlyUser = { id: '00000000-0000-4000-8000-00000000e001', plexUsername: 'ebooker', deletedAt: null };
    const ebookOnly = request({ type: 'ebook', status: 'pending', user: ebookOnlyUser });

    const strip = (r: ReturnType<typeof runQuery>) => ({ stats: r.stats, facets: r.facets, matched: r.matched, ids: r.page.map((e) => [e.id, e.source]) });
    const before = strip(runQuery(mergeLibrary(rows, requests), NO_FILTERS, BY_ADDED, null, 60));
    const after = strip(runQuery(mergeLibrary(rows, [...requests, ebookOnScan, ebookOnly]), NO_FILTERS, BY_ADDED, null, 60));
    expect(after).toEqual(before);
  });
});
