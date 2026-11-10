/**
 * Component: Monitor Download, a late progress poll on a processing request (#216)
 * Documentation: documentation/backend/services/jobs.md
 *
 * A processing request below 100 reads "Merging chapters N%", so only the merge may
 * write a percent there. The monitor's progress write is filtered to `downloading`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { createJobQueueMock } from '../helpers/job-queue';
import { fakeRequestRow } from '../helpers/request-row-fake';

const prismaMock = createPrismaMock();
const jobQueueMock = createJobQueueMock();
const downloadClientManagerMock = vi.hoisted(() => ({
  getClientForProtocol: vi.fn(),
  getClientServiceForProtocol: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => ({ getMany: vi.fn() }) }));
vi.mock('@/lib/services/download-client-manager.service', () => ({
  getDownloadClientManager: () => downloadClientManagerMock,
}));

const clientAt = (progress: number) => ({
  clientType: 'sabnzbd',
  protocol: 'usenet',
  getDownload: vi.fn().mockResolvedValue({
    id: 'nzb-1',
    name: 'Book',
    size: 1000,
    bytesDownloaded: progress * 1000,
    progress,
    status: 'downloading',
    downloadSpeed: 5000,
    eta: 10,
    category: 'readmeabook',
  }),
});

const runMonitor = async () => {
  const { processMonitorDownload } = await import('@/lib/processors/monitor-download.processor');
  return processMonitorDownload({
    requestId: 'req-1',
    downloadHistoryId: 'dh-1',
    downloadClientId: 'nzb-1',
    downloadClient: 'sabnzbd',
    jobId: 'job-1',
  });
};

describe('processMonitorDownload: progress write (#216)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.request.findUnique.mockResolvedValue({ id: 'req-1', status: 'downloading', deletedAt: null });
    prismaMock.downloadHistory.updateMany.mockResolvedValue({ count: 1 });
  });

  it('writes the percent while the request is downloading', async () => {
    const fake = fakeRequestRow(prismaMock.request, { id: 'req-1', status: 'downloading', progress: 10, deletedAt: null });
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(clientAt(0.37));

    await expect(runMonitor()).resolves.toMatchObject({ completed: false, progress: 37 });

    expect(fake.row.progress).toBe(37);
  });

  it('a late poll on a request that has moved on to processing changes nothing', async () => {
    // An older monitor chain polls after the newer download handed the request to the organizer
    const fake = fakeRequestRow(prismaMock.request, { id: 'req-1', status: 'processing', progress: 100, deletedAt: null });
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(clientAt(0.37));

    await runMonitor();

    expect(fake.row).toMatchObject({ status: 'processing', progress: 100 });
  });
});
