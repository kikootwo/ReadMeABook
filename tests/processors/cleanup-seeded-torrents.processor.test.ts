/**
 * Component: Cleanup Seeded Torrents Processor Tests
 * Documentation: documentation/backend/services/scheduler.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const configMock = vi.hoisted(() => ({ get: vi.fn() }));

const downloadClientManagerMock = vi.hoisted(() => ({
  getClientServiceForProtocol: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configMock,
}));

vi.mock('@/lib/services/download-client-manager.service', () => ({
  getDownloadClientManager: () => downloadClientManagerMock,
}));

describe('processCleanupSeededTorrents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips when no indexer configuration is found', async () => {
    configMock.get.mockResolvedValue(null);

    const { processCleanupSeededTorrents } = await import('@/lib/processors/cleanup-seeded-torrents.processor');
    const result = await processCleanupSeededTorrents({ jobId: 'job-1' });

    expect(result.skipped).toBe(true);
    expect(prismaMock.request.findMany).not.toHaveBeenCalled();
  });

  it('hard deletes orphaned SABnzbd requests', async () => {
    configMock.get.mockResolvedValue(
      JSON.stringify([{ name: 'IndexerA', seedingTimeMinutes: 30 }])
    );
    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 'req-1',
        deletedAt: new Date(),
        downloadHistory: [
          {
            selected: true,
            downloadStatus: 'completed',
            indexerName: 'IndexerA',
            nzbId: 'nzb-1',
            torrentHash: null,
          },
        ],
      },
    ]);
    prismaMock.request.delete.mockResolvedValue({});

    const { processCleanupSeededTorrents } = await import('@/lib/processors/cleanup-seeded-torrents.processor');
    const result = await processCleanupSeededTorrents({ jobId: 'job-2' });

    expect(result.success).toBe(true);
    expect(prismaMock.request.delete).toHaveBeenCalledWith({ where: { id: 'req-1' } });
    expect(downloadClientManagerMock.getClientServiceForProtocol).not.toHaveBeenCalled();
  });

  it('deletes torrents when seeding requirements are met with no shared downloads', async () => {
    configMock.get.mockResolvedValue(
      JSON.stringify([{ name: 'IndexerA', seedingTimeMinutes: 30 }])
    );
    const qbtClientMock = {
      clientType: 'qbittorrent',
      protocol: 'torrent',
      getDownload: vi.fn().mockResolvedValue({
        id: 'hash-1',
        name: 'Torrent',
        size: 0,
        bytesDownloaded: 0,
        progress: 1.0,
        status: 'seeding',
        downloadSpeed: 0,
        eta: 0,
        category: 'readmeabook',
        seedingTime: 60 * 40,
      }),
      deleteDownload: vi.fn().mockResolvedValue(undefined),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(qbtClientMock);
    prismaMock.request.findMany
      .mockResolvedValueOnce([
        {
          id: 'req-2',
          deletedAt: null,
          downloadHistory: [
            {
              selected: true,
              downloadStatus: 'completed',
              indexerName: 'IndexerA',
              torrentHash: 'hash-1',
              downloadClientId: 'hash-1',
              downloadClient: 'qbittorrent',
            },
          ],
        },
      ])
      .mockResolvedValueOnce([]);

    const { processCleanupSeededTorrents } = await import('@/lib/processors/cleanup-seeded-torrents.processor');
    const result = await processCleanupSeededTorrents({ jobId: 'job-3' });

    expect(result.cleaned).toBe(1);
    expect(qbtClientMock.deleteDownload).toHaveBeenCalledWith('hash-1', true);
  });

  it('keeps shared torrents and deletes soft-deleted request', async () => {
    configMock.get.mockResolvedValue(
      JSON.stringify([{ name: 'IndexerA', seedingTimeMinutes: 10 }])
    );
    const qbtClientMock = {
      clientType: 'qbittorrent',
      protocol: 'torrent',
      getDownload: vi.fn().mockResolvedValue({
        id: 'hash-2',
        name: 'Torrent',
        size: 0,
        bytesDownloaded: 0,
        progress: 1.0,
        status: 'seeding',
        downloadSpeed: 0,
        eta: 0,
        category: 'readmeabook',
        seedingTime: 60 * 20,
      }),
      deleteDownload: vi.fn(),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(qbtClientMock);
    prismaMock.request.findMany
      .mockResolvedValueOnce([
        {
          id: 'req-3',
          deletedAt: new Date(),
          downloadHistory: [
            {
              selected: true,
              downloadStatus: 'completed',
              indexerName: 'IndexerA',
              torrentHash: 'hash-2',
              downloadClientId: 'hash-2',
              downloadClient: 'qbittorrent',
            },
          ],
        },
      ])
      .mockResolvedValueOnce([{ id: 'req-4', status: 'downloaded' }]);

    prismaMock.request.delete.mockResolvedValue({});

    const { processCleanupSeededTorrents } = await import('@/lib/processors/cleanup-seeded-torrents.processor');
    const result = await processCleanupSeededTorrents({ jobId: 'job-4' });

    expect(result.skipped).toBe(1);
    expect(prismaMock.request.delete).toHaveBeenCalledWith({ where: { id: 'req-3' } });
    expect(qbtClientMock.deleteDownload).not.toHaveBeenCalled();
  });

  it('cleans up ebook torrents downloaded via indexer', async () => {
    configMock.get.mockResolvedValue(
      JSON.stringify([{ name: 'EbookIndexer', seedingTimeMinutes: 15 }])
    );
    const qbtClientMock = {
      clientType: 'qbittorrent',
      protocol: 'torrent',
      getDownload: vi.fn().mockResolvedValue({
        id: 'hash-ebook-1',
        name: 'Equal Rites - Terry Pratchett (epub)',
        size: 0,
        bytesDownloaded: 0,
        progress: 1.0,
        status: 'seeding',
        downloadSpeed: 0,
        eta: 0,
        category: 'readmeabook',
        seedingTime: 60 * 20, // 20 minutes, exceeds 15 min requirement
      }),
      deleteDownload: vi.fn().mockResolvedValue(undefined),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(qbtClientMock);
    prismaMock.request.findMany
      .mockResolvedValueOnce([
        {
          id: 'req-ebook-1',
          type: 'ebook',
          deletedAt: null,
          downloadHistory: [
            {
              selected: true,
              downloadStatus: 'completed',
              indexerName: 'EbookIndexer',
              torrentHash: 'hash-ebook-1',
              downloadClientId: 'hash-ebook-1',
              downloadClient: 'qbittorrent',
            },
          ],
        },
      ])
      .mockResolvedValueOnce([]); // No shared downloads

    const { processCleanupSeededTorrents } = await import('@/lib/processors/cleanup-seeded-torrents.processor');
    const result = await processCleanupSeededTorrents({ jobId: 'job-ebook-1' });

    expect(result.cleaned).toBe(1);
    expect(qbtClientMock.deleteDownload).toHaveBeenCalledWith('hash-ebook-1', true);
  });

  it('cleans up when ratio-only requirement is met', async () => {
    configMock.get.mockResolvedValue(
      JSON.stringify([{ name: 'RatioIndexer', seedingTimeMinutes: 0, ratioLimit: 1.0 }])
    );
    const qbtClientMock = {
      clientType: 'qbittorrent',
      protocol: 'torrent',
      getDownload: vi.fn().mockResolvedValue({
        id: 'hash-ratio-1',
        name: 'Ratio Torrent',
        size: 0,
        bytesDownloaded: 0,
        progress: 1.0,
        status: 'seeding',
        downloadSpeed: 0,
        eta: 0,
        category: 'readmeabook',
        seedingTime: 60,
        ratio: 1.5,
      }),
      deleteDownload: vi.fn().mockResolvedValue(undefined),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(qbtClientMock);
    prismaMock.request.findMany
      .mockResolvedValueOnce([
        {
          id: 'req-ratio-1',
          deletedAt: null,
          downloadHistory: [
            {
              selected: true,
              downloadStatus: 'completed',
              indexerName: 'RatioIndexer',
              torrentHash: 'hash-ratio-1',
              downloadClientId: 'hash-ratio-1',
              downloadClient: 'qbittorrent',
            },
          ],
        },
      ])
      .mockResolvedValueOnce([]);

    const { processCleanupSeededTorrents } = await import('@/lib/processors/cleanup-seeded-torrents.processor');
    const result = await processCleanupSeededTorrents({ jobId: 'job-ratio-1' });

    expect(result.cleaned).toBe(1);
    expect(qbtClientMock.deleteDownload).toHaveBeenCalledWith('hash-ratio-1', true);
  });

  it('skips when both criteria set, time met but ratio not met', async () => {
    configMock.get.mockResolvedValue(
      JSON.stringify([{ name: 'BothIndexer', seedingTimeMinutes: 30, ratioLimit: 1.0 }])
    );
    const qbtClientMock = {
      clientType: 'qbittorrent',
      protocol: 'torrent',
      getDownload: vi.fn().mockResolvedValue({
        id: 'hash-both-1',
        name: 'Both Torrent',
        size: 0,
        bytesDownloaded: 0,
        progress: 1.0,
        status: 'seeding',
        downloadSpeed: 0,
        eta: 0,
        category: 'readmeabook',
        seedingTime: 60 * 40,
        ratio: 0.5,
      }),
      deleteDownload: vi.fn(),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(qbtClientMock);
    prismaMock.request.findMany
      .mockResolvedValueOnce([
        {
          id: 'req-both-1',
          deletedAt: null,
          downloadHistory: [
            {
              selected: true,
              downloadStatus: 'completed',
              indexerName: 'BothIndexer',
              torrentHash: 'hash-both-1',
              downloadClientId: 'hash-both-1',
              downloadClient: 'qbittorrent',
            },
          ],
        },
      ])
      .mockResolvedValueOnce([]);

    const { processCleanupSeededTorrents } = await import('@/lib/processors/cleanup-seeded-torrents.processor');
    const result = await processCleanupSeededTorrents({ jobId: 'job-both-1' });

    expect(result.skipped).toBe(1);
    expect(qbtClientMock.deleteDownload).not.toHaveBeenCalled();
  });

  it('skips when both criteria set, ratio met but time not met', async () => {
    configMock.get.mockResolvedValue(
      JSON.stringify([{ name: 'BothIndexer', seedingTimeMinutes: 30, ratioLimit: 1.0 }])
    );
    const qbtClientMock = {
      clientType: 'qbittorrent',
      protocol: 'torrent',
      getDownload: vi.fn().mockResolvedValue({
        id: 'hash-both-2',
        name: 'Both Torrent',
        size: 0,
        bytesDownloaded: 0,
        progress: 1.0,
        status: 'seeding',
        downloadSpeed: 0,
        eta: 0,
        category: 'readmeabook',
        seedingTime: 60 * 10,
        ratio: 1.5,
      }),
      deleteDownload: vi.fn(),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(qbtClientMock);
    prismaMock.request.findMany
      .mockResolvedValueOnce([
        {
          id: 'req-both-2',
          deletedAt: null,
          downloadHistory: [
            {
              selected: true,
              downloadStatus: 'completed',
              indexerName: 'BothIndexer',
              torrentHash: 'hash-both-2',
              downloadClientId: 'hash-both-2',
              downloadClient: 'qbittorrent',
            },
          ],
        },
      ])
      .mockResolvedValueOnce([]);

    const { processCleanupSeededTorrents } = await import('@/lib/processors/cleanup-seeded-torrents.processor');
    const result = await processCleanupSeededTorrents({ jobId: 'job-both-2' });

    expect(result.skipped).toBe(1);
    expect(qbtClientMock.deleteDownload).not.toHaveBeenCalled();
  });

  it('cleans up when both criteria set and both met', async () => {
    configMock.get.mockResolvedValue(
      JSON.stringify([{ name: 'BothIndexer', seedingTimeMinutes: 30, ratioLimit: 1.0 }])
    );
    const qbtClientMock = {
      clientType: 'qbittorrent',
      protocol: 'torrent',
      getDownload: vi.fn().mockResolvedValue({
        id: 'hash-both-3',
        name: 'Both Torrent',
        size: 0,
        bytesDownloaded: 0,
        progress: 1.0,
        status: 'seeding',
        downloadSpeed: 0,
        eta: 0,
        category: 'readmeabook',
        seedingTime: 60 * 40,
        ratio: 1.5,
      }),
      deleteDownload: vi.fn().mockResolvedValue(undefined),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(qbtClientMock);
    prismaMock.request.findMany
      .mockResolvedValueOnce([
        {
          id: 'req-both-3',
          deletedAt: null,
          downloadHistory: [
            {
              selected: true,
              downloadStatus: 'completed',
              indexerName: 'BothIndexer',
              torrentHash: 'hash-both-3',
              downloadClientId: 'hash-both-3',
              downloadClient: 'qbittorrent',
            },
          ],
        },
      ])
      .mockResolvedValueOnce([]);

    const { processCleanupSeededTorrents } = await import('@/lib/processors/cleanup-seeded-torrents.processor');
    const result = await processCleanupSeededTorrents({ jobId: 'job-both-3' });

    expect(result.cleaned).toBe(1);
    expect(qbtClientMock.deleteDownload).toHaveBeenCalledWith('hash-both-3', true);
  });

  it('skips when ratio-only requirement set but client reports no ratio', async () => {
    configMock.get.mockResolvedValue(
      JSON.stringify([{ name: 'RatioIndexer', seedingTimeMinutes: 0, ratioLimit: 1.0 }])
    );
    const qbtClientMock = {
      clientType: 'qbittorrent',
      protocol: 'torrent',
      getDownload: vi.fn().mockResolvedValue({
        id: 'hash-noratio-1',
        name: 'No-Ratio Torrent',
        size: 0,
        bytesDownloaded: 0,
        progress: 1.0,
        status: 'seeding',
        downloadSpeed: 0,
        eta: 0,
        category: 'readmeabook',
        seedingTime: 60 * 100,
        // ratio intentionally omitted (undefined)
      }),
      deleteDownload: vi.fn(),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(qbtClientMock);
    prismaMock.request.findMany
      .mockResolvedValueOnce([
        {
          id: 'req-noratio-1',
          deletedAt: null,
          downloadHistory: [
            {
              selected: true,
              downloadStatus: 'completed',
              indexerName: 'RatioIndexer',
              torrentHash: 'hash-noratio-1',
              downloadClientId: 'hash-noratio-1',
              downloadClient: 'qbittorrent',
            },
          ],
        },
      ])
      .mockResolvedValueOnce([]);

    const { processCleanupSeededTorrents } = await import('@/lib/processors/cleanup-seeded-torrents.processor');
    const result = await processCleanupSeededTorrents({ jobId: 'job-noratio-1' });

    expect(result.skipped).toBe(1);
    expect(qbtClientMock.deleteDownload).not.toHaveBeenCalled();
  });

  it('detects shared torrents across audiobook and ebook requests', async () => {
    configMock.get.mockResolvedValue(
      JSON.stringify([{ name: 'SharedIndexer', seedingTimeMinutes: 10 }])
    );
    const qbtClientMock = {
      clientType: 'qbittorrent',
      protocol: 'torrent',
      getDownload: vi.fn().mockResolvedValue({
        id: 'hash-shared',
        name: 'Shared Torrent',
        size: 0,
        bytesDownloaded: 0,
        progress: 1.0,
        status: 'seeding',
        downloadSpeed: 0,
        eta: 0,
        category: 'readmeabook',
        seedingTime: 60 * 30,
      }),
      deleteDownload: vi.fn(),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(qbtClientMock);
    prismaMock.request.findMany
      .mockResolvedValueOnce([
        {
          id: 'req-audio-shared',
          type: 'audiobook',
          deletedAt: null,
          downloadHistory: [
            {
              selected: true,
              downloadStatus: 'completed',
              indexerName: 'SharedIndexer',
              torrentHash: 'hash-shared',
              downloadClientId: 'hash-shared',
              downloadClient: 'qbittorrent',
            },
          ],
        },
      ])
      // Shared torrent check finds an ebook request using same hash
      .mockResolvedValueOnce([{ id: 'req-ebook-shared', status: 'downloading' }]);

    const { processCleanupSeededTorrents } = await import('@/lib/processors/cleanup-seeded-torrents.processor');
    const result = await processCleanupSeededTorrents({ jobId: 'job-shared' });

    expect(result.skipped).toBe(1);
    expect(qbtClientMock.deleteDownload).not.toHaveBeenCalled();
  });
});


