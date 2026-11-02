/**
 * Component: Indexer Search Failure Tracking Tests (#522)
 * Documentation: documentation/phase3/prowlarr.md
 */

import { describe, expect, it } from 'vitest';
import {
  newSearchStats,
  noResultsMessage,
  recordFailure,
  searchErrorMessage,
  searchFailureSummary,
} from '@/lib/utils/indexer-search-failures';

const stats = (sent: number, failed: number) => ({ ...newSearchStats(), queriesSent: sent, queriesFailed: failed });

describe('searchErrorMessage', () => {
  it('keeps the error message only: no Prowlarr prefix, no URL, capped', () => {
    expect(searchErrorMessage(new Error('Failed to search Prowlarr: Request failed with status code 400'))).toBe('Request failed with status code 400');
    expect(searchErrorMessage(new Error('bad http://prowlarr:9696/api/v1/search?apikey=secret here'))).toBe('bad [url] here');
    expect(searchErrorMessage(new Error('x'.repeat(500)))).toHaveLength(200);
    expect(searchErrorMessage('not an error')).toBe('Unknown error');
  });
});

describe('noResultsMessage', () => {
  it.each([
    [stats(5, 0), 'No torrents/nzbs found. Will retry automatically.'],
    [stats(5, 2), 'No torrents/nzbs found (2 of 5 indexer searches failed; see System Logs). Will retry automatically.'],
    [stats(5, 5), 'All 5 indexer searches failed (see System Logs). Will retry automatically.'],
    [stats(1, 1), 'The indexer search failed (see System Logs). Will retry automatically.'],
  ])('%o', (s, message) => {
    expect(noResultsMessage('No torrents/nzbs found', s)).toBe(message);
  });
});

describe('searchFailureSummary', () => {
  it('is undefined when nothing failed, else the count and up to 3 distinct errors', () => {
    expect(searchFailureSummary(stats(4, 0))).toBeUndefined();
    const s = newSearchStats();
    s.queriesSent = 3;
    for (const m of ['a', 'a', 'b', 'c', 'd']) recordFailure(s, 'q', new Error(m));
    expect(searchFailureSummary(s)).toEqual({ failed: 5, total: 8, errors: ['a', 'b', 'c'] });
  });
});
