/**
 * Component: Series Search API Route Tests
 * Documentation: documentation/integrations/audible-series-search.md
 */

import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Plain holders: the config's mockReset clears vi.fn implementations per test
const state = vi.hoisted(() => ({
  user: { id: 'user-1', sub: 'user-1', role: 'user' } as unknown,
  search: (async () => []) as (query: string, options?: unknown) => Promise<unknown[]>,
  queries: [] as string[],
}));

vi.mock('@/lib/middleware/auth', () => ({ getCurrentUser: () => state.user }));
vi.mock('@/lib/integrations/audible.service', async () => (await import('../helpers/fake-audible-catalog')).audibleServiceModule);
vi.mock('@/lib/integrations/audible-series', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/integrations/audible-series')>()),
  searchForSeries: (query: string, options?: unknown) => {
    state.queries.push(query);
    return state.search(query, options);
  },
}));

async function get(query: string | null) {
  const { GET } = await import('@/app/api/series/search/route');
  const url = new URL('http://localhost/api/series/search');
  if (query !== null) url.searchParams.set('q', query);
  const response = await GET({ nextUrl: url } as unknown as NextRequest);
  return { status: response.status, body: await response.json() };
}

describe('GET /api/series/search', () => {
  beforeEach(() => {
    state.user = { id: 'user-1', sub: 'user-1', role: 'user' };
    state.search = async () => [];
    state.queries = [];
  });

  it('guard: returns the series for a trimmed query', async () => {
    state.search = async () => [{ asin: 'B01N9CUGHG', title: 'Expeditionary Force' }];

    const { status, body } = await get('  expeditionary force ');

    expect(status).toBe(200);
    expect(body).toEqual({ success: true, series: [{ asin: 'B01N9CUGHG', title: 'Expeditionary Force' }], query: 'expeditionary force' });
    expect(state.queries).toEqual(['expeditionary force']);
  });

  it('answers 502 with fixed copy when Audible did not return results', async () => {
    const { SeriesSearchUnavailableError } = await import('@/lib/integrations/audible-series');
    state.search = async () => {
      throw new SeriesSearchUnavailableError('HTTP 503');
    };

    const { status, body } = await get('expeditionary force');

    expect(status).toBe(502);
    expect(body).toEqual({ error: 'AudibleUnavailable', message: "Audible didn't return series results. Try again in a moment." });
  });

  it('guard: answers 500 for any other failure', async () => {
    state.search = async () => {
      throw new TypeError('boom');
    };

    const { status, body } = await get('expeditionary force');

    expect(status).toBe(500);
    expect(body.error).toBe('SearchError');
  });

  it('guard: answers 400 for a whitespace-only query without searching', async () => {
    const { status } = await get('   ');

    expect(status).toBe(400);
    expect(state.queries).toEqual([]);
  });

  it('guard: answers 401 without a user', async () => {
    state.user = null;

    const { status } = await get('expeditionary force');

    expect(status).toBe(401);
  });
});
