/**
 * Component: Audible Details Fallback Tests (catalog details when Audnexus fails)
 * Documentation: documentation/integrations/audible.md
 *
 * Reaches the fallback only through AudibleService.getAudiobookDetails (axios mocked).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudibleService } from '@/lib/integrations/audible.service';

const htmlClientMock = vi.hoisted(() => ({ get: vi.fn() }));
const apiClientMock = vi.hoisted(() => ({ get: vi.fn() }));
const axiosMock = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn() }));
const configServiceMock = vi.hoisted(() => ({ getAudibleRegion: vi.fn() }));
const logMock = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

vi.mock('axios', () => ({ default: axiosMock, ...axiosMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configServiceMock }));
vi.mock('@/lib/utils/logger', () => ({ RMABLogger: { create: () => logMock } }));

const SAGA = { asin: 'SER0000001', title: 'Synthetic Saga', sequence: '2' };

/** The service's private retry delay, mocked so retries run instantly. */
type Delays = { delay: (ms: number) => Promise<void> };

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
  vi.restoreAllMocks();
});

describe('details fallback when Audnexus fails (unchanged)', () => {
  it('maps the catalog product once, with no second series call', async () => {
    audnexusServes({});
    catalogServes((asin) => catalogProduct(asin, { series: undefined }));

    const details = await new AudibleService().getAudiobookDetails('B0FALL0001');

    expect(details?.title).toBe('Catalog Title B0FALL0001');
    expect(details?.series).toBeUndefined();
    expect(apiClientMock.get).toHaveBeenCalledTimes(1);
  });

  it('keeps full retries and no deadline: a 503 then a 200 succeeds', async () => {
    audnexusServes({});
    apiClientMock.get
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValueOnce({ data: { product: catalogProduct('B0FALL0002') } });
    const service = new AudibleService();
    vi.spyOn(service as unknown as Delays, 'delay').mockResolvedValue(undefined);

    const details = await service.getAudiobookDetails('B0FALL0002');

    expect(details?.title).toBe('Catalog Title B0FALL0002');
    expect(apiClientMock.get).toHaveBeenCalledTimes(2);
    for (const [, config] of apiClientMock.get.mock.calls) {
      expect(config).not.toHaveProperty('timeout');
      expect(config).not.toHaveProperty('signal');
    }
  });

  it('logs a final fallback failure at error and returns null', async () => {
    audnexusServes({});
    apiClientMock.get.mockRejectedValue(httpError(503));
    const service = new AudibleService();
    vi.spyOn(service as unknown as Delays, 'delay').mockResolvedValue(undefined);

    const details = await service.getAudiobookDetails('B0FALL0003');

    expect(details).toBeNull();
    expect(apiClientMock.get).toHaveBeenCalledTimes(6);
    expect(logMock.error.mock.calls.some(([msg]) => /Catalog API details fetch failed for B0FALL0003/.test(msg))).toBe(true);
  });
});
