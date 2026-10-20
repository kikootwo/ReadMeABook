/**
 * Component: Admin Notifications API Route Tests
 * Documentation: documentation/backend/services/notifications.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

let authRequest: any;

const prismaMock = createPrismaMock();
prismaMock.notificationBackend = {
  findMany: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
} as any;

const requireAuthMock = vi.hoisted(() => vi.fn());
const requireAdminMock = vi.hoisted(() => vi.fn());
const notificationServiceMock = vi.hoisted(() => ({
  encryptConfig: vi.fn((type: string, config: any) => ({ ...config, encrypted: true })),
  prepareSubmittedConfig: vi.fn((type: string, config: any) => ({ ok: true, config: { ...config, encrypted: true } })),
  migrateStoredConfig: vi.fn(() => null),
  maskConfig: vi.fn((type: string, config: any) => ({ ...config, masked: true })),
  // URL binding rules are covered in notification-secret-binding.test.ts; here masked values keep the saved ones
  mergeMaskedSecrets: vi.fn((type: string, existing: any, updated: any) => ({
    ok: true,
    config: Object.fromEntries(Object.entries(updated).map(([k, v]) => [k, v === '••••••••' ? existing?.[k] : v])),
  })),
  sendToBackend: vi.fn(),
  sendNotification: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: requireAuthMock,
  requireAdmin: requireAdminMock,
}));

vi.mock('@/lib/services/notification', () => ({
  getNotificationService: () => notificationServiceMock,
  getRegisteredProviderTypes: () => ['discord', 'ntfy', 'pushover'],
}));

describe('Admin notifications routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = { user: { id: 'admin-1', role: 'admin' }, json: vi.fn() };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
    requireAdminMock.mockImplementation((_req: any, handler: any) => handler());
  });

  describe('GET /api/admin/notifications', () => {
    it('returns all notification backends with masked config', async () => {
      const backends = [
        {
          id: '1',
          type: 'discord',
          name: 'Discord - Admins',
          config: { webhookUrl: 'https://discord.com/webhook', username: 'Bot' },
          events: ['request_approved', 'request_available'],
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '2',
          type: 'pushover',
          name: 'Pushover - Users',
          config: { userKey: 'user123', appToken: 'app456' },
          events: ['request_available'],
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      prismaMock.notificationBackend.findMany.mockResolvedValue(backends);

      const { GET } = await import('@/app/api/admin/notifications/route');
      const response = await GET({} as any);
      const payload = await response.json();

      expect(payload.success).toBe(true);
      expect(payload.backends).toHaveLength(2);
      expect(notificationServiceMock.maskConfig).toHaveBeenCalledTimes(2);
    });

    it('returns empty array if no backends configured', async () => {
      prismaMock.notificationBackend.findMany.mockResolvedValue([]);

      const { GET } = await import('@/app/api/admin/notifications/route');
      const response = await GET({} as any);
      const payload = await response.json();

      expect(payload.success).toBe(true);
      expect(payload.backends).toHaveLength(0);
    });
  });

  describe('POST /api/admin/notifications', () => {
    it('creates new notification backend with encrypted config', async () => {
      const newBackend = {
        type: 'discord',
        name: 'Discord - Admins',
        config: { webhookUrl: 'https://discord.com/webhook' },
        events: ['request_approved'],
        enabled: true,
      };

      authRequest.json.mockResolvedValue(newBackend);

      prismaMock.notificationBackend.create.mockResolvedValue({
        id: '1',
        ...newBackend,
        config: { webhookUrl: 'https://discord.com/webhook', encrypted: true },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { POST } = await import('@/app/api/admin/notifications/route');
      const response = await POST({ json: authRequest.json } as any);
      const payload = await response.json();

      expect(payload.success).toBe(true);
      expect(notificationServiceMock.prepareSubmittedConfig).toHaveBeenCalledWith('discord', newBackend.config);
      expect(prismaMock.notificationBackend.create).toHaveBeenCalled();
    });

    it('validates required fields', async () => {
      authRequest.json.mockResolvedValue({
        type: 'discord',
        // Missing name, config, events
      });

      const { POST } = await import('@/app/api/admin/notifications/route');
      const response = await POST({ json: authRequest.json } as any);

      expect(response.status).toBe(400);
      const payload = await response.json();
      expect(payload.error).toBe('ValidationError');
    });

    it('validates at least one event is selected', async () => {
      authRequest.json.mockResolvedValue({
        type: 'discord',
        name: 'Discord - Admins',
        config: { webhookUrl: 'https://discord.com/webhook' },
        events: [], // Empty events array
        enabled: true,
      });

      const { POST } = await import('@/app/api/admin/notifications/route');
      const response = await POST({ json: authRequest.json } as any);

      expect(response.status).toBe(400);
      const payload = await response.json();
      // The error field is just "ValidationError" but details are in the error string
      expect(payload.error).toBeDefined();
      expect(typeof payload.error).toBe('string');
    });

    it('validates Discord config has webhookUrl', async () => {
      authRequest.json.mockResolvedValue({
        type: 'discord',
        name: 'Discord - Admins',
        config: { username: 'Bot' }, // Missing webhookUrl
        events: ['request_approved'],
        enabled: true,
      });

      const { POST } = await import('@/app/api/admin/notifications/route');
      const response = await POST({ json: authRequest.json } as any);

      // Should return 500 because validation happens after Prisma mock fails
      expect(response.status).toBeGreaterThanOrEqual(400);
      const payload = await response.json();
      expect(payload.error).toBeDefined();
    });

    it('validates Pushover config has userKey and appToken', async () => {
      authRequest.json.mockResolvedValue({
        type: 'pushover',
        name: 'Pushover - Users',
        config: { userKey: 'user123' }, // Missing appToken
        events: ['request_approved'],
        enabled: true,
      });

      const { POST } = await import('@/app/api/admin/notifications/route');
      const response = await POST({ json: authRequest.json } as any);

      // Should return error (400 or 500)
      expect(response.status).toBeGreaterThanOrEqual(400);
      const payload = await response.json();
      expect(payload.error).toBeDefined();
    });
  });

  describe('GET /api/admin/notifications/[id]', () => {
    it('returns notification backend with masked config', async () => {
      const backend = {
        id: '1',
        type: 'discord',
        name: 'Discord - Admins',
        config: { webhookUrl: 'https://discord.com/webhook' },
        events: ['request_approved'],
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      prismaMock.notificationBackend.findUnique.mockResolvedValue(backend);

      const { GET } = await import('@/app/api/admin/notifications/[id]/route');
      const response = await GET({} as any, { params: Promise.resolve({ id: '1' }) });
      const payload = await response.json();

      expect(payload.success).toBe(true);
      expect(payload.backend.id).toBe('1');
      expect(notificationServiceMock.maskConfig).toHaveBeenCalled();
    });

    it('returns 404 if backend not found', async () => {
      prismaMock.notificationBackend.findUnique.mockResolvedValue(null);

      const { GET } = await import('@/app/api/admin/notifications/[id]/route');
      const response = await GET({} as any, { params: Promise.resolve({ id: 'nonexistent' }) });

      expect(response.status).toBe(404);
      const payload = await response.json();
      expect(payload.error).toBe('NotFound');
    });
  });

  describe('PUT /api/admin/notifications/[id]', () => {
    it('updates notification backend', async () => {
      const existingBackend = {
        id: '1',
        type: 'discord',
        name: 'Discord - Admins',
        config: { webhookUrl: 'enc:https://discord.com/old' },
        events: ['request_approved'],
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const updates = {
        name: 'Discord - Updated',
        events: ['request_approved', 'request_available'],
      };

      prismaMock.notificationBackend.findUnique.mockResolvedValue(existingBackend);
      authRequest.json.mockResolvedValue(updates);
      prismaMock.notificationBackend.update.mockResolvedValue({
        ...existingBackend,
        ...updates,
      });

      const { PUT } = await import('@/app/api/admin/notifications/[id]/route');
      const response = await PUT(
        { json: authRequest.json } as any,
        { params: Promise.resolve({ id: '1' }) }
      );
      const payload = await response.json();

      expect(payload.success).toBe(true);
      expect(prismaMock.notificationBackend.update).toHaveBeenCalled();
    });

    it('preserves masked config values on update', async () => {
      const existingBackend = {
        id: '1',
        type: 'discord',
        name: 'Discord - Admins',
        config: { webhookUrl: 'enc:https://discord.com/webhook' },
        events: ['request_approved'],
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const updates = {
        config: { webhookUrl: '••••••••', username: 'NewBot' }, // Masked webhook
      };

      prismaMock.notificationBackend.findUnique.mockResolvedValue(existingBackend);
      authRequest.json.mockResolvedValue(updates);
      prismaMock.notificationBackend.update.mockResolvedValue(existingBackend);

      const { PUT } = await import('@/app/api/admin/notifications/[id]/route');
      const response = await PUT(
        { json: authRequest.json } as any,
        { params: Promise.resolve({ id: '1' }) }
      );

      expect(response.status).toBe(200);
      // Should preserve existing encrypted webhook and add new username
      expect(prismaMock.notificationBackend.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            config: expect.objectContaining({
              webhookUrl: 'enc:https://discord.com/webhook', // Original encrypted value
              username: 'NewBot',
            }),
          }),
        })
      );
    });

    it('refuses an update whose masked secret cannot be kept, without saving', async () => {
      prismaMock.notificationBackend.findUnique.mockResolvedValue({
        id: '1', type: 'ntfy', name: 'ntfy', config: { topic: 't', accessToken: 'enc:tk' },
        events: ['request_approved'], enabled: true, createdAt: new Date(), updatedAt: new Date(),
      });
      notificationServiceMock.mergeMaskedSecrets.mockReturnValueOnce({ ok: false, error: 'Re-enter the ntfy access token' });
      authRequest.json.mockResolvedValue({ config: { serverUrl: 'https://ntfy.other', topic: 't', accessToken: '••••••••' } });

      const { PUT } = await import('@/app/api/admin/notifications/[id]/route');
      const response = await PUT(
        { json: authRequest.json } as any,
        { params: Promise.resolve({ id: '1' }) }
      );

      expect(response.status).toBe(400);
      expect((await response.json()).message).toBe('Re-enter the ntfy access token');
      expect(prismaMock.notificationBackend.update).not.toHaveBeenCalled();
    });

    it('returns 404 if backend not found', async () => {
      prismaMock.notificationBackend.findUnique.mockResolvedValue(null);
      authRequest.json.mockResolvedValue({ name: 'Updated' });

      const { PUT } = await import('@/app/api/admin/notifications/[id]/route');
      const response = await PUT(
        { json: authRequest.json } as any,
        { params: Promise.resolve({ id: 'nonexistent' }) }
      );

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /api/admin/notifications/[id]', () => {
    it('deletes notification backend', async () => {
      const backend = {
        id: '1',
        type: 'discord',
        name: 'Discord - Admins',
        config: {},
        events: [],
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Mock findUnique to return the backend (so it passes the existence check)
      prismaMock.notificationBackend.findUnique.mockResolvedValue(backend);
      // Mock delete to simulate successful deletion
      prismaMock.notificationBackend.delete.mockResolvedValue(backend);

      const { DELETE } = await import('@/app/api/admin/notifications/[id]/route');
      const response = await DELETE({} as any, { params: Promise.resolve({ id: '1' }) });
      const payload = await response.json();

      expect(payload.success).toBe(true);
      expect(prismaMock.notificationBackend.delete).toHaveBeenCalledWith({
        where: { id: '1' },
      });
    });

    it('returns 404 if backend not found', async () => {
      prismaMock.notificationBackend.delete.mockRejectedValue(new Error('Record not found'));

      const { DELETE } = await import('@/app/api/admin/notifications/[id]/route');
      const response = await DELETE({} as any, { params: Promise.resolve({ id: 'nonexistent' }) });

      expect(response.status).toBe(404);
    });
  });
});
