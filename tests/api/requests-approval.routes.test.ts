/**
 * Component: Request Approval API Route Tests
 * Documentation: documentation/admin-features/request-approval.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

let authRequest: any;

const requireAuthMock = vi.hoisted(() => vi.fn());
const requireAdminMock = vi.hoisted(() => vi.fn());
const prismaMock = createPrismaMock();
const jobQueueMock = vi.hoisted(() => ({
  addSearchJob: vi.fn(),
  addNotificationJob: vi.fn(() => Promise.resolve()),
  addDownloadJob: vi.fn(),
}));
const findPlexMatchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: requireAuthMock,
  requireAdmin: requireAdminMock,
}));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/services/job-queue.service', () => ({
  getJobQueueService: () => jobQueueMock,
}));

vi.mock('@/lib/utils/audiobook-matcher', () => ({
  findPlexMatch: findPlexMatchMock,
}));

vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => ({
    getAudiobookDetails: vi.fn().mockResolvedValue(null),
  }),
}));

describe('Request Approval Workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = {
      user: { id: 'user-1', sub: 'user-1', role: 'user' },
      nextUrl: new URL('http://localhost/api/requests'),
      json: vi.fn(),
    };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
    requireAdminMock.mockImplementation((_req: any, handler: any) => handler());
  });

  describe('1. Request Creation with Approval Logic', () => {
    beforeEach(() => {
      // Setup common mocks for request creation
      prismaMock.request.findFirst.mockResolvedValue(null);
      findPlexMatchMock.mockResolvedValue(null);
      prismaMock.audiobook.findFirst.mockResolvedValue(null);
      prismaMock.audiobook.create.mockResolvedValue({
        id: 'ab-1',
        title: 'Test Book',
        author: 'Test Author',
        audibleAsin: 'ASIN-1',
      });
    });

    it('Admin user creates request → should auto-approve (status: pending)', async () => {
      authRequest.user = { id: 'admin-1', sub: 'admin-1', role: 'admin' };
      authRequest.json.mockResolvedValue({
        audiobook: { asin: 'ASIN-1', title: 'Test Book', author: 'Test Author' },
      });

      prismaMock.user.findUnique.mockResolvedValue({
        id: 'admin-1',
        role: 'admin',
        autoApproveRequests: null,
      } as any);

      prismaMock.request.create.mockResolvedValue({
        id: 'req-1',
        status: 'pending',
        userId: 'admin-1',
        audiobook: { id: 'ab-1', title: 'Test Book', author: 'Test Author', audibleAsin: 'ASIN-1' },
        user: { id: 'admin-1', plexUsername: 'admin' },
      } as any);

      const { POST } = await import('@/app/api/requests/route');
      const response = await POST({} as any);
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(payload.success).toBe(true);
      expect(prismaMock.request.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'pending' }),
        })
      );
      expect(jobQueueMock.addSearchJob).toHaveBeenCalledWith('req-1', expect.any(Object));
    });

    it('User with autoApproveRequests=true → should auto-approve (status: pending)', async () => {
      authRequest.json.mockResolvedValue({
        audiobook: { asin: 'ASIN-2', title: 'Test Book', author: 'Test Author' },
      });

      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        role: 'user',
        autoApproveRequests: true,
      } as any);

      prismaMock.request.create.mockResolvedValue({
        id: 'req-2',
        status: 'pending',
        userId: 'user-1',
        audiobook: { id: 'ab-1', title: 'Test Book', author: 'Test Author', audibleAsin: 'ASIN-2' },
        user: { id: 'user-1', plexUsername: 'testuser' },
      } as any);

      const { POST } = await import('@/app/api/requests/route');
      const response = await POST({} as any);
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(payload.success).toBe(true);
      expect(prismaMock.request.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'pending' }),
        })
      );
      expect(jobQueueMock.addSearchJob).toHaveBeenCalledWith('req-2', expect.any(Object));
    });

    it('User with autoApproveRequests=false → should require approval (status: awaiting_approval)', async () => {
      authRequest.json.mockResolvedValue({
        audiobook: { asin: 'ASIN-3', title: 'Test Book', author: 'Test Author' },
      });

      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        role: 'user',
        autoApproveRequests: false,
      } as any);

      prismaMock.request.create.mockResolvedValue({
        id: 'req-3',
        status: 'awaiting_approval',
        userId: 'user-1',
        audiobook: { id: 'ab-1', title: 'Test Book', author: 'Test Author', audibleAsin: 'ASIN-3' },
        user: { id: 'user-1', plexUsername: 'testuser' },
      } as any);

      const { POST } = await import('@/app/api/requests/route');
      const response = await POST({} as any);
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(payload.success).toBe(true);
      expect(prismaMock.request.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'awaiting_approval' }),
        })
      );
    });

    it('User with autoApproveRequests=null + global=true → should auto-approve (status: pending)', async () => {
      authRequest.json.mockResolvedValue({
        audiobook: { asin: 'ASIN-4', title: 'Test Book', author: 'Test Author' },
      });

      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        role: 'user',
        autoApproveRequests: null,
      } as any);

      prismaMock.configuration.findUnique.mockResolvedValue({
        key: 'auto_approve_requests',
        value: 'true',
      } as any);

      prismaMock.request.create.mockResolvedValue({
        id: 'req-4',
        status: 'pending',
        userId: 'user-1',
        audiobook: { id: 'ab-1', title: 'Test Book', author: 'Test Author', audibleAsin: 'ASIN-4' },
        user: { id: 'user-1', plexUsername: 'testuser' },
      } as any);

      const { POST } = await import('@/app/api/requests/route');
      const response = await POST({} as any);
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(payload.success).toBe(true);
      expect(prismaMock.request.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'pending' }),
        })
      );
      expect(jobQueueMock.addSearchJob).toHaveBeenCalledWith('req-4', expect.any(Object));
    });

    it('User with autoApproveRequests=null + global=false → should require approval (status: awaiting_approval)', async () => {
      authRequest.json.mockResolvedValue({
        audiobook: { asin: 'ASIN-5', title: 'Test Book', author: 'Test Author' },
      });

      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        role: 'user',
        autoApproveRequests: null,
      } as any);

      prismaMock.configuration.findUnique.mockResolvedValue({
        key: 'auto_approve_requests',
        value: 'false',
      } as any);

      prismaMock.request.create.mockResolvedValue({
        id: 'req-5',
        status: 'awaiting_approval',
        userId: 'user-1',
        audiobook: { id: 'ab-1', title: 'Test Book', author: 'Test Author', audibleAsin: 'ASIN-5' },
        user: { id: 'user-1', plexUsername: 'testuser' },
      } as any);

      const { POST } = await import('@/app/api/requests/route');
      const response = await POST({} as any);
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(payload.success).toBe(true);
      expect(prismaMock.request.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'awaiting_approval' }),
        })
      );
    });

    it('Request requiring approval should NOT trigger search job', async () => {
      authRequest.json.mockResolvedValue({
        audiobook: { asin: 'ASIN-6', title: 'Test Book', author: 'Test Author' },
      });

      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        role: 'user',
        autoApproveRequests: false,
      } as any);

      prismaMock.request.create.mockResolvedValue({
        id: 'req-6',
        status: 'awaiting_approval',
        userId: 'user-1',
        audiobook: { id: 'ab-1', title: 'Test Book', author: 'Test Author', audibleAsin: 'ASIN-6' },
        user: { id: 'user-1', plexUsername: 'testuser' },
      } as any);

      const { POST } = await import('@/app/api/requests/route');
      await POST({} as any);

      expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
    });

    it('Auto-approved request SHOULD trigger search job', async () => {
      authRequest.json.mockResolvedValue({
        audiobook: { asin: 'ASIN-7', title: 'Test Book', author: 'Test Author' },
      });

      // Mock first request.findFirst call (check for existing requests by ASIN)
      prismaMock.request.findFirst.mockResolvedValueOnce(null);
      // Mock findPlexMatch
      findPlexMatchMock.mockResolvedValueOnce(null);
      // Mock audiobook.findFirst
      prismaMock.audiobook.findFirst.mockResolvedValueOnce(null);

      prismaMock.audiobook.create.mockResolvedValueOnce({
        id: 'ab-7',
        title: 'Test Book',
        author: 'Test Author',
        audibleAsin: 'ASIN-7',
      } as any);

      // Mock second request.findFirst call (check for user's existing request)
      prismaMock.request.findFirst.mockResolvedValueOnce(null);

      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        role: 'user',
        autoApproveRequests: true,
        plexUsername: 'testuser',
      } as any);

      prismaMock.request.create.mockResolvedValue({
        id: 'req-7',
        status: 'pending',
        userId: 'user-1',
        audiobook: { id: 'ab-7', title: 'Test Book', author: 'Test Author', audibleAsin: 'ASIN-7' },
        user: { id: 'user-1', plexUsername: 'testuser' },
      } as any);

      const { POST } = await import('@/app/api/requests/route');
      await POST({} as any);

      expect(jobQueueMock.addSearchJob).toHaveBeenCalledWith('req-7', {
        id: 'ab-7',
        title: 'Test Book',
        author: 'Test Author',
        asin: 'ASIN-7',
      });
    });

    it('Request with skipAutoSearch=true should have status awaiting_search and not trigger job', async () => {
      authRequest.nextUrl = new URL('http://localhost/api/requests?skipAutoSearch=true');
      authRequest.json.mockResolvedValue({
        audiobook: { asin: 'ASIN-8', title: 'Test Book', author: 'Test Author' },
      });

      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        role: 'user',
        autoApproveRequests: true,
      } as any);

      prismaMock.request.create.mockResolvedValue({
        id: 'req-8',
        status: 'awaiting_search',
        userId: 'user-1',
        audiobook: { id: 'ab-1', title: 'Test Book', author: 'Test Author', audibleAsin: 'ASIN-8' },
        user: { id: 'user-1', plexUsername: 'testuser' },
      } as any);

      const { POST } = await import('@/app/api/requests/route');
      await POST({} as any);

      expect(prismaMock.request.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'awaiting_search' }),
        })
      );
      expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
    });
  });

  describe('2. Global Auto-Approve Settings API', () => {
    beforeEach(() => {
      authRequest.user = { id: 'admin-1', sub: 'admin-1', role: 'admin' };
    });

    it('GET /api/admin/settings/auto-approve returns current setting', async () => {
      prismaMock.configuration.findUnique.mockResolvedValue({
        key: 'auto_approve_requests',
        value: 'true',
      } as any);

      const { GET } = await import('@/app/api/admin/settings/auto-approve/route');
      const response = await GET({} as any);
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.autoApproveRequests).toBe(true);
      expect(prismaMock.configuration.findUnique).toHaveBeenCalledWith({
        where: { key: 'auto_approve_requests' },
      });
    });

    it('PATCH /api/admin/settings/auto-approve updates setting', async () => {
      const mockRequest = {
        json: vi.fn().mockResolvedValue({ autoApproveRequests: false }),
      };

      prismaMock.configuration.upsert.mockResolvedValue({
        key: 'auto_approve_requests',
        value: 'false',
      } as any);

      const { PATCH } = await import('@/app/api/admin/settings/auto-approve/route');
      const response = await PATCH(mockRequest as any);
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.autoApproveRequests).toBe(false);
      expect(prismaMock.configuration.upsert).toHaveBeenCalledWith({
        where: { key: 'auto_approve_requests' },
        create: {
          key: 'auto_approve_requests',
          value: 'false',
        },
        update: {
          value: 'false',
        },
      });
    });

    it('Non-admin user cannot access endpoint (403)', async () => {
      authRequest.user = { id: 'user-1', sub: 'user-1', role: 'user' };
      requireAdminMock.mockImplementation((_req: any, _handler: any) => {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
        );
      });

      const { GET } = await import('@/app/api/admin/settings/auto-approve/route');
      const response = await GET({} as any);
      const payload = await response.json();

      expect(response.status).toBe(403);
      expect(payload.error).toBeDefined();
    });

    it('Missing/invalid values handled properly', async () => {
      const mockRequest = {
        json: vi.fn().mockResolvedValue({ autoApproveRequests: 'invalid' }),
      };

      const { PATCH } = await import('@/app/api/admin/settings/auto-approve/route');
      const response = await PATCH(mockRequest as any);
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload.error).toContain('must be a boolean');
    });
  });

  describe('3. Per-User Auto-Approve Settings', () => {
    beforeEach(() => {
      authRequest.user = { id: 'admin-1', sub: 'admin-1', role: 'admin' };
    });

    it('PUT /api/admin/users/[id] can update autoApproveRequests', async () => {
      const mockRequest = {
        json: vi.fn().mockResolvedValue({
          role: 'user',
          autoApproveRequests: true,
        }),
      };

      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        isSetupAdmin: false,
        authProvider: 'plex',
        plexUsername: 'testuser',
        deletedAt: null,
      } as any);

      prismaMock.user.update.mockResolvedValue({
        id: 'user-1',
        plexUsername: 'testuser',
        role: 'user',
        autoApproveRequests: true,
      } as any);

      const { PUT } = await import('@/app/api/admin/users/[id]/route');
      const response = await PUT(mockRequest as any, { params: Promise.resolve({ id: 'user-1' }) });
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.user.autoApproveRequests).toBe(true);
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { role: 'user', autoApproveRequests: true },
        select: {
          id: true,
          plexUsername: true,
          role: true,
          autoApproveRequests: true,
          interactiveSearchAccess: true,
          downloadAccess: true,
        },
      });
    });

    it('Cannot set admin user autoApproveRequests to false (validation error)', async () => {
      const mockRequest = {
        json: vi.fn().mockResolvedValue({
          role: 'admin',
          autoApproveRequests: false,
        }),
      };

      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-2',
        isSetupAdmin: false,
        authProvider: 'plex',
        plexUsername: 'adminuser',
        deletedAt: null,
      } as any);

      const { PUT } = await import('@/app/api/admin/users/[id]/route');
      const response = await PUT(mockRequest as any, { params: Promise.resolve({ id: 'user-2' }) });
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload.error).toContain('Admins must always auto-approve');
    });

    it('Non-admin user cannot update user settings (403)', async () => {
      authRequest.user = { id: 'user-1', sub: 'user-1', role: 'user' };
      requireAdminMock.mockImplementation((_req: any, _handler: any) => {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
        );
      });

      const mockRequest = {
        json: vi.fn().mockResolvedValue({
          role: 'user',
          autoApproveRequests: true,
        }),
      };

      const { PUT } = await import('@/app/api/admin/users/[id]/route');
      const response = await PUT(mockRequest as any, { params: Promise.resolve({ id: 'user-2' }) });
      const payload = await response.json();

      expect(response.status).toBe(403);
      expect(payload.error).toBeDefined();
    });
  });

  describe('4. Request Approval API', () => {
    beforeEach(() => {
      authRequest.user = { id: 'admin-1', sub: 'admin-1', role: 'admin' };
    });

    it('POST /api/admin/requests/[id]/approve with action=approve changes status to pending and triggers search job', async () => {
      const mockRequest = {
        json: vi.fn().mockResolvedValue({ action: 'approve' }),
      };

      prismaMock.request.findUnique.mockResolvedValue({
        id: 'req-1',
        status: 'awaiting_approval',
        selectedTorrent: null,
        userId: 'user-1',
        audiobook: { id: 'ab-1', title: 'Test Book', author: 'Test Author', audibleAsin: 'ASIN-1' },
        user: { id: 'user-1', plexUsername: 'testuser' },
      } as any);

      prismaMock.request.update.mockResolvedValue({
        id: 'req-1',
        status: 'pending',
        userId: 'user-1',
        audiobook: { id: 'ab-1', title: 'Test Book', author: 'Test Author', audibleAsin: 'ASIN-1' },
        user: { id: 'user-1', plexUsername: 'testuser' },
      } as any);

      const { POST } = await import('@/app/api/admin/requests/[id]/approve/route');
      const response = await POST(mockRequest as any, { params: Promise.resolve({ id: 'req-1' }) });
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.success).toBe(true);
      expect(payload.message).toContain('approved');
      expect(prismaMock.request.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: { status: 'pending' },
        include: {
          audiobook: true,
          user: {
            select: {
              id: true,
              plexUsername: true,
            },
          },
        },
      });
      expect(jobQueueMock.addSearchJob).toHaveBeenCalledWith('req-1', {
        id: 'ab-1',
        title: 'Test Book',
        author: 'Test Author',
        asin: 'ASIN-1',
      });
    });

    it('POST /api/admin/requests/[id]/approve with action=deny changes status to denied and does NOT trigger search job', async () => {
      const mockRequest = {
        json: vi.fn().mockResolvedValue({ action: 'deny' }),
      };

      prismaMock.request.findUnique.mockResolvedValue({
        id: 'req-2',
        status: 'awaiting_approval',
        selectedTorrent: null,
        userId: 'user-1',
        audiobook: { id: 'ab-2', title: 'Test Book 2', author: 'Test Author 2', audibleAsin: 'ASIN-2' },
        user: { id: 'user-1', plexUsername: 'testuser' },
      } as any);

      prismaMock.request.update.mockResolvedValue({
        id: 'req-2',
        status: 'denied',
        userId: 'user-1',
        audiobook: { id: 'ab-2', title: 'Test Book 2', author: 'Test Author 2', audibleAsin: 'ASIN-2' },
        user: { id: 'user-1', plexUsername: 'testuser' },
      } as any);

      const { POST } = await import('@/app/api/admin/requests/[id]/approve/route');
      const response = await POST(mockRequest as any, { params: Promise.resolve({ id: 'req-2' }) });
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.success).toBe(true);
      expect(payload.message).toContain('denied');
      expect(prismaMock.request.update).toHaveBeenCalledWith({
        where: { id: 'req-2' },
        data: { status: 'denied' },
        include: {
          audiobook: true,
          user: {
            select: {
              id: true,
              plexUsername: true,
            },
          },
        },
      });
      expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
    });

    it('Cannot approve request that is not in awaiting_approval status (400)', async () => {
      const mockRequest = {
        json: vi.fn().mockResolvedValue({ action: 'approve' }),
      };

      prismaMock.request.findUnique.mockResolvedValue({
        id: 'req-3',
        status: 'pending',
        userId: 'user-1',
        audiobook: { id: 'ab-3', title: 'Test Book 3', author: 'Test Author 3', audibleAsin: 'ASIN-3' },
        user: { id: 'user-1', plexUsername: 'testuser' },
      } as any);

      const { POST } = await import('@/app/api/admin/requests/[id]/approve/route');
      const response = await POST(mockRequest as any, { params: Promise.resolve({ id: 'req-3' }) });
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload.error).toBe('InvalidStatus');
      expect(payload.message).toContain('not awaiting approval');
      expect(payload.currentStatus).toBe('pending');
    });

    it('Cannot approve non-existent request (404)', async () => {
      const mockRequest = {
        json: vi.fn().mockResolvedValue({ action: 'approve' }),
      };

      prismaMock.request.findUnique.mockResolvedValue(null);

      const { POST } = await import('@/app/api/admin/requests/[id]/approve/route');
      const response = await POST(mockRequest as any, { params: Promise.resolve({ id: 'non-existent' }) });
      const payload = await response.json();

      expect(response.status).toBe(404);
      expect(payload.error).toBe('NotFound');
      expect(payload.message).toContain('not found');
    });

    it('Non-admin user cannot approve requests (403)', async () => {
      authRequest.user = { id: 'user-1', sub: 'user-1', role: 'user' };
      requireAdminMock.mockImplementation((_req: any, _handler: any) => {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
        );
      });

      const mockRequest = {
        json: vi.fn().mockResolvedValue({ action: 'approve' }),
      };

      const { POST } = await import('@/app/api/admin/requests/[id]/approve/route');
      const response = await POST(mockRequest as any, { params: Promise.resolve({ id: 'req-1' }) });
      const payload = await response.json();

      expect(response.status).toBe(403);
      expect(payload.error).toBeDefined();
    });

    it('Missing action parameter returns error (400)', async () => {
      const mockRequest = {
        json: vi.fn().mockResolvedValue({}),
      };

      prismaMock.request.findUnique.mockResolvedValue({
        id: 'req-4',
        status: 'awaiting_approval',
        userId: 'user-1',
        audiobook: { id: 'ab-4', title: 'Test Book 4', author: 'Test Author 4', audibleAsin: 'ASIN-4' },
        user: { id: 'user-1', plexUsername: 'testuser' },
      } as any);

      const { POST } = await import('@/app/api/admin/requests/[id]/approve/route');
      const response = await POST(mockRequest as any, { params: Promise.resolve({ id: 'req-4' }) });
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload.error).toBe('ValidationError');
      expect(payload.message).toContain('approve');
    });

    it('Invalid action parameter returns error (400)', async () => {
      const mockRequest = {
        json: vi.fn().mockResolvedValue({ action: 'invalid' }),
      };

      prismaMock.request.findUnique.mockResolvedValue({
        id: 'req-5',
        status: 'awaiting_approval',
        userId: 'user-1',
        audiobook: { id: 'ab-5', title: 'Test Book 5', author: 'Test Author 5', audibleAsin: 'ASIN-5' },
        user: { id: 'user-1', plexUsername: 'testuser' },
      } as any);

      const { POST } = await import('@/app/api/admin/requests/[id]/approve/route');
      const response = await POST(mockRequest as any, { params: Promise.resolve({ id: 'req-5' }) });
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload.error).toBe('ValidationError');
      expect(payload.message).toContain('approve');
    });
  });

  describe('5. Pending Approval Requests API', () => {
    beforeEach(() => {
      authRequest.user = { id: 'admin-1', sub: 'admin-1', role: 'admin' };
    });

    it('GET /api/admin/requests/pending-approval returns only awaiting_approval requests', async () => {
      prismaMock.request.findMany.mockResolvedValue([
        {
          id: 'req-1',
          status: 'awaiting_approval',
          userId: 'user-1',
          audiobook: { id: 'ab-1', title: 'Test Book 1', author: 'Test Author 1' },
          user: { id: 'user-1', plexUsername: 'user1', avatarUrl: null },
          createdAt: new Date(),
        },
        {
          id: 'req-2',
          status: 'awaiting_approval',
          userId: 'user-2',
          audiobook: { id: 'ab-2', title: 'Test Book 2', author: 'Test Author 2' },
          user: { id: 'user-2', plexUsername: 'user2', avatarUrl: null },
          createdAt: new Date(),
        },
      ] as any);

      const { GET } = await import('@/app/api/admin/requests/pending-approval/route');
      const response = await GET({} as any);
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.success).toBe(true);
      expect(payload.requests).toHaveLength(2);
      expect(payload.count).toBe(2);
      expect(prismaMock.request.findMany).toHaveBeenCalledWith({
        where: {
          status: 'awaiting_approval',
          deletedAt: null,
        },
        include: {
          audiobook: true,
          user: {
            select: {
              id: true,
              plexUsername: true,
              avatarUrl: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('Returns requests with audiobook and user details', async () => {
      const mockDate = new Date('2024-01-01');
      prismaMock.request.findMany.mockResolvedValue([
        {
          id: 'req-1',
          status: 'awaiting_approval',
          userId: 'user-1',
          audiobook: {
            id: 'ab-1',
            title: 'Test Book',
            author: 'Test Author',
            audibleAsin: 'ASIN-1',
            coverArtUrl: 'https://example.com/cover.jpg',
          },
          user: {
            id: 'user-1',
            plexUsername: 'testuser',
            avatarUrl: 'https://example.com/avatar.jpg',
          },
          createdAt: mockDate,
        },
      ] as any);

      const { GET } = await import('@/app/api/admin/requests/pending-approval/route');
      const response = await GET({} as any);
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.requests[0]).toMatchObject({
        id: 'req-1',
        status: 'awaiting_approval',
        audiobook: {
          id: 'ab-1',
          title: 'Test Book',
          author: 'Test Author',
        },
        user: {
          id: 'user-1',
          plexUsername: 'testuser',
        },
      });
    });

    it('Non-admin user cannot access endpoint (403)', async () => {
      authRequest.user = { id: 'user-1', sub: 'user-1', role: 'user' };
      requireAdminMock.mockImplementation((_req: any, _handler: any) => {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
        );
      });

      const { GET } = await import('@/app/api/admin/requests/pending-approval/route');
      const response = await GET({} as any);
      const payload = await response.json();

      expect(response.status).toBe(403);
      expect(payload.error).toBeDefined();
    });
  });
});
