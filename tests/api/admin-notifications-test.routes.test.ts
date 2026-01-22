/**
 * Component: Admin Notifications Test API Route Tests
 * Documentation: documentation/backend/services/notifications.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

let authRequest: any;

const prismaMock = createPrismaMock();
prismaMock.notificationBackend = {
  findUnique: vi.fn(),
} as any;

const requireAuthMock = vi.hoisted(() => vi.fn());
const requireAdminMock = vi.hoisted(() => vi.fn());
const notificationServiceMock = vi.hoisted(() => ({
  encryptConfig: vi.fn((type: string, config: any) => ({ ...config, encrypted: true })),
  sendNotification: vi.fn(),
  sendToBackend: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: requireAuthMock,
  requireAdmin: requireAdminMock,
}));

vi.mock('@/lib/services/notification.service', () => ({
  getNotificationService: () => notificationServiceMock,
}));

describe('Admin notifications test route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = { user: { id: 'admin-1', role: 'admin' }, json: vi.fn() };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
    requireAdminMock.mockImplementation((_req: any, handler: any) => handler());
  });

  describe('POST /api/admin/notifications/test', () => {
    it('sends test notification successfully', async () => {
      const testConfig = {
        type: 'discord',
        config: { webhookUrl: 'https://discord.com/webhook' },
      };

      authRequest.json.mockResolvedValue(testConfig);
      notificationServiceMock.sendNotification.mockResolvedValue(undefined);

      const { POST } = await import('@/app/api/admin/notifications/test/route');
      const response = await POST({ json: authRequest.json } as any);
      const payload = await response.json();

      expect(payload.success).toBe(true);
      expect(payload.message).toContain('successfully');
      expect(notificationServiceMock.encryptConfig).toHaveBeenCalledWith('discord', testConfig.config);
      expect(notificationServiceMock.sendToBackend).toHaveBeenCalled();
    });

    it('returns error if notification fails', async () => {
      const testConfig = {
        type: 'discord',
        config: { webhookUrl: 'https://discord.com/webhook' },
      };

      authRequest.json.mockResolvedValue(testConfig);
      notificationServiceMock.sendToBackend.mockRejectedValue(new Error('Webhook failed'));

      const { POST } = await import('@/app/api/admin/notifications/test/route');
      const response = await POST({ json: authRequest.json } as any);
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload.error).toBe('NotificationError');
      expect(payload.message).toContain('Webhook failed');
    });

    it('validates required fields', async () => {
      authRequest.json.mockResolvedValue({
        type: 'discord',
        // Missing config
      });

      const { POST } = await import('@/app/api/admin/notifications/test/route');
      const response = await POST({ json: authRequest.json } as any);

      expect(response.status).toBe(400);
      const payload = await response.json();
      expect(payload.error).toBe('ValidationError');
    });

    it('uses correct test payload format', async () => {
      const testConfig = {
        type: 'discord',
        config: { webhookUrl: 'https://discord.com/webhook' },
      };

      authRequest.json.mockResolvedValue(testConfig);
      notificationServiceMock.sendToBackend.mockResolvedValue(undefined);

      const { POST } = await import('@/app/api/admin/notifications/test/route');
      await POST({ json: authRequest.json } as any);

      expect(notificationServiceMock.sendToBackend).toHaveBeenCalledWith(
        'discord',
        expect.objectContaining({ encrypted: true }),
        expect.objectContaining({
          event: 'request_available',
          requestId: 'test-request-id',
          title: expect.any(String),
          author: expect.any(String),
          userName: 'Test User',
          timestamp: expect.any(Date),
        })
      );
    });

    it('tests Pushover notification correctly', async () => {
      const testConfig = {
        type: 'pushover',
        config: { userKey: 'user123', appToken: 'app456', priority: 1 },
      };

      authRequest.json.mockResolvedValue(testConfig);
      notificationServiceMock.sendNotification.mockResolvedValue(undefined);

      const { POST } = await import('@/app/api/admin/notifications/test/route');
      const response = await POST({ json: authRequest.json } as any);
      const payload = await response.json();

      expect(payload.success).toBe(true);
      expect(notificationServiceMock.encryptConfig).toHaveBeenCalledWith('pushover', testConfig.config);
    });

    it('tests existing backend using backend ID', async () => {
      const existingBackend = {
        id: 'backend-1',
        type: 'discord',
        name: 'Discord - Admins',
        config: { webhookUrl: 'iv:authTag:encryptedData', username: 'Bot' }, // Already encrypted
        events: ['request_available'],
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      prismaMock.notificationBackend.findUnique.mockResolvedValue(existingBackend);
      authRequest.json.mockResolvedValue({ backendId: 'backend-1' });
      notificationServiceMock.sendToBackend.mockResolvedValue(undefined);

      const { POST } = await import('@/app/api/admin/notifications/test/route');
      const response = await POST({ json: authRequest.json } as any);
      const payload = await response.json();

      expect(payload.success).toBe(true);
      expect(prismaMock.notificationBackend.findUnique).toHaveBeenCalledWith({
        where: { id: 'backend-1' },
      });
      // Should use stored config directly, not encrypt again
      expect(notificationServiceMock.encryptConfig).not.toHaveBeenCalled();
      expect(notificationServiceMock.sendToBackend).toHaveBeenCalledWith(
        'discord',
        existingBackend.config,
        expect.any(Object)
      );
    });

    it('returns 404 if backend ID not found', async () => {
      prismaMock.notificationBackend.findUnique.mockResolvedValue(null);
      authRequest.json.mockResolvedValue({ backendId: 'nonexistent' });

      const { POST } = await import('@/app/api/admin/notifications/test/route');
      const response = await POST({ json: authRequest.json } as any);

      expect(response.status).toBe(404);
      const payload = await response.json();
      expect(payload.error).toBe('NotFound');
    });

    it('returns validation error when payload is invalid', async () => {
      authRequest.json.mockResolvedValue('bad-payload');

      const { POST } = await import('@/app/api/admin/notifications/test/route');
      const response = await POST({ json: authRequest.json } as any);
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload.error).toBe('ValidationError');
      expect(payload.details).toBeDefined();
    });
  });
});
