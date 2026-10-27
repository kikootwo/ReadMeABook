/**
 * Component: AudibleService catalog fetch tests (one catalog-API attempt for callers with their own retry policy)
 * Documentation: documentation/integrations/audible-series-search.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudibleService } from '@/lib/integrations/audible.service';

const htmlClient = { get: vi.fn() };
const apiClient = { get: vi.fn() };

const axiosMock = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn() }));
const configServiceMock = vi.hoisted(() => ({ getAudibleRegion: vi.fn() }));

vi.mock('axios', () => ({ default: axiosMock, ...axiosMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configServiceMock }));

function newService(): AudibleService {
  const service = new AudibleService();
  // A retry on the default path would wait here; resolve at once so a retry shows up as a call count
  vi.spyOn(service as unknown as { delay: (ms: number) => Promise<void> }, 'delay').mockResolvedValue(undefined);
  return service;
}

describe('AudibleService.fetch with { catalog: true }', () => {
  beforeEach(() => {
    // initialize() creates htmlClient first, then apiClient
    axiosMock.create.mockReturnValueOnce(htmlClient).mockReturnValueOnce(apiClient);
    configServiceMock.getAudibleRegion.mockResolvedValue('us');
  });

  it('sends one GET on the catalog API client with the caller\'s signal and timeout unchanged', async () => {
    apiClient.get.mockResolvedValue({ data: { products: [] } });
    const signal = new AbortController().signal;
    const config = { params: { keywords: 'dune' }, signal, timeout: 4321 };

    const { data } = await newService().fetch('/1.0/catalog/products', config, { catalog: true });

    expect(data).toEqual({ data: { products: [] } });
    expect(apiClient.get).toHaveBeenCalledTimes(1);
    expect(apiClient.get).toHaveBeenCalledWith('/1.0/catalog/products', config);
    expect(apiClient.get.mock.calls[0][1].signal).toBe(signal);
    expect(apiClient.get.mock.calls[0][1].timeout).toBe(4321);
    expect(htmlClient.get).not.toHaveBeenCalled();
  });

  it('rethrows a 503 without retrying (the caller owns the retry policy)', async () => {
    const error = Object.assign(new Error('Service Unavailable'), { response: { status: 503 } });
    apiClient.get.mockRejectedValue(error);
    htmlClient.get.mockRejectedValue(error);

    await expect(newService().fetch('/1.0/catalog/products', {}, { catalog: true })).rejects.toBe(error);
    expect(apiClient.get).toHaveBeenCalledTimes(1);
    expect(htmlClient.get).not.toHaveBeenCalled();
  });

  it('guard: without the option, fetch still goes to the HTML client with its retries', async () => {
    // Guard only: unchanged default path
    htmlClient.get.mockResolvedValue({ data: '<html></html>' });

    await newService().fetch('/series/B000000001');

    expect(htmlClient.get).toHaveBeenCalledTimes(1);
    expect(apiClient.get).not.toHaveBeenCalled();
  });
});
