/**
 * Component: Prowlarr searchWithVariations Query Set
 * Documentation: documentation/phase3/prowlarr.md
 */

import { describe, expect, it, vi } from 'vitest';

const clientMock = vi.hoisted(() => ({ get: vi.fn(), interceptors: { request: { use: vi.fn() } } }));

vi.mock('axios', () => ({ default: { create: () => clientMock, get: vi.fn() }, create: () => clientMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => ({ get: async () => null, getMany: async () => ({}) }) }));
vi.mock('@/lib/services/download-client-manager.service', () => ({
  getDownloadClientManager: () => ({ hasClientForProtocol: async () => false }),
}));

const result = (guid: string) => ({ guid, title: guid, indexer: 'I', size: 1, seeders: 1, publishDate: new Date(), downloadUrl: `magnet:?${guid}` });

async function serviceWithSpy() {
  const { ProwlarrService } = await import('@/lib/integrations/prowlarr.service');
  const service = new ProwlarrService('https://prowlarr.example', 'key');
  const search = vi.spyOn(service, 'search');
  return { service, search };
}

describe('ProwlarrService.searchWithVariations', () => {
  it('sends "title author" then "title" and dedupes by guid', async () => {
    const { service, search } = await serviceWithSpy();
    search.mockResolvedValueOnce([result('a'), result('b')] as any).mockResolvedValueOnce([result('b'), result('c')] as any);
    const filters = { categories: [7020], indexerIds: [1] };

    const results = await service.searchWithVariations('Book', 'Author', filters);

    expect(search.mock.calls).toEqual([['Book Author', filters], ['Book', filters]]);
    expect(results.map((r) => r.guid)).toEqual(['a', 'b', 'c']);
  });

  it.each([
    ['empty', ''],
    ['whitespace-only', '   '],
  ])('runs the title query once when the author is %s', async (_label, author) => {
    const { service, search } = await serviceWithSpy();
    search.mockResolvedValue([result('a')] as any);

    const results = await service.searchWithVariations('Book', author, { categories: [3030] });

    expect(search.mock.calls).toEqual([['Book', { categories: [3030] }]]);
    expect(results.map((r) => r.guid)).toEqual(['a']);
  });
});

describe('ProwlarrService.searchWithVariations: fallback pass (#316)', () => {
  const release = (guid: string, title: string) => ({ ...result(guid), title });
  const filters = { categories: [3030] };
  const queries = (search: { mock: { calls: unknown[][] } }) => search.mock.calls.map(([query]) => query);
  const ANARCHIST = "The Dungeon Anarchist's Cookbook";
  const DINNIMAN = 'Matt Dinniman';

  it('sends no extra query when the first pass finds the title', async () => {
    const { service, search } = await serviceWithSpy();
    search.mockResolvedValue([release('a', "Matt Dinniman - The Dungeon Anarchist's Cookbook [M4B]")] as never);

    const results = await service.searchWithVariations(ANARCHIST, DINNIMAN, filters);

    expect(queries(search)).toEqual([`${ANARCHIST} ${DINNIMAN}`, ANARCHIST]);
    expect(results.map((r) => r.guid)).toEqual(['a']);
  });

  it('counts a release that drops the apostrophe as finding the title', async () => {
    const { service, search } = await serviceWithSpy();
    search.mockResolvedValue([release('a', 'Matt.Dinniman.The.Dungeon.Anarchists.Cookbook.M4B')] as never);

    await service.searchWithVariations(ANARCHIST, DINNIMAN, filters);

    expect(search).toHaveBeenCalledTimes(2);
  });

  it('after an empty first pass, sends the title without its apostrophe and stops at the first query that finds the title', async () => {
    const { service, search } = await serviceWithSpy();
    search.mockImplementation(async (query: string) =>
      (query.includes("'") ? [] : [release(`hit-${query}`, 'The Dungeon Anarchists Cookbook - Matt Dinniman')]) as never);

    const results = await service.searchWithVariations(ANARCHIST, DINNIMAN, filters);

    expect(queries(search)).toEqual([
      `${ANARCHIST} ${DINNIMAN}`,
      ANARCHIST,
      `The Dungeon Anarchists Cookbook ${DINNIMAN}`,
    ]);
    expect(search.mock.calls.every(([, sent]) => sent === filters)).toBe(true);
    expect(results).toHaveLength(1);
  });

  it('runs the fallback after a first pass of other books, and keeps those results', async () => {
    const { service, search } = await serviceWithSpy();
    search
      .mockResolvedValueOnce([release('junk', 'The Anarchist Cookbook - William Powell')] as never)
      .mockResolvedValueOnce([])
      .mockResolvedValue([release('hit', 'Dungeon Anarchists Cookbook Matt Dinniman')] as never);

    const results = await service.searchWithVariations(ANARCHIST, DINNIMAN, filters);

    expect(queries(search)).toHaveLength(3);
    expect(results.map((r) => r.guid)).toEqual(['junk', 'hit']);
  });

  it.each([
    ['a colon subtitle (PR #304)', 'Tress of the Emerald Sea: A Cosmere Novel', 'Tress of the Emerald Sea'],
    ['a number then ". " (Eyji)', 'Primal Hunter 1. Une aventure de LitRPG', 'Primal Hunter 1'],
  ])('after an empty first pass, sends the title without %s', async (_label, title, base) => {
    const { service, search } = await serviceWithSpy();
    search.mockResolvedValue([]);

    await service.searchWithVariations(title, 'Author', filters);

    expect(queries(search)).toEqual([`${title} Author`, title, `${base} Author`, base]);
  });

  it('sends the stripped title, then the stripped subtitle-free title, when nothing is found', async () => {
    const { service, search } = await serviceWithSpy();
    search.mockResolvedValue([]);

    await service.searchWithVariations("Tom Clancy's Op-Center #12: War of Eagles", 'Tom Clancy', filters);

    expect(queries(search)).toEqual([
      "Tom Clancy's Op-Center #12: War of Eagles Tom Clancy",
      "Tom Clancy's Op-Center #12: War of Eagles",
      'Tom Clancys Op Center 12 War of Eagles Tom Clancy',
      'Tom Clancys Op Center 12 War of Eagles',
      'Tom Clancys Op Center 12 Tom Clancy',
      'Tom Clancys Op Center 12',
    ]);
  });

  it.each([
    ['Mr. Mercedes', 'Stephen King'],
    ['Project Hail Mary', 'Andy Weir'],
    ['Vol. 2', 'Someone'],
  ])('sends no fallback for a title with nothing to strip: %s', async (title, author) => {
    const { service, search } = await serviceWithSpy();
    search.mockResolvedValue([]);

    await service.searchWithVariations(title, author, filters);

    expect(queries(search)).toEqual([`${title} ${author}`, title]);
  });

  it('sends no subtitle-free query shorter than 3 letters ("Re:Zero" sends no "Re")', async () => {
    const { service, search } = await serviceWithSpy();
    search.mockResolvedValue([]);

    await service.searchWithVariations('Re:Zero', 'Tappei Nagatsuki', filters);

    expect(queries(search)).toEqual(['Re:Zero Tappei Nagatsuki', 'Re:Zero', 'Re Zero Tappei Nagatsuki', 'Re Zero']);
  });

  it('still sends a two-character subtitle-free title in a non-Latin script', async () => {
    const { service, search } = await serviceWithSpy();
    search.mockResolvedValue([]);

    await service.searchWithVariations('三体: 黑暗森林', '刘慈欣', filters);

    expect(queries(search)).toEqual(['三体: 黑暗森林 刘慈欣', '三体: 黑暗森林', '三体 刘慈欣', '三体']);
  });

  it('sends admin custom search terms exactly as typed, with no fallback', async () => {
    const { service, search } = await serviceWithSpy();
    search.mockResolvedValue([]);

    await service.searchWithVariations("Anarchist's Cookbook: Dungeon", DINNIMAN, filters, { exactTitle: true });

    expect(queries(search)).toEqual([`Anarchist's Cookbook: Dungeon ${DINNIMAN}`, "Anarchist's Cookbook: Dungeon"]);
  });

  it.each([
    [': The Book', 'Author'],
    ['   :   ', 'Author'],
    ["''", 'Author'],
    ['', 'Author'],
  ])('never sends an empty query (title %j)', async (title, author) => {
    const { service, search } = await serviceWithSpy();
    search.mockResolvedValue([]);

    await service.searchWithVariations(title, author, filters);

    expect(search).toHaveBeenCalled();
    expect(queries(search).every((query) => typeof query === 'string' && query.trim().length > 0)).toBe(true);
    expect(new Set(queries(search)).size).toBe(queries(search).length);
  });

  it('sends no fallback when every first-pass query failed', async () => {
    const { service, search } = await serviceWithSpy();
    search.mockRejectedValue(new Error('indexer down'));

    const results = await service.searchWithVariations(ANARCHIST, DINNIMAN, filters);

    expect(search).toHaveBeenCalledTimes(2);
    expect(results).toEqual([]);
  });
});

describe('hasUsableResult: apostrophes as in ranking (#316)', () => {
  const named = (title: string) => [{ ...result('a'), title }];

  it.each([
    ["Ender's Game", 'Enders.Game.Orson.Scott.Card.MP3', true],
    ["Ender's Game", "Orson Scott Card - Ender's Game [M4B]", true],
    ["The Lover's Dictionary", "David Levithan - The Lover's Dictionary [M4B]", true],
    ['The Lovers', "David Levithan - The Lover's Dictionary [M4B]", false],
    ['Enders', "Orson Scott Card - Ender's Game [M4B]", false],
  ])('%s: %s -> %s', async (title, release, usable) => {
    const { hasUsableResult } = await import('@/lib/integrations/prowlarr-query-variations');
    expect(hasUsableResult(title, named(release) as never)).toBe(usable);
  });
});
