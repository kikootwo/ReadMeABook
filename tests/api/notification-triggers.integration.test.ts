/**
 * Component: Notification Trigger Integration Tests
 * Documentation: documentation/backend/services/notifications.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

let authRequest: any;

const prismaMock = createPrismaMock();
const requireAuthMock = vi.hoisted(() => vi.fn());
const requireAdminMock = vi.hoisted(() => vi.fn());
const jobQueueMock = vi.hoisted(() => ({
  addNotificationJob: vi.fn(() => Promise.resolve('job-1')),
  addSearchJob: vi.fn(() => Promise.resolve('job-2')),
}));
const findPlexMatchMock = vi.hoisted(() => vi.fn());
const audibleServiceMock = vi.hoisted(() => ({
  getAudiobookDetails: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: requireAuthMock,
  requireAdmin: requireAdminMock,
}));

vi.mock('@/lib/services/job-queue.service', () => ({
  getJobQueueService: () => jobQueueMock,
}));

vi.mock('@/lib/utils/audiobook-matcher', () => ({
  findPlexMatch: findPlexMatchMock,
}));

vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => audibleServiceMock,
}));

describe('Notification Triggers - Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = { user: { id: 'user-1', role: 'user' }, json: vi.fn(), nextUrl: { searchParams: { get: vi.fn() } } };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
    requireAdminMock.mockImplementation((_req: any, handler: any) => handler());
    findPlexMatchMock.mockResolvedValue(null);
    audibleServiceMock.getAudiobookDetails.mockResolvedValue({
      releaseDate: '2024-01-01',
    });
  });

  describe('POST /api/requests - Request Pending Approval', () => {
    it('sends pending approval notification when user needs approval', async () => {
      const requestBody = {
        audiobook: {
          asin: 'B001',
          title: 'Test Book',
          author: 'Test Author',
        },
      };

      authRequest.json.mockResolvedValue(requestBody);
      authRequest.nextUrl.searchParams.get.mockReturnValue(null);

      prismaMock.request.findFirst.mockResolvedValue(null); // No existing active request
      prismaMock.audiobook.findFirst.mockResolvedValue(null); // No existing audiobook
      prismaMock.audiobook.create.mockResolvedValue({
        id: 'audiobook-1',
        audibleAsin: 'B001',
        title: 'Test Book',
        author: 'Test Author',
        status: 'requested',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // User needs approval (autoApproveRequests = false)
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        role: 'user',
        autoApproveRequests: false,
        plexUsername: 'testuser',
      });

      prismaMock.request.create.mockResolvedValue({
        id: 'req-1',
        userId: 'user-1',
        audiobookId: 'audiobook-1',
        status: 'awaiting_approval',
        progress: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        audiobook: {
          id: 'audiobook-1',
          title: 'Test Book',
          author: 'Test Author',
        },
        user: {
          id: 'user-1',
          plexUsername: 'testuser',
        },
      });

      const { POST } = await import('@/app/api/requests/route');
      const response = await POST(authRequest as any);
      const payload = await response.json();

      expect(payload.success).toBe(true);
      expect(jobQueueMock.addNotificationJob).toHaveBeenCalledWith(
        'request_pending_approval',
        'req-1',
        'Test Book',
        'Test Author',
        'testuser',
        undefined,
        'audiobook'
      );
      expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled(); // No search when awaiting approval
    });
  });

  describe('POST /api/requests - Request Approved (Auto-Approval)', () => {
    it('sends approved notification when user auto-approved with automatic search', async () => {
      const requestBody = {
        audiobook: {
          asin: 'B001',
          title: 'Test Book',
          author: 'Test Author',
        },
      };

      authRequest.json.mockResolvedValue(requestBody);
      authRequest.nextUrl.searchParams.get.mockReturnValue(null); // skipAutoSearch = false

      prismaMock.request.findFirst.mockResolvedValue(null);
      prismaMock.audiobook.findFirst.mockResolvedValue(null);
      prismaMock.audiobook.create.mockResolvedValue({
        id: 'audiobook-1',
        audibleAsin: 'B001',
        title: 'Test Book',
        author: 'Test Author',
        status: 'requested',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // User has auto-approve enabled
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        role: 'user',
        autoApproveRequests: true,
        plexUsername: 'testuser',
      });

      prismaMock.request.create.mockResolvedValue({
        id: 'req-1',
        userId: 'user-1',
        audiobookId: 'audiobook-1',
        status: 'pending',
        progress: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        audiobook: {
          id: 'audiobook-1',
          title: 'Test Book',
          author: 'Test Author',
        },
        user: {
          id: 'user-1',
          plexUsername: 'testuser',
        },
      });

      const { POST } = await import('@/app/api/requests/route');
      await POST(authRequest as any);

      expect(jobQueueMock.addNotificationJob).toHaveBeenCalledWith(
        'request_approved',
        'req-1',
        'Test Book',
        'Test Author',
        'testuser',
        undefined,
        'audiobook'
      );
      expect(jobQueueMock.addSearchJob).toHaveBeenCalled(); // Search triggered
    });

    it('sends approved notification when user auto-approved with interactive search', async () => {
      const requestBody = {
        audiobook: {
          asin: 'B001',
          title: 'Test Book',
          author: 'Test Author',
        },
      };

      authRequest.json.mockResolvedValue(requestBody);
      authRequest.nextUrl.searchParams.get.mockReturnValue('true'); // skipAutoSearch = true

      prismaMock.request.findFirst.mockResolvedValue(null);
      prismaMock.audiobook.findFirst.mockResolvedValue(null);
      prismaMock.audiobook.create.mockResolvedValue({
        id: 'audiobook-1',
        audibleAsin: 'B001',
        title: 'Test Book',
        author: 'Test Author',
        status: 'requested',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // User has auto-approve enabled
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        role: 'user',
        autoApproveRequests: true,
        plexUsername: 'testuser',
      });

      prismaMock.request.create.mockResolvedValue({
        id: 'req-1',
        userId: 'user-1',
        audiobookId: 'audiobook-1',
        status: 'awaiting_search',
        progress: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        audiobook: {
          id: 'audiobook-1',
          title: 'Test Book',
          author: 'Test Author',
        },
        user: {
          id: 'user-1',
          plexUsername: 'testuser',
        },
      });

      const { POST } = await import('@/app/api/requests/route');
      await POST(authRequest as any);

      // Should still send approved notification even with interactive search
      expect(jobQueueMock.addNotificationJob).toHaveBeenCalledWith(
        'request_approved',
        'req-1',
        'Test Book',
        'Test Author',
        'testuser',
        undefined,
        'audiobook'
      );
      expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled(); // No automatic search
    });
  });

  describe('POST /api/admin/requests/[id]/approve - Manual Approval', () => {
    it('sends approved notification when admin manually approves request', async () => {
      const adminRequest = {
        user: { id: 'admin-1', role: 'admin' },
        json: vi.fn().mockResolvedValue({}),
      };
      requireAuthMock.mockImplementation((_req: any, handler: any) => handler(adminRequest));

      prismaMock.request.findUnique.mockResolvedValue({
        id: 'req-1',
        userId: 'user-1',
        audiobookId: 'audiobook-1',
        status: 'awaiting_approval',
        progress: 0,
        audiobook: {
          id: 'audiobook-1',
          audibleAsin: 'B001',
          title: 'Test Book',
          author: 'Test Author',
        },
        user: {
          id: 'user-1',
          plexUsername: 'testuser',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      prismaMock.request.update.mockResolvedValue({
        id: 'req-1',
        userId: 'user-1',
        audiobookId: 'audiobook-1',
        status: 'pending',
        progress: 0,
        audiobook: {
          id: 'audiobook-1',
          title: 'Test Book',
          author: 'Test Author',
        },
        user: {
          id: 'user-1',
          plexUsername: 'testuser',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      prismaMock.request.updateMany.mockResolvedValue({ count: 1 });

      const { POST } = await import('@/app/api/admin/requests/[id]/approve/route');
      const approveRequest = {
        json: vi.fn().mockResolvedValue({ action: 'approve' }),
      };
      await POST(approveRequest as any, { params: Promise.resolve({ id: 'req-1' }) });

      expect(jobQueueMock.addNotificationJob).toHaveBeenCalledWith(
        'request_approved',
        'req-1',
        'Test Book',
        'Test Author',
        'testuser',
        undefined,
        'audiobook'
      );
    });
  });

  describe('Interactive Search - Approval Bypass Prevention', () => {
    it('blocks interactive search when request awaiting approval', async () => {
      authRequest.json.mockResolvedValue({});

      prismaMock.request.findUnique.mockResolvedValue({
        id: 'req-1',
        userId: 'user-1',
        audiobookId: 'audiobook-1',
        status: 'awaiting_approval', // Awaiting approval
        progress: 0,
        audiobook: {
          id: 'audiobook-1',
          title: 'Test Book',
          author: 'Test Author',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { POST } = await import('@/app/api/requests/[id]/interactive-search/route');
      const response = await POST(authRequest as any, { params: Promise.resolve({ id: 'req-1' }) });
      const payload = await response.json();

      expect(response.status).toBe(403);
      expect(payload.error).toBe('AwaitingApproval');
    });

    it('blocks torrent selection when request awaiting approval', async () => {
      authRequest.json.mockResolvedValue({
        torrent: {
          title: 'Test Torrent',
          downloadUrl: 'magnet:?xt=...',
        },
      });

      prismaMock.request.findUnique.mockResolvedValue({
        id: 'req-1',
        userId: 'user-1',
        audiobookId: 'audiobook-1',
        status: 'awaiting_approval', // Awaiting approval
        progress: 0,
        audiobook: {
          id: 'audiobook-1',
          title: 'Test Book',
          author: 'Test Author',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { POST } = await import('@/app/api/requests/[id]/select-torrent/route');
      const response = await POST(authRequest as any, { params: Promise.resolve({ id: 'req-1' }) });
      const payload = await response.json();

      expect(response.status).toBe(403);
      expect(payload.error).toBe('AwaitingApproval');
    });
  });
});
