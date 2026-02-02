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
}));
const qbtMock = vi.hoisted(() => ({ getTorrent: vi.fn() }));
const sabnzbdMock = vi.hoisted(() => ({ getNZB: vi.fn() }));

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

vi.mock('@/lib/integrations/qbittorrent.service', () => ({
  getQBittorrentService: () => qbtMock,
}));

vi.mock('@/lib/integrations/sabnzbd.service', () => ({
  getSABnzbdService: () => sabnzbdMock,
}));

describe('processRetryFailedImports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queues organize jobs using download client paths', async () => {
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

    qbtMock.getTorrent.mockResolvedValue({
      save_path: '/downloads',
      name: 'Book',
    });

    const { processRetryFailedImports } = await import('@/lib/processors/retry-failed-imports.processor');
    const result = await processRetryFailedImports({ jobId: 'job-1' });

    expect(result.success).toBe(true);
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
  });

  it('falls back to configured download dir when qBittorrent lookup fails', async () => {
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

    qbtMock.getTorrent.mockRejectedValue(new Error('not found'));

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

    sabnzbdMock.getNZB.mockResolvedValue({ downloadPath: '/remote/nzb/Book' });

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

    sabnzbdMock.getNZB.mockResolvedValue(null);

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
    qbtMock.getTorrent.mockResolvedValue({ save_path: '/downloads', name: 'Book' });
    jobQueueMock.addOrganizeJob.mockRejectedValue(new Error('queue down'));

    const { processRetryFailedImports } = await import('@/lib/processors/retry-failed-imports.processor');
    const result = await processRetryFailedImports({ jobId: 'job-7' });

    expect(result.triggered).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('skips qBittorrent fallbacks when torrent name is missing', async () => {
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
    qbtMock.getTorrent.mockRejectedValue(new Error('not found'));

    const { processRetryFailedImports } = await import('@/lib/processors/retry-failed-imports.processor');
    const result = await processRetryFailedImports({ jobId: 'job-8' });

    expect(result.triggered).toBe(0);
    expect(result.skipped).toBe(1);
    expect(jobQueueMock.addOrganizeJob).not.toHaveBeenCalled();
  });

  it('skips qBittorrent fallbacks when download_dir is not configured', async () => {
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
    qbtMock.getTorrent.mockRejectedValue(new Error('not found'));

    const { processRetryFailedImports } = await import('@/lib/processors/retry-failed-imports.processor');
    const result = await processRetryFailedImports({ jobId: 'job-9' });

    expect(result.triggered).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('skips SABnzbd retries when the client throws', async () => {
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

    sabnzbdMock.getNZB.mockRejectedValue(new Error('sab down'));

    const { processRetryFailedImports } = await import('@/lib/processors/retry-failed-imports.processor');
    const result = await processRetryFailedImports({ jobId: 'job-10' });

    expect(result.triggered).toBe(0);
    expect(result.skipped).toBe(1);
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
});


