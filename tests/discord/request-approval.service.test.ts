/**
 * Component: Request Approval Service Tests
 * Documentation: documentation/admin-features/request-approval.md
 *
 * Verifies the extracted processRequestApproval() preserves the original route behavior (status
 * guards, search-job triggering, deny path) now shared by the Web UI and the Discord bot.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const jobQueueMock = vi.hoisted(() => ({
  addSearchJob: vi.fn(() => Promise.resolve()),
  addSearchEbookJob: vi.fn(() => Promise.resolve()),
  addDownloadJob: vi.fn(() => Promise.resolve()),
  addStartDirectDownloadJob: vi.fn(() => Promise.resolve()),
  addNotificationJob: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/job-queue.service', () => ({
  getJobQueueService: () => jobQueueMock,
}));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: {
    create: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

// Imported dynamically inside each test to avoid the mock-hoisting TDZ on prismaMock.
const loadService = () => import('@/lib/services/request-approval.service');

const baseRequest = {
  id: 'req-1',
  userId: 'user-1',
  type: 'audiobook',
  status: 'awaiting_approval',
  selectedTorrent: null,
  audiobook: { id: 'ab-1', title: 'The Hobbit', author: 'Tolkien', audibleAsin: 'B000XXXXXX' },
  user: { id: 'user-1', plexUsername: 'alice' },
};

describe('processRequestApproval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns not_found when the request does not exist', async () => {
    prismaMock.request.findUnique.mockResolvedValue(null);
    const { processRequestApproval } = await loadService();
    const result = await processRequestApproval({ requestId: 'missing', action: 'approve', adminUserId: 'admin-1' });
    expect(result).toEqual({ success: false, reason: 'not_found', message: 'Request not found' });
  });

  it('returns invalid_status when the request is not awaiting approval', async () => {
    prismaMock.request.findUnique.mockResolvedValue({ ...baseRequest, status: 'downloading' });
    const { processRequestApproval } = await loadService();
    const result = await processRequestApproval({ requestId: 'req-1', action: 'approve', adminUserId: 'admin-1' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('invalid_status');
      expect(result.currentStatus).toBe('downloading');
    }
  });

  it('approves with automatic search for an audiobook (no pre-selected torrent)', async () => {
    prismaMock.request.findUnique.mockResolvedValue(baseRequest);
    prismaMock.request.update.mockResolvedValue({
      ...baseRequest,
      status: 'pending',
    });

    const { processRequestApproval } = await loadService();
    const result = await processRequestApproval({ requestId: 'req-1', action: 'approve', adminUserId: 'admin-1' });

    expect(result.success).toBe(true);
    expect(prismaMock.request.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'req-1' }, data: { status: 'pending' } })
    );
    expect(jobQueueMock.addSearchJob).toHaveBeenCalledTimes(1);
    expect(jobQueueMock.addSearchEbookJob).not.toHaveBeenCalled();
    expect(jobQueueMock.addNotificationJob).toHaveBeenCalledWith(
      'request_approved',
      'req-1',
      'The Hobbit',
      'Tolkien',
      'alice'
    );
  });

  it('approves an ebook with the ebook search job', async () => {
    prismaMock.request.findUnique.mockResolvedValue({ ...baseRequest, type: 'ebook' });
    prismaMock.request.update.mockResolvedValue({ ...baseRequest, type: 'ebook', status: 'pending' });

    const { processRequestApproval } = await loadService();
    const result = await processRequestApproval({ requestId: 'req-1', action: 'approve', adminUserId: 'admin-1' });

    expect(result.success).toBe(true);
    expect(jobQueueMock.addSearchEbookJob).toHaveBeenCalledTimes(1);
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
  });

  it('downloads directly when a torrent is pre-selected', async () => {
    prismaMock.request.findUnique.mockResolvedValue({
      ...baseRequest,
      selectedTorrent: { source: 'prowlarr', title: 'pick' },
    });
    prismaMock.request.update.mockResolvedValue({ ...baseRequest, status: 'downloading' });

    const { processRequestApproval } = await loadService();
    const result = await processRequestApproval({ requestId: 'req-1', action: 'approve', adminUserId: 'admin-1' });

    expect(result.success).toBe(true);
    expect(jobQueueMock.addDownloadJob).toHaveBeenCalledTimes(1);
    expect(prismaMock.request.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'downloading' }) })
    );
  });

  it('denies a request without triggering jobs or notifications', async () => {
    prismaMock.request.findUnique.mockResolvedValue(baseRequest);
    prismaMock.request.update.mockResolvedValue({ ...baseRequest, status: 'denied' });

    const { processRequestApproval } = await loadService();
    const result = await processRequestApproval({ requestId: 'req-1', action: 'deny', adminUserId: 'admin-1' });

    expect(result.success).toBe(true);
    expect(result).toMatchObject({ message: 'Request denied' });
    expect(prismaMock.request.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'denied' } })
    );
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
    expect(jobQueueMock.addNotificationJob).not.toHaveBeenCalled();
  });
});
