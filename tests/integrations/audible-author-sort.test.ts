/**
 * Component: Audible Author Catalog Sort Tests
 * Documentation: documentation/integrations/audible.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudibleService } from '@/lib/integrations/audible.service';

const htmlClientMock = vi.hoisted(() => ({ get: vi.fn() }));
const apiClientMock = vi.hoisted(() => ({ get: vi.fn() }));
const axiosMock = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn() }));
const configServiceMock = vi.hoisted(() => ({ getAudibleRegion: vi.fn() }));

vi.mock('axios', () => ({ default: axiosMock, ...axiosMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configServiceMock }));

describe('searchByAuthorAsin() sort order', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    axiosMock.create.mockReset().mockReturnValueOnce(htmlClientMock).mockReturnValueOnce(apiClientMock);
    configServiceMock.getAudibleRegion.mockResolvedValue('us');
    apiClientMock.get.mockResolvedValue({ data: { products: [], total_results: 0 } });
  });

  it('asks the catalog for newest first when newestFirst is set', async () => {
    await new AudibleService().searchByAuthorAsin('Some Author', 'A000AUTHOR', 2, { newestFirst: true });

    const params = apiClientMock.get.mock.calls[0][1].params;
    expect(params.products_sort_by).toBe('-ReleaseDate');
    expect(params).toMatchObject({ author: 'Some Author', page: 1, num_results: 50 });
  });

  it('keeps the catalog default order without the option', async () => {
    await new AudibleService().searchByAuthorAsin('Some Author', 'A000AUTHOR', 1);

    expect(apiClientMock.get.mock.calls[0][1].params).not.toHaveProperty('products_sort_by');
  });
});
