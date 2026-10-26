/**
 * Component: Audible Series Fill Tests (catalog series for books Audnexus lists without one)
 * Documentation: documentation/integrations/audible.md
 *
 * Reaches the fill only through AudibleService.getAudiobookDetails (axios mocked).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudibleService } from '@/lib/integrations/audible.service';
import { AUDIBLE_REGIONS } from '@/lib/types/audible';

const htmlClientMock = vi.hoisted(() => ({ get: vi.fn() }));
const apiClientMock = vi.hoisted(() => ({ get: vi.fn() }));
const axiosMock = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn() }));
const configServiceMock = vi.hoisted(() => ({ getAudibleRegion: vi.fn() }));
const logMock = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

vi.mock('axios', () => ({ default: axiosMock, ...axiosMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configServiceMock }));
vi.mock('@/lib/utils/logger', () => ({ RMABLogger: { create: () => logMock } }));

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const SAGA = { asin: 'SER0000001', title: 'Synthetic Saga', sequence: '2' };

/** Audnexus-shaped book with no seriesPrimary unless given. */
function audnexusBook(asin: string, extra: Record<string, unknown> = {}) {
  return {
    asin,
    title: `Audnexus Title ${asin}`,
    authors: [{ name: 'Audnexus Author', asin: 'AUTH000001' }],
    narrators: [{ name: 'Audnexus Narrator' }],
    summary: '<p>Audnexus summary.</p>',
    genres: [{ name: 'Fantasy', type: 'genre' }],
    language: 'english',
    ...extra,
  };
}

function catalogProduct(asin: string, overrides: Record<string, unknown> = {}) {
  return {
    asin,
    title: `Catalog Title ${asin}`,
    authors: [{ name: 'Catalog Author' }],
    narrators: [{ name: 'Catalog Narrator' }],
    publisher_summary: 'Catalog summary.',
    category_ladders: [{ ladder: [{ name: 'Catalog Genre' }] }],
    series: [SAGA],
    ...overrides,
  };
}

/** Audnexus answers every ASIN in `books`, 404 otherwise. */
function audnexusServes(books: Record<string, Record<string, unknown>>) {
  axiosMock.get.mockImplementation(async (url: string) => {
    const asin = url.split('/').pop() as string;
    if (books[asin]) return { data: books[asin] };
    throw Object.assign(new Error('Not found'), { response: { status: 404 } });
  });
}

/** Catalog answers every ASIN with `product(asin)`. */
function catalogServes(product: (asin: string) => Record<string, unknown>) {
  apiClientMock.get.mockImplementation(async (url: string) => {
    const asin = url.split('/').pop() as string;
    return { data: { product: product(asin) } };
  });
}

function httpError(status: number) {
  return Object.assign(new Error(`Request failed with status code ${status}`), { response: { status } });
}

beforeEach(() => {
  vi.clearAllMocks();
  htmlClientMock.get.mockReset();
  apiClientMock.get.mockReset();
  axiosMock.get.mockReset();
  axiosMock.create.mockReset();
  axiosMock.create.mockReturnValueOnce(htmlClientMock).mockReturnValueOnce(apiClientMock);
  configServiceMock.getAudibleRegion.mockReset();
  configServiceMock.getAudibleRegion.mockResolvedValue('us');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('getAudiobookDetails series fill', () => {
  it('fills series, part and series ASIN from the catalog when Audnexus has none', async () => {
    audnexusServes({ B0FILL0001: audnexusBook('B0FILL0001') });
    catalogServes((asin) => catalogProduct(asin));

    const details = await new AudibleService().getAudiobookDetails('B0FILL0001');

    expect(details).toMatchObject({ series: 'Synthetic Saga', seriesPart: '2', seriesAsin: 'SER0000001' });
    expect(apiClientMock.get).toHaveBeenCalledTimes(1);
    const [url, config] = apiClientMock.get.mock.calls[0];
    expect(url).toBe('/1.0/catalog/products/B0FILL0001');
    expect(config.params.response_groups).toContain('series');
    expect(config.timeout).toBe(5000);
    expect(config.signal).toBeInstanceOf(AbortSignal);
  });

  it('gives every fill request its own live 5 s abort deadline', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    audnexusServes({ B0DEAD0001: audnexusBook('B0DEAD0001'), B0DEAD0002: audnexusBook('B0DEAD0002') });
    catalogServes((asin) => catalogProduct(asin));
    const service = new AudibleService();

    await service.getAudiobookDetails('B0DEAD0001');
    await service.getAudiobookDetails('B0DEAD0002');

    expect(timeoutSpy).toHaveBeenCalledTimes(2);
    expect(timeoutSpy.mock.calls).toEqual([[5000], [5000]]);
    const signals = apiClientMock.get.mock.calls.map(([, config]) => config.signal as AbortSignal);
    expect(signals).toEqual(timeoutSpy.mock.results.map((r) => r.value));
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals.every((s) => s.aborted === false)).toBe(true);
  });

  it('takes only the series from the catalog; every other field stays Audnexus', async () => {
    audnexusServes({ B0FILL0002: audnexusBook('B0FILL0002') });
    catalogServes((asin) => catalogProduct(asin));

    const details = await new AudibleService().getAudiobookDetails('B0FILL0002');

    expect(details?.series).toBe('Synthetic Saga');
    expect(details?.seriesPart).toBe('2');
    expect(details?.seriesAsin).toBe('SER0000001');
    expect(details).toMatchObject({
      title: 'Audnexus Title B0FILL0002',
      author: 'Audnexus Author',
      narrator: 'Audnexus Narrator',
      description: 'Audnexus summary.',
      genres: ['Fantasy'],
    });
  });

  it('uses the first numbered series when the catalog lists several', async () => {
    audnexusServes({ B0FILL0003: audnexusBook('B0FILL0003') });
    catalogServes((asin) => catalogProduct(asin, {
      series: [
        { asin: 'SER0000009', title: 'Unnumbered Universe', sequence: '' },
        { asin: 'SER0000010', title: 'Numbered Arc', sequence: '2, Dramatized Adaptation' },
      ],
    }));

    const details = await new AudibleService().getAudiobookDetails('B0FILL0003');

    expect(details).toMatchObject({ series: 'Numbered Arc', seriesPart: '2', seriesAsin: 'SER0000010' });
  });

  it('asks the catalog of the configured region, and keeps outcomes per region', async () => {
    audnexusServes({ B0FILL0004: audnexusBook('B0FILL0004') });
    catalogServes((asin) => catalogProduct(asin));
    const service = new AudibleService();

    await service.getAudiobookDetails('B0FILL0004');
    configServiceMock.getAudibleRegion.mockResolvedValue('uk');
    axiosMock.create.mockReturnValueOnce(htmlClientMock).mockReturnValueOnce(apiClientMock);
    const details = await service.getAudiobookDetails('B0FILL0004');

    expect(details?.series).toBe('Synthetic Saga');
    expect(apiClientMock.get).toHaveBeenCalledTimes(2);
    expect(axiosMock.create.mock.calls[3][0].baseURL).toBe(AUDIBLE_REGIONS.uk.apiBaseUrl);
    expect(axiosMock.get.mock.calls[1][1].params).toEqual({ region: AUDIBLE_REGIONS.uk.audnexusParam });
  });

  it('keeps the Audnexus series and never calls the catalog when Audnexus has one', async () => {
    audnexusServes({
      B0FILL0005: audnexusBook('B0FILL0005', { seriesPrimary: { asin: 'SER0000020', name: 'Audnexus Saga', position: '3' } }),
    });
    catalogServes((asin) => catalogProduct(asin));

    const details = await new AudibleService().getAudiobookDetails('B0FILL0005');

    expect(details).toMatchObject({ series: 'Audnexus Saga', seriesPart: '3', seriesAsin: 'SER0000020' });
    expect(apiClientMock.get).not.toHaveBeenCalled();
  });

  it('skips the fill when the caller passes fillSeries: false', async () => {
    audnexusServes({ B0FILL0006: audnexusBook('B0FILL0006') });
    catalogServes((asin) => catalogProduct(asin));

    const details = await new AudibleService().getAudiobookDetails('B0FILL0006', { fillSeries: false });

    expect(details?.title).toBe('Audnexus Title B0FILL0006');
    expect(details?.series).toBeUndefined();
    expect(apiClientMock.get).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing title', { asin: 'SER0000030', sequence: '4' }],
    ['a whitespace-only title', { asin: 'SER0000031', title: '   ', sequence: '4' }],
    ['a title that is not a string', { asin: 'SER0000032', title: 42, sequence: '4' }],
  ])('fills nothing when the chosen catalog entry has %s', async (_label, entry) => {
    audnexusServes({ B0FILL0007: audnexusBook('B0FILL0007') });
    catalogServes((asin) => catalogProduct(asin, { series: [entry] }));

    const details = await new AudibleService().getAudiobookDetails('B0FILL0007');

    expect(apiClientMock.get).toHaveBeenCalledTimes(1);
    expect(details?.title).toBe('Audnexus Title B0FILL0007');
    expect(details?.series).toBeUndefined();
    expect(details?.seriesPart).toBeUndefined();
    expect(details?.seriesAsin).toBeUndefined();
  });
});

describe('series fill failures and the 15 min pause', () => {
  it('returns the details without a series after a 503, with one attempt and one warn', async () => {
    audnexusServes({ B0FAIL0001: audnexusBook('B0FAIL0001'), B0FAIL0002: audnexusBook('B0FAIL0002') });
    apiClientMock.get.mockRejectedValue(httpError(503));
    const service = new AudibleService();

    const first = await service.getAudiobookDetails('B0FAIL0001');
    const second = await service.getAudiobookDetails('B0FAIL0002');

    expect(first?.title).toBe('Audnexus Title B0FAIL0001');
    expect(first?.series).toBeUndefined();
    expect(second?.title).toBe('Audnexus Title B0FAIL0002');
    expect(second?.series).toBeUndefined();
    expect(apiClientMock.get).toHaveBeenCalledTimes(1);
    expect(logMock.warn).toHaveBeenCalledTimes(1);
    expect(logMock.warn.mock.calls[0][0]).toBe('Series lookups from the Audible catalog paused for 15 min after: HTTP 503 on B0FAIL0001');
    expect(logMock.error).not.toHaveBeenCalled();
    expect(logMock.debug.mock.calls.some(([msg]) => /B0FAIL0002 skipped/.test(msg))).toBe(true);
  });

  it.each([401, 403])('pauses after a %i (catalog blocked) and does not cache it', async (status) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));
    audnexusServes({ B0AUTH0001: audnexusBook('B0AUTH0001'), B0AUTH0002: audnexusBook('B0AUTH0002') });
    apiClientMock.get.mockRejectedValueOnce(httpError(status));
    const service = new AudibleService();

    await service.getAudiobookDetails('B0AUTH0001');
    await service.getAudiobookDetails('B0AUTH0002');
    expect(apiClientMock.get).toHaveBeenCalledTimes(1);
    expect(logMock.warn).toHaveBeenCalledTimes(1);
    expect(logMock.warn.mock.calls[0][0]).toBe(`Series lookups from the Audible catalog paused for 15 min after: HTTP ${status} on B0AUTH0001`);

    catalogServes((asin) => catalogProduct(asin));
    vi.setSystemTime(new Date(Date.now() + 16 * MINUTE));
    const details = await service.getAudiobookDetails('B0AUTH0001');

    expect(apiClientMock.get).toHaveBeenCalledTimes(2);
    expect(details?.series).toBe('Synthetic Saga');
  });

  it('asks the catalog again once the 15 min pause is over', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));
    audnexusServes({ B0FAIL0003: audnexusBook('B0FAIL0003') });
    apiClientMock.get.mockRejectedValueOnce(httpError(429));
    const service = new AudibleService();

    await service.getAudiobookDetails('B0FAIL0003');
    vi.setSystemTime(new Date(Date.now() + 14 * MINUTE));
    await service.getAudiobookDetails('B0FAIL0003');
    expect(apiClientMock.get).toHaveBeenCalledTimes(1);

    catalogServes((asin) => catalogProduct(asin));
    vi.setSystemTime(new Date(Date.now() + 2 * MINUTE));
    const details = await service.getAudiobookDetails('B0FAIL0003');

    expect(apiClientMock.get).toHaveBeenCalledTimes(2);
    expect(details?.series).toBe('Synthetic Saga');
  });

  it.each([
    ['an axios timeout', { code: 'ECONNABORTED' }, 'timeout (5 s)'],
    ['an abort at the deadline', { code: 'ERR_CANCELED', name: 'CanceledError' }, 'timeout (5 s)'],
    ['an abort signal timeout', { name: 'TimeoutError' }, 'timeout (5 s)'],
    ['a network error', { code: 'ECONNRESET', isAxiosError: true }, 'socket hang up'],
  ])('pauses after %s, returning the details', async (_label, fields, reason) => {
    audnexusServes({ B0FAIL0004: audnexusBook('B0FAIL0004'), B0FAIL0005: audnexusBook('B0FAIL0005') });
    apiClientMock.get.mockRejectedValue(Object.assign(new Error(reason === 'socket hang up' ? reason : 'canceled'), fields));
    const service = new AudibleService();

    const details = await service.getAudiobookDetails('B0FAIL0004');
    await service.getAudiobookDetails('B0FAIL0005');

    expect(details?.title).toBe('Audnexus Title B0FAIL0004');
    expect(details?.series).toBeUndefined();
    expect(apiClientMock.get).toHaveBeenCalledTimes(1);
    expect(logMock.warn).toHaveBeenCalledTimes(1);
    expect(logMock.warn.mock.calls[0][0]).toBe(`Series lookups from the Audible catalog paused for 15 min after: ${reason} on B0FAIL0004`);
  });

  it.each([
    ['a 404', () => apiClientMock.get.mockRejectedValueOnce(httpError(404))],
    ['a malformed product', () => catalogServes((asin) => catalogProduct(asin, { category_ladders: [{}] }))],
  ])('treats %s as that book having no series, without pausing', async (_label, firstAnswer) => {
    audnexusServes({ B0NONE0001: audnexusBook('B0NONE0001'), B0NONE0002: audnexusBook('B0NONE0002') });
    firstAnswer();
    const service = new AudibleService();

    const first = await service.getAudiobookDetails('B0NONE0001');
    catalogServes((asin) => catalogProduct(asin));
    const second = await service.getAudiobookDetails('B0NONE0002');
    const repeat = await service.getAudiobookDetails('B0NONE0001');

    expect(first?.title).toBe('Audnexus Title B0NONE0001');
    expect(first?.series).toBeUndefined();
    expect(second?.series).toBe('Synthetic Saga');
    expect(repeat?.title).toBe('Audnexus Title B0NONE0001');
    expect(repeat?.series).toBeUndefined();
    expect(apiClientMock.get).toHaveBeenCalledTimes(2);
    expect(logMock.warn).not.toHaveBeenCalled();
    expect(logMock.debug.mock.calls.some(([msg]) => /B0NONE0001 failed .*treated as no series/.test(msg))).toBe(true);
  });
});

describe('series fill cache (24 h, 2000 entries)', () => {
  it('reuses a filled series for the same ASIN without a second catalog call', async () => {
    audnexusServes({ B0CACH0001: audnexusBook('B0CACH0001') });
    catalogServes((asin) => catalogProduct(asin));
    const service = new AudibleService();

    await service.getAudiobookDetails('B0CACH0001');
    const again = await service.getAudiobookDetails('B0CACH0001');

    expect(again).toMatchObject({ series: 'Synthetic Saga', seriesPart: '2', seriesAsin: 'SER0000001' });
    expect(apiClientMock.get).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a product without series', (asin: string) => catalogProduct(asin, { series: undefined })],
    ['a stub without a title', (asin: string) => ({ asin })],
  ])('remembers "no series" after %s', async (_label, product) => {
    audnexusServes({ B0CACH0002: audnexusBook('B0CACH0002') });
    catalogServes(product);
    const service = new AudibleService();

    const first = await service.getAudiobookDetails('B0CACH0002');
    const again = await service.getAudiobookDetails('B0CACH0002');

    expect(first?.series).toBeUndefined();
    expect(again?.series).toBeUndefined();
    expect(again?.title).toBe('Audnexus Title B0CACH0002');
    expect(apiClientMock.get).toHaveBeenCalledTimes(1);
    expect(logMock.warn).not.toHaveBeenCalled();
  });

  it('asks the catalog again after 24 h', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));
    audnexusServes({ B0CACH0003: audnexusBook('B0CACH0003') });
    catalogServes((asin) => catalogProduct(asin));
    const service = new AudibleService();

    await service.getAudiobookDetails('B0CACH0003');
    vi.setSystemTime(new Date(Date.now() + 23 * HOUR));
    await service.getAudiobookDetails('B0CACH0003');
    expect(apiClientMock.get).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date(Date.now() + 2 * HOUR));
    await service.getAudiobookDetails('B0CACH0003');
    expect(apiClientMock.get).toHaveBeenCalledTimes(2);
  });

  it('evicts the oldest entry past 2000', async () => {
    const asins = Array.from({ length: 2001 }, (_, i) => `B0E${String(i).padStart(7, '0')}`);
    audnexusServes(Object.fromEntries(asins.map((asin) => [asin, audnexusBook(asin)])));
    catalogServes((asin) => catalogProduct(asin));
    const service = new AudibleService();

    for (const asin of asins) await service.getAudiobookDetails(asin);
    expect(apiClientMock.get).toHaveBeenCalledTimes(2001);

    await service.getAudiobookDetails(asins[2000]);
    expect(apiClientMock.get).toHaveBeenCalledTimes(2001);
    await service.getAudiobookDetails(asins[0]);
    expect(apiClientMock.get).toHaveBeenCalledTimes(2002);
  });
});
