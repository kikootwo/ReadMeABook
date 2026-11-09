/**
 * Component: Language Filter Single-Pick Tests (BookDate and shelf sync, #259)
 * Documentation: documentation/integrations/audible-language-filter.md
 *
 * BookDate's search fallback and shelf sync turn one search into one book (shelf sync
 * requests it). With the filter on and the first result in another language, the first
 * kept result is often another book or a podcast (recordings below, 2026-10-27), so they
 * then take only a later result in the region's language whose title matches. Off, or a
 * first result in the region's language or with none listed: the first result, as before.
 */

import fs from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const clientMock = vi.hoisted(() => ({ get: vi.fn() }));
const axiosMock = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn() }));
// Plain holders: the config's mockReset clears vi.fn implementations per test
const state = vi.hoisted(() => ({
  region: 'de',
  filter: true,
  requests: [] as Array<{ asin: string; title: string }>,
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('axios', () => ({ default: axiosMock, ...axiosMock }));
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({
    getAudibleRegion: async () => state.region,
    getAudibleLanguageFilter: async () => state.filter,
  }),
}));
vi.mock('@/lib/services/request-creator.service', () => ({
  createRequestForUser: async (_userId: string, book: { asin: string; title: string }) => {
    state.requests.push({ asin: book.asin, title: book.title });
    return { success: true };
  },
}));
vi.mock('@/lib/utils/audiobook-matcher', () => ({ findPlexMatch: async () => null }));

// Imported after the mocks are set up (they read prismaMock)
const { AudibleService, getAudibleService } = await import('@/lib/integrations/audible.service');
const { matchToAudnexus } = await import('@/lib/bookdate/helpers');
const { createEmptyStats, processShelfBooks } = await import('@/lib/services/shelf-sync-core.service');
const { RMABLogger } = await import('@/lib/utils/logger');

type Product = { asin: string; title: string; language?: string };
const recording = (name: string): { total_results: number; products: Product[] } =>
  JSON.parse(fs.readFileSync(path.resolve(__dirname, '../fixtures/audible-catalog', name), 'utf8'));

const RED_RISING_IT = recording('it-keywords-red-rising-pierce-brown.json');
const CROOKED_KINGDOM_DE = recording('de-keywords-crooked-kingdom-leigh-bardugo.json');
const SIX_OF_CROWS_DE = recording('de-keywords-six-of-crows-leigh-bardugo.json');

const log = RMABLogger.create('test');

function serve(region: string, page: { total_results: number; products: Product[] }) {
  state.region = region;
  clientMock.get.mockResolvedValue({ data: page });
  getAudibleService().forceReinitialize();
}

async function bookDatePick(title: string, author: string) {
  return (await matchToAudnexus(title, author))?.asin ?? null;
}

async function shelfSyncPick(title: string, author: string) {
  await processShelfBooks('goodreads', [{ bookId: 'gr-1', title, author }], 'user-1', 'shelf-1', createEmptyStats(), log, 10);
  const saved = prismaMock.bookMapping.create.mock.calls[0]?.[0]?.data;
  return { asin: saved?.audibleAsin ?? null, noMatch: saved?.noMatch, requests: state.requests };
}

beforeEach(() => {
  axiosMock.create.mockReturnValue(clientMock);
  state.filter = true;
  state.requests = [];
  prismaMock.audibleCache.findFirst.mockResolvedValue(null);
  prismaMock.audibleCache.findMany.mockResolvedValue([]);
  prismaMock.bookMapping.findUnique.mockResolvedValue(null);
  prismaMock.bookMapping.findMany.mockResolvedValue([]);
  prismaMock.bookMapping.create.mockImplementation(async ({ data }: { data: object }) => ({ id: 'map-1', ...data }));
  // Details by ASIN: the picked ASIN back, without another catalog call
  vi.spyOn(AudibleService.prototype, 'getAudiobookDetails').mockImplementation(async (asin: string) => ({
    asin, title: `Details ${asin}`, author: 'Author',
  }));
});

describe('filter on: no pick from the wrong book or a podcast', () => {
  it('it "Red Rising Pierce Brown": no result is Italian, the first is English and the first kept is a podcast', async () => {
    serve('it', RED_RISING_IT);
    const search = await new AudibleService().search('Red Rising Pierce Brown');
    expect(search.results[0]).toMatchObject({ title: 'Red Rising by Pierce Brown', language: undefined });

    expect(await bookDatePick('Red Rising', 'Pierce Brown')).toBeNull();
    expect(await shelfSyncPick('Red Rising', 'Pierce Brown')).toEqual({ asin: null, noMatch: true, requests: [] });
  });

  it('de "Crooked Kingdom Leigh Bardugo": the first kept (King of Scars) and "Kingdom of Crows" are not picked', async () => {
    serve('de', CROOKED_KINGDOM_DE);
    const search = await new AudibleService().search('Crooked Kingdom Leigh Bardugo');
    expect(search.results[0].title).toBe('King of Scars - Thron aus Asche und Gold');

    expect(await bookDatePick('Crooked Kingdom', 'Leigh Bardugo')).toBeNull();
    expect(await shelfSyncPick('Crooked Kingdom', 'Leigh Bardugo')).toEqual({ asin: null, noMatch: true, requests: [] });
  });

  it('de "Six of Crows Leigh Bardugo": the German edition has a translated title, so no match', async () => {
    serve('de', SIX_OF_CROWS_DE);

    expect(await bookDatePick('Six of Crows', 'Leigh Bardugo')).toBeNull();
    expect(await shelfSyncPick('Six of Crows (Six of Crows, #1)', 'Leigh Bardugo')).toEqual({ asin: null, noMatch: true, requests: [] });
  });

  it('picks the German edition whose title matches', async () => {
    serve('de', CROOKED_KINGDOM_DE);
    const german = CROOKED_KINGDOM_DE.products[2];
    expect(german).toMatchObject({ title: 'King of Scars - Thron aus Asche und Gold', language: 'german' });

    expect(await bookDatePick('King of Scars', 'Leigh Bardugo')).toBe(german.asin);
    expect(await shelfSyncPick('King of Scars (King of Scars, #1)', 'Leigh Bardugo')).toEqual({
      asin: german.asin,
      noMatch: false,
      requests: [{ asin: german.asin, title: german.title }],
    });
  });
});

describe('filter on, synthetic us pages: the title check runs only when the first result is in another language', () => {
  const product = (asin: string, title: string, language?: string) => ({
    asin, title, ...(language && { language }), authors: [{ name: 'J. R. R. Tolkien' }],
  });
  const HOBBIT = product('B0HOBBITEN', 'The Hobbit', 'english');
  const HOBBIT_DE = product('B0HOBBITDE', 'Der Hobbit', 'german');
  const PODCAST = product('B0PODCAST1', 'Middle-earth Weekly', 'english');
  const keywordCalls = () => clientMock.get.mock.calls.filter(([, config]) => config?.params?.keywords !== undefined).length;

  it('an English first result is taken as before, even when the requested title has more words', async () => {
    serve('us', { total_results: 2, products: [HOBBIT, PODCAST] });

    expect(await bookDatePick('The Hobbit, or There and Back Again', 'J. R. R. Tolkien')).toBe(HOBBIT.asin);
    expect((await shelfSyncPick('The Hobbit, or There and Back Again', 'J. R. R. Tolkien')).asin).toBe(HOBBIT.asin);
  });

  it('a first result with no language listed is taken as before', async () => {
    const noLanguage = product('B0NOLANG01', 'The Hobbit (Dramatised)');
    serve('us', { total_results: 2, products: [noLanguage, HOBBIT] });

    expect(await bookDatePick('The Hobbit', 'J. R. R. Tolkien')).toBe(noLanguage.asin);
  });

  it('a German first result followed by the English edition picks the English one', async () => {
    serve('us', { total_results: 2, products: [HOBBIT_DE, HOBBIT] });

    expect(await bookDatePick('The Hobbit', 'J. R. R. Tolkien')).toBe(HOBBIT.asin);
    expect((await shelfSyncPick('The Hobbit', 'J. R. R. Tolkien')).asin).toBe(HOBBIT.asin);
  });

  it('a German first result followed by an unrelated English podcast picks nothing', async () => {
    serve('us', { total_results: 2, products: [HOBBIT_DE, PODCAST] });

    expect(await bookDatePick('The Hobbit', 'J. R. R. Tolkien')).toBeNull();
    expect(await shelfSyncPick('The Hobbit', 'J. R. R. Tolkien')).toEqual({ asin: null, noMatch: true, requests: [] });
  });

  it('shelf sync searches once when results exist but none is taken (no retry without the series)', async () => {
    serve('us', { total_results: 2, products: [HOBBIT_DE, PODCAST] });
    clientMock.get.mockClear();

    expect((await shelfSyncPick('The Hobbit (Middle-earth, #1)', 'J. R. R. Tolkien')).noMatch).toBe(true);
    expect(keywordCalls()).toBe(1);
  });

  it('shelf sync still retries without the series when the search found nothing', async () => {
    serve('us', { total_results: 0, products: [] });
    clientMock.get.mockClear();

    await shelfSyncPick('The Hobbit (Middle-earth, #1)', 'J. R. R. Tolkien');
    expect(keywordCalls()).toBe(2);
  });
});

describe('filter off: the first result, as before', () => {
  it('it "Red Rising": BookDate and shelf sync take the first catalog product', async () => {
    state.filter = false;
    serve('it', RED_RISING_IT);
    const first = RED_RISING_IT.products[0];

    expect(await bookDatePick('Red Rising', 'Pierce Brown')).toBe(first.asin);
    expect((await shelfSyncPick('Red Rising', 'Pierce Brown')).asin).toBe(first.asin);
  });
});

