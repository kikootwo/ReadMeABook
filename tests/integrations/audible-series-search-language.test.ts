/**
 * Component: Series Search Language Filter Tests (#259)
 * Documentation: documentation/integrations/audible-language-filter.md
 *
 * Off: every series, accepted-language first (the ranking as before). On: series listed
 * only by other-language products are hidden and counted; products with no language are
 * kept. The setting is read by searchSeries itself, so a new caller can't miss it.
 * Recording: the UK keyword page for "cosmere" (29 English, 19 Spanish, 2 with none).
 */

import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeCatalog, loadCatalogFixture } from '../helpers/fake-audible-catalog';

vi.mock('@/lib/integrations/audible.service', async () => (await import('../helpers/fake-audible-catalog')).audibleServiceModule);
vi.mock('@/lib/services/config.service', async () => (await import('../helpers/fake-audible-catalog')).configServiceModule);
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (req: object, handler: (r: object) => Promise<Response>) => handler(Object.assign(req, { user: { id: 'user-1' } })),
}));

const { searchForSeries, searchSeries } = await import('@/lib/integrations/audible-series');
const { GET } = await import('@/app/api/series/search/route');

// Series that only the Spanish products list, in the recording
const SPANISH_ONLY = ['B08CZWGB5S', 'B08NQZGM15', 'B08D8SPPJH', 'B0D85F88FY', 'B0CCB55CZN', 'B0H7CPJVFG'];

async function route(query: string) {
  const url = new URL('http://localhost/api/series/search');
  url.searchParams.set('q', query);
  const res = await GET({ nextUrl: url } as unknown as NextRequest);
  return res.json();
}

beforeEach(() => {
  fakeCatalog.reset();
  fakeCatalog.region = 'uk';
  fakeCatalog.baseUrl = 'https://www.audible.co.uk';
  fakeCatalog.keyword = async () => loadCatalogFixture('uk-keywords-cosmere.json');
});

describe('searchSeries with the language filter', () => {
  it('off: the same series as searchForSeries, Spanish-only series ranked below, no hidden count', async () => {
    const result = await searchSeries('cosmere');
    const asins = result.series.map((s) => s.asin);

    expect(result).not.toHaveProperty('languageFilter');
    expect(result.series).toEqual(await searchForSeries('cosmere'));
    expect(asins.some((asin) => SPANISH_ONLY.includes(asin))).toBe(true);
  });

  it('on (read from the setting): Spanish-only series hidden and counted', async () => {
    fakeCatalog.languageFilter = true;

    const result = await searchSeries('cosmere');

    expect(result.series.map((s) => s.asin).filter((asin) => SPANISH_ONLY.includes(asin))).toEqual([]);
    expect(result.series.map((s) => s.title)).toContain('The Stormlight Archive');
    expect(result.languageFilter).toEqual({ language: 'en', hiddenCount: SPANISH_ONLY.length });
  });

  it('on: nothing in the language leaves no series and the full hidden count', async () => {
    fakeCatalog.languageFilter = true;
    fakeCatalog.keyword = async () => {
      const page = loadCatalogFixture('uk-keywords-cosmere.json');
      return { ...page, products: page.products.filter((p: { language?: string }) => p.language === 'spanish') };
    };

    // The 6 Spanish-only series plus one an English product also lists on the full page
    expect(await searchSeries('cosmere')).toEqual({ series: [], languageFilter: { language: 'en', hiddenCount: 7 } });
  });
});

describe('GET /api/series/search', () => {
  it('off: the response has no new fields', async () => {
    const body = await route('cosmere');

    expect(Object.keys(body)).toEqual(['success', 'series', 'query']);
  });

  it('on: hiddenCount and the language name', async () => {
    fakeCatalog.languageFilter = true;

    const body = await route('cosmere');

    expect(body).toMatchObject({ success: true, query: 'cosmere', hiddenCount: 6, filterLanguage: 'English' });
  });
});
