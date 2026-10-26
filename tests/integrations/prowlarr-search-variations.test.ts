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
