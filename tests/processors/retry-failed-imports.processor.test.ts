/**
 * Component: Retry Failed Imports Processor Tests
 * Documentation: documentation/backend/services/scheduler.md
 */

import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { createJobQueueMock } from '../helpers/job-queue';

const prismaMock = createPrismaMock();
const jobQueueMock = createJobQueueMock();
const configMock = vi.hoisted(() => ({
  get: vi.fn(),
}));
const downloadClientManagerMock = vi.hoisted(() => ({
  getClientForProtocol: vi.fn(),
  getClientServiceForProtocol: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/services/job-queue.service', () => ({
  getJobQueueService: () => jobQueueMock,
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configMock,
}));

vi.mock('@/lib/services/download-client-manager.service', () => ({
  getDownloadClientManager: () => downloadClientManagerMock,
}));

describe('processRetryFailedImports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queues organize jobs using download client paths', async () => {
    const qbtClientMock = {
      clientType: 'qbittorrent',
      protocol: 'torrent',
      getDownload: vi.fn().mockResolvedValue({
        id: 'hash-1',
        name: 'Book',
        downloadPath: '/downloads/Book',
        progress: 1.0,
        status: 'completed',
        size: 0,
        bytesDownloaded: 0,
        downloadSpeed: 0,
        eta: 0,
        category: 'readmeabook',
      }),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(qbtClientMock);
    downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
      id: 'client-1',
      type: 'qbittorrent',
      name: 'qBittorrent',
      enabled: true,
      remotePathMappingEnabled: false,
    });

    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 'req-1',
        audiobook: { id: 'a1', title: 'Book' },
        downloadHistory: [{ torrentHash: 'hash-1', torrentName: 'Book', downloadClient: 'qbittorrent' }],
      },
    ]);

    const { processRetryFailedImports } = await import('@/lib/processors/retry-failed-imports.processor');
    const result = await processRetryFailedImports({ jobId: 'job-1' });

    expect(result.success).toBe(true);
    expect(prismaMock.request.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [
        { lastImportAt: { sort: 'asc', nulls: 'first' } },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
      take: 50,
    }));
    expect(prismaMock.request.update).toHaveBeenCalledWith({
      where: { id: 'req-1' },
      data: { lastImportAt: expect.any(Date) },
    });
    expect(jobQueueMock.addOrganizeJob).toHaveBeenCalledWith(
      'req-1',
      'a1',
      '/downloads/Book'
    );
  });

  it('returns early when no requests await import', async () => {
    prismaMock.request.findMany.mockResolvedValue([]);

    const { processRetryFailedImports } = await import('@/lib/processors/retry-failed-imports.processor');
    const result = await processRetryFailedImports({});

    expect(result.success).toBe(true);
    expect(result.triggered).toBe(0);
    expect(jobQueueMock.addOrganizeJob).not.toHaveBeenCalled();
  });

  it('skips requests missing download history', async () => {
    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 'req-2',
        audiobook: { id: 'a2', title: 'Book' },
        downloadHistory: [],
      },
    ]);

    const { processRetryFailedImports } = await import('@/lib/processors/retry-failed-imports.processor');
    const result = await processRetryFailedImports({ jobId: 'job-2' });

    expect(result.skipped).toBe(1);
    expect(result.triggered).toBe(0);
    expect(prismaMock.request.update).toHaveBeenCalledWith({
      where: { id: 'req-2' },
      data: { lastImportAt: expect.any(Date) },
    });
  });

  it('falls back to configured download dir when qBittorrent lookup fails', async () => {
    const qbtClientMock = {
      clientType: 'qbittorrent',
      protocol: 'torrent',
      getDownload: vi.fn().mockRejectedValue(new Error('not found')),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(qbtClientMock);
    downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
      id: 'client-1',
      type: 'qbittorrent',
      name: 'qBittorrent',
      enabled: true,
      remotePathMappingEnabled: true,
      remotePath: '/remote',
      localPath: '/downloads',
    });
    configMock.get.mockResolvedValue('/remote');

    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 'req-3',
        audiobook: { id: 'a3', title: 'Book' },
        downloadHistory: [{ torrentHash: 'hash-3', torrentName: 'Book', downloadClient: 'qbittorrent' }],
      },
    ]);

    const { processRetryFailedImports } = await import('@/lib/processors/retry-failed-imports.processor');
    const result = await processRetryFailedImports({ jobId: 'job-3' });

    expect(result.triggered).toBe(1);
    expect(jobQueueMock.addOrganizeJob).toHaveBeenCalledWith(
      'req-3',
      'a3',
      path.join('/downloads', 'Book')
    );
  });

  it('uses SABnzbd download path when available', async () => {
    const sabClientMock = {
      clientType: 'sabnzbd',
      protocol: 'usenet',
      getDownload: vi.fn().mockResolvedValue({
        id: 'nzb-1',
        name: 'Book',
        downloadPath: '/remote/nzb/Book',
        progress: 1.0,
        status: 'completed',
        size: 0,
        bytesDownloaded: 0,
        downloadSpeed: 0,
        eta: 0,
        category: 'readmeabook',
      }),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(sabClientMock);
    downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
      id: 'client-2',
      type: 'sabnzbd',
      name: 'SABnzbd',
      enabled: true,
      remotePathMappingEnabled: true,
      remotePath: '/remote/nzb',
      localPath: '/downloads',
    });
    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 'req-4',
        audiobook: { id: 'a4', title: 'Book' },
        downloadHistory: [{ nzbId: 'nzb-1', torrentName: 'Book', downloadClient: 'sabnzbd' }],
      },
    ]);

    const { processRetryFailedImports } = await import('@/lib/processors/retry-failed-imports.processor');
    const result = await processRetryFailedImports({ jobId: 'job-4' });

    expect(result.triggered).toBe(1);
    expect(jobQueueMock.addOrganizeJob).toHaveBeenCalledWith(
      'req-4',
      'a4',
      path.join('/downloads', 'Book')
    );
  });

  it('skips SABnzbd retries when download dir is missing', async () => {
    const sabClientMock = {
      clientType: 'sabnzbd',
      protocol: 'usenet',
      getDownload: vi.fn().mockResolvedValue(null),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(sabClientMock);
    downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
      id: 'client-2',
      type: 'sabnzbd',
      name: 'SABnzbd',
      enabled: true,
      remotePathMappingEnabled: false,
    });
    configMock.get.mockResolvedValue(null);
    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 'req-5',
        audiobook: { id: 'a5', title: 'Book' },
        downloadHistory: [{ nzbId: 'nzb-2', torrentName: 'Book', downloadClient: 'sabnzbd' }],
      },
    ]);

    const { processRetryFailedImports } = await import('@/lib/processors/retry-failed-imports.processor');
    const result = await processRetryFailedImports({ jobId: 'job-5' });

    expect(result.skipped).toBe(1);
    expect(jobQueueMock.addOrganizeJob).not.toHaveBeenCalled();
  });

  it('skips requests with no client identifiers or names', async () => {
    downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
      id: 'client-1',
      type: 'qbittorrent',
      name: 'qBittorrent',
      enabled: true,
      remotePathMappingEnabled: false,
    });
    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 'req-6',
        audiobook: { id: 'a6', title: 'Book' },
        downloadHistory: [{ downloadClient: 'qbittorrent' }],
      },
    ]);

    const { processRetryFailedImports } = await import('@/lib/processors/retry-failed-imports.processor');
    const result = await processRetryFailedImports({ jobId: 'job-6' });

    expect(result.skipped).toBe(1);
    expect(jobQueueMock.addOrganizeJob).not.toHaveBeenCalled();
  });

  it('tracks skipped requests when organize job fails', async () => {
    const qbtClientMock = {
      clientType: 'qbittorrent',
      protocol: 'torrent',
      getDownload: vi.fn().mockResolvedValue({
        id: 'hash-7',
        name: 'Book',
        downloadPath: '/downloads/Book',
        progress: 1.0,
        status: 'completed',
        size: 0,
        bytesDownloaded: 0,
        downloadSpeed: 0,
        eta: 0,
        category: 'readmeabook',
      }),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(qbtClientMock);
    downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
      id: 'client-1',
      type: 'qbittorrent',
      name: 'qBittorrent',
      enabled: true,
      remotePathMappingEnabled: false,
    });
    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 'req-7',
        audiobook: { id: 'a7', title: 'Book' },
        downloadHistory: [{ torrentHash: 'hash-7', torrentName: 'Book', downloadClient: 'qbittorrent' }],
      },
    ]);
    jobQueueMock.addOrganizeJob.mockRejectedValue(new Error('queue down'));

    const { processRetryFailedImports } = await import('@/lib/processors/retry-failed-imports.processor');
    const result = await processRetryFailedImports({ jobId: 'job-7' });

    expect(result.triggered).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('skips qBittorrent fallbacks when torrent name is missing', async () => {
    const qbtClientMock = {
      clientType: 'qbittorrent',
      protocol: 'torrent',
      getDownload: vi.fn().mockRejectedValue(new Error('not found')),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(qbtClientMock);
    downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
      id: 'client-1',
      type: 'qbittorrent',
      name: 'qBittorrent',
      enabled: true,
      remotePathMappingEnabled: false,
    });
    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 'req-8',
        audiobook: { id: 'a8', title: 'Book' },
        downloadHistory: [{ torrentHash: 'hash-8', downloadClient: 'qbittorrent' }],
      },
    ]);

    const { processRetryFailedImports } = await import('@/lib/processors/retry-failed-imports.processor');
    const result = await processRetryFailedImports({ jobId: 'job-8' });

    expect(result.triggered).toBe(0);
    expect(result.skipped).toBe(1);
    expect(jobQueueMock.addOrganizeJob).not.toHaveBeenCalled();
  });

  it('skips qBittorrent fallbacks when download_dir is not configured', async () => {
    const qbtClientMock = {
      clientType: 'qbittorrent',
      protocol: 'torrent',
      getDownload: vi.fn().mockRejectedValue(new Error('not found')),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(qbtClientMock);
    downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
      id: 'client-1',
      type: 'qbittorrent',
      name: 'qBittorrent',
      enabled: true,
      remotePathMappingEnabled: false,
    });
    configMock.get.mockResolvedValue(null);
    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 'req-9',
        audiobook: { id: 'a9', title: 'Book' },
        downloadHistory: [{ torrentHash: 'hash-9', torrentName: 'Book', downloadClient: 'qbittorrent' }],
      },
    ]);

    const { processRetryFailedImports } = await import('@/lib/processors/retry-failed-imports.processor');
    const result = await processRetryFailedImports({ jobId: 'job-9' });

    expect(result.triggered).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('skips SABnzbd retries when the client throws', async () => {
    const sabClientMock = {
      clientType: 'sabnzbd',
      protocol: 'usenet',
      getDownload: vi.fn().mockRejectedValue(new Error('sab down')),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(sabClientMock);
    downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
      id: 'client-2',
      type: 'sabnzbd',
      name: 'SABnzbd',
      enabled: true,
      remotePathMappingEnabled: false,
    });
    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 'req-10',
        audiobook: { id: 'a10', title: 'Book' },
        downloadHistory: [{ nzbId: 'nzb-10', torrentName: 'Book', downloadClient: 'sabnzbd' }],
      },
    ]);

    const { processRetryFailedImports } = await import('@/lib/processors/retry-failed-imports.processor');
    const result = await processRetryFailedImports({ jobId: 'job-10' });

    expect(result.triggered).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('uses stored downloadPath when client throws', async () => {
    const qbtClientMock = {
      clientType: 'qbittorrent',
      protocol: 'torrent',
      getDownload: vi.fn().mockRejectedValue(new Error('torrent removed')),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(qbtClientMock);
    downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
      id: 'client-1',
      type: 'qbittorrent',
      name: 'qBittorrent',
      enabled: true,
      remotePathMappingEnabled: false,
    });

    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 'req-stored-1',
        audiobook: { id: 'a-stored-1', title: 'Freefall' },
        downloadHistory: [{
          torrentHash: 'hash-stored-1',
          torrentName: 'Freefall: Expeditionary Force Mavericks, Book 2 - Craig Alanson',
          downloadClient: 'qbittorrent',
          downloadPath: '/downloads/Craig Alanson - Freefall Expeditionary Force Mavericks, Book 2',
        }],
      },
    ]);

    const { processRetryFailedImports } = await import('@/lib/processors/retry-failed-imports.processor');
    const result = await processRetryFailedImports({ jobId: 'job-stored-1' });

    expect(result.triggered).toBe(1);
    // Should use stored path, NOT the torrentName-based fallback
    expect(jobQueueMock.addOrganizeJob).toHaveBeenCalledWith(
      'req-stored-1',
      'a-stored-1',
      '/downloads/Craig Alanson - Freefall Expeditionary Force Mavericks, Book 2'
    );
  });

  it('falls back to torrentName when stored downloadPath is null', async () => {
    const qbtClientMock = {
      clientType: 'qbittorrent',
      protocol: 'torrent',
      getDownload: vi.fn().mockRejectedValue(new Error('torrent removed')),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(qbtClientMock);
    downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
      id: 'client-1',
      type: 'qbittorrent',
      name: 'qBittorrent',
      enabled: true,
      remotePathMappingEnabled: false,
    });
    configMock.get.mockResolvedValue('/downloads');

    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 'req-stored-2',
        audiobook: { id: 'a-stored-2', title: 'Book' },
        downloadHistory: [{
          torrentHash: 'hash-stored-2',
          torrentName: 'Book',
          downloadClient: 'qbittorrent',
          downloadPath: null, // Old record without stored path
        }],
      },
    ]);

    const { processRetryFailedImports } = await import('@/lib/processors/retry-failed-imports.processor');
    const result = await processRetryFailedImports({ jobId: 'job-stored-2' });

    expect(result.triggered).toBe(1);
    // Should fall back to torrentName-based path
    expect(jobQueueMock.addOrganizeJob).toHaveBeenCalledWith(
      'req-stored-2',
      'a-stored-2',
      '/downloads/Book'
    );
  });

  it('prefers live client path over stored downloadPath', async () => {
    const qbtClientMock = {
      clientType: 'qbittorrent',
      protocol: 'torrent',
      getDownload: vi.fn().mockResolvedValue({
        id: 'hash-stored-3',
        name: 'Book',
        downloadPath: '/downloads/LivePath',
        progress: 1.0,
        status: 'completed',
        size: 0,
        bytesDownloaded: 0,
        downloadSpeed: 0,
        eta: 0,
        category: 'readmeabook',
      }),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(qbtClientMock);
    downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
      id: 'client-1',
      type: 'qbittorrent',
      name: 'qBittorrent',
      enabled: true,
      remotePathMappingEnabled: false,
    });

    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 'req-stored-3',
        audiobook: { id: 'a-stored-3', title: 'Book' },
        downloadHistory: [{
          torrentHash: 'hash-stored-3',
          torrentName: 'Book',
          downloadClient: 'qbittorrent',
          downloadPath: '/downloads/StoredPath',
        }],
      },
    ]);

    const { processRetryFailedImports } = await import('@/lib/processors/retry-failed-imports.processor');
    const result = await processRetryFailedImports({ jobId: 'job-stored-3' });

    expect(result.triggered).toBe(1);
    // Should use live client path, NOT stored path
    expect(jobQueueMock.addOrganizeJob).toHaveBeenCalledWith(
      'req-stored-3',
      'a-stored-3',
      '/downloads/LivePath'
    );
  });

  it('skips requests without download_dir when no client identifiers exist', async () => {
    downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
      id: 'client-1',
      type: 'qbittorrent',
      name: 'qBittorrent',
      enabled: true,
      remotePathMappingEnabled: false,
    });
    configMock.get.mockResolvedValue(null);
    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 'req-11',
        audiobook: { id: 'a11', title: 'Book' },
        downloadHistory: [{ torrentName: 'Book', downloadClient: 'qbittorrent' }],
      },
    ]);

    const { processRetryFailedImports } = await import('@/lib/processors/retry-failed-imports.processor');
    const result = await processRetryFailedImports({ jobId: 'job-11' });

    expect(result.triggered).toBe(0);
    expect(result.skipped).toBe(1);
  });

  // =========================================================================
  // EBOOK REQUEST TESTS
  // =========================================================================

  it('retries ebook requests with direct download client using stored path', async () => {
    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 'req-ebook-1',
        type: 'ebook',
        audiobook: { id: 'a-ebook-1', title: 'Equal Rites' },
        downloadHistory: [{
          downloadClient: 'direct',
          torrentName: 'Equal Rites - Terry Pratchett.epub',
          downloadPath: '/downloads/Equal Rites - Terry Pratchett.epub',
        }],
      },
    ]);

    const { processRetryFailedImports } = await import('@/lib/processors/retry-failed-imports.processor');
    const result = await processRetryFailedImports({ jobId: 'job-ebook-1' });

    expect(result.triggered).toBe(1);
    expect(result.skipped).toBe(0);
    expect(jobQueueMock.addOrganizeJob).toHaveBeenCalledWith(
      'req-ebook-1',
      'a-ebook-1',
      '/downloads/Equal Rites - Terry Pratchett.epub'
    );
  });

  it('retries ebook requests with direct download using fallback path', async () => {
    configMock.get.mockResolvedValue('/downloads');

    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 'req-ebook-2',
        type: 'ebook',
        audiobook: { id: 'a-ebook-2', title: 'Equal Rites' },
        downloadHistory: [{
          downloadClient: 'direct',
          torrentName: 'Equal Rites - Terry Pratchett.epub',
          downloadPath: null, // No stored path
        }],
      },
    ]);

    const { processRetryFailedImports } = await import('@/lib/processors/retry-failed-imports.processor');
    const result = await processRetryFailedImports({ jobId: 'job-ebook-2' });

    expect(result.triggered).toBe(1);
    expect(jobQueueMock.addOrganizeJob).toHaveBeenCalledWith(
      'req-ebook-2',
      'a-ebook-2',
      '/downloads/Equal Rites - Terry Pratchett.epub'
    );
  });

  it('skips direct ebook requests when no stored path and no download_dir', async () => {
    configMock.get.mockResolvedValue(null);

    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 'req-ebook-3',
        type: 'ebook',
        audiobook: { id: 'a-ebook-3', title: 'Equal Rites' },
        downloadHistory: [{
          downloadClient: 'direct',
          torrentName: 'Equal Rites - Terry Pratchett.epub',
          downloadPath: null,
        }],
      },
    ]);

    const { processRetryFailedImports } = await import('@/lib/processors/retry-failed-imports.processor');
    const result = await processRetryFailedImports({ jobId: 'job-ebook-3' });

    expect(result.triggered).toBe(0);
    expect(result.skipped).toBe(1);
    expect(jobQueueMock.addOrganizeJob).not.toHaveBeenCalled();
  });

  it('retries ebook requests downloaded via indexer (torrent client)', async () => {
    const qbtClientMock = {
      clientType: 'qbittorrent',
      protocol: 'torrent',
      getDownload: vi.fn().mockResolvedValue({
        id: 'hash-ebook-idx',
        name: 'Equal Rites - Terry Pratchett (epub)',
        downloadPath: '/downloads/Equal Rites - Terry Pratchett (epub)',
        progress: 1.0,
        status: 'completed',
        size: 0,
        bytesDownloaded: 0,
        downloadSpeed: 0,
        eta: 0,
        category: 'readmeabook',
      }),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(qbtClientMock);
    downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
      id: 'client-1',
      type: 'qbittorrent',
      name: 'qBittorrent',
      enabled: true,
      remotePathMappingEnabled: false,
    });

    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 'req-ebook-idx',
        type: 'ebook',
        audiobook: { id: 'a-ebook-idx', title: 'Equal Rites' },
        downloadHistory: [{
          torrentHash: 'hash-ebook-idx',
          torrentName: 'Equal Rites - Terry Pratchett (epub)',
          downloadClient: 'qbittorrent',
        }],
      },
    ]);

    const { processRetryFailedImports } = await import('@/lib/processors/retry-failed-imports.processor');
    const result = await processRetryFailedImports({ jobId: 'job-ebook-idx' });

    expect(result.triggered).toBe(1);
    expect(jobQueueMock.addOrganizeJob).toHaveBeenCalledWith(
      'req-ebook-idx',
      'a-ebook-idx',
      '/downloads/Equal Rites - Terry Pratchett (epub)'
    );
  });

  it('processes mixed audiobook and ebook requests in same batch', async () => {
    const qbtClientMock = {
      clientType: 'qbittorrent',
      protocol: 'torrent',
      getDownload: vi.fn().mockResolvedValue({
        id: 'hash-audio',
        name: 'Gideon the Ninth',
        downloadPath: '/downloads/Gideon the Ninth',
        progress: 1.0,
        status: 'completed',
        size: 0,
        bytesDownloaded: 0,
        downloadSpeed: 0,
        eta: 0,
        category: 'readmeabook',
      }),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(qbtClientMock);
    downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
      id: 'client-1',
      type: 'qbittorrent',
      name: 'qBittorrent',
      enabled: true,
      remotePathMappingEnabled: false,
    });

    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 'req-mixed-audio',
        type: 'audiobook',
        audiobook: { id: 'a-mixed-audio', title: 'Gideon the Ninth' },
        downloadHistory: [{
          torrentHash: 'hash-audio',
          torrentName: 'Gideon the Ninth',
          downloadClient: 'qbittorrent',
        }],
      },
      {
        id: 'req-mixed-ebook',
        type: 'ebook',
        audiobook: { id: 'a-mixed-ebook', title: 'Equal Rites' },
        downloadHistory: [{
          downloadClient: 'direct',
          torrentName: 'Equal Rites - Terry Pratchett.epub',
          downloadPath: '/downloads/Equal Rites - Terry Pratchett.epub',
        }],
      },
    ]);

    const { processRetryFailedImports } = await import('@/lib/processors/retry-failed-imports.processor');
    const result = await processRetryFailedImports({ jobId: 'job-mixed' });

    expect(result.triggered).toBe(2);
    expect(result.skipped).toBe(0);
    expect(jobQueueMock.addOrganizeJob).toHaveBeenCalledTimes(2);
    expect(jobQueueMock.addOrganizeJob).toHaveBeenCalledWith(
      'req-mixed-audio',
      'a-mixed-audio',
      '/downloads/Gideon the Ninth'
    );
    expect(jobQueueMock.addOrganizeJob).toHaveBeenCalledWith(
      'req-mixed-ebook',
      'a-mixed-ebook',
      '/downloads/Equal Rites - Terry Pratchett.epub'
    );
  });

  it('skips direct ebook requests with no torrentName and no stored path', async () => {
    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 'req-ebook-noname',
        type: 'ebook',
        audiobook: { id: 'a-ebook-noname', title: 'Book' },
        downloadHistory: [{
          downloadClient: 'direct',
          torrentName: null,
          downloadPath: null,
        }],
      },
    ]);

    const { processRetryFailedImports } = await import('@/lib/processors/retry-failed-imports.processor');
    const result = await processRetryFailedImports({ jobId: 'job-ebook-noname' });

    expect(result.triggered).toBe(0);
    expect(result.skipped).toBe(1);
    expect(jobQueueMock.addOrganizeJob).not.toHaveBeenCalled();
  });
});


