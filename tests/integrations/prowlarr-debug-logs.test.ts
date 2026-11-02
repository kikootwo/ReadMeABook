/**
 * Component: Prowlarr Search Debug Logs Keep the Key Out
 * Documentation: documentation/phase3/prowlarr.md
 */

import { describe, expect, it, vi } from 'vitest';

const KEY = 'prowlarr-debug-key-123';
const logged = vi.hoisted(() => [] as string[]);
const clientMock = vi.hoisted(() => ({ get: vi.fn(), interceptors: { request: { use: vi.fn() } } }));

vi.mock('axios', () => ({ default: { create: () => clientMock, get: vi.fn() }, create: () => clientMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => ({ get: async () => null, getMany: async () => ({}) }) }));
vi.mock('@/lib/services/download-client-manager.service', () => ({
  getDownloadClientManager: () => ({ hasClientForProtocol: async () => false }),
}));
vi.mock('@/lib/utils/logger', () => {
  const record = (...args: unknown[]) => { logged.push(JSON.stringify(args)); };
  return { RMABLogger: { create: () => ({ info: record, debug: record, warn: record, error: record }) } };
});

describe('ProwlarrService.search debug logging', () => {
  it('logs raw results (kept and skipped) without the API key', async () => {
    clientMock.get.mockResolvedValue({
      data: [
        {
          guid: `https://prowlarr.example/1/download?apikey=${KEY}&link=a`,
          indexer: 'I', title: 'Book', size: 100, publishDate: '2024-01-01T00:00:00.000Z',
          downloadUrl: `https://prowlarr.example/1/download?apikey=${KEY}&link=a`, protocol: 'torrent',
        },
        // Skipped (no download URL), so it is logged as a skipped raw result
        { guid: 'g2', indexer: 'I', title: 'No link', size: 1, infoUrl: `https://indexer.example/info?apikey=${KEY}` },
      ],
    });

    const { ProwlarrService } = await import('@/lib/integrations/prowlarr.service');
    await new ProwlarrService('https://prowlarr.example', KEY).search('Book');

    const text = logged.join('\n');
    expect(text).toContain('Sample raw result from API');
    expect(text).toContain('was skipped');
    expect(text).not.toContain(KEY);
  });
});
