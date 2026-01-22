/**
 * Component: Notification Service Tests
 * Documentation: documentation/backend/services/notifications.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
prismaMock.notificationBackend = {
  findMany: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
} as any;

const encryptionMock = vi.hoisted(() => ({
  encrypt: vi.fn((value: string) => `enc:${value}`),
  decrypt: vi.fn((value: string) => value.replace('enc:', '')),
}));

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/services/encryption.service', () => ({
  getEncryptionService: () => encryptionMock,
}));

describe('NotificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  describe('sendNotification', () => {
    it('sends notifications to all enabled backends subscribed to the event', async () => {
      prismaMock.notificationBackend.findMany.mockResolvedValue([
        {
          id: '1',
          type: 'discord',
          name: 'Discord - Admins',
          config: { webhookUrl: 'https://discord.com/webhook1' },
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
          events: ['request_approved'],
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { NotificationService } = await import('@/lib/services/notification.service');
      const service = new NotificationService();

      await service.sendNotification({
        event: 'request_approved',
        requestId: 'req-1',
        title: 'Test Book',
        author: 'Test Author',
        userName: 'Test User',
        timestamp: new Date(),
      });

      expect(prismaMock.notificationBackend.findMany).toHaveBeenCalledWith({
        where: {
          enabled: true,
          events: { array_contains: 'request_approved' },
        },
      });

      // Should send to both backends
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not send if no backends are subscribed to the event', async () => {
      prismaMock.notificationBackend.findMany.mockResolvedValue([]);

      const { NotificationService } = await import('@/lib/services/notification.service');
      const service = new NotificationService();

      await service.sendNotification({
        event: 'request_approved',
        requestId: 'req-1',
        title: 'Test Book',
        author: 'Test Author',
        userName: 'Test User',
        timestamp: new Date(),
      });

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('continues sending to other backends if one fails', async () => {
      prismaMock.notificationBackend.findMany.mockResolvedValue([
        {
          id: '1',
          type: 'discord',
          name: 'Discord - Admins',
          config: { webhookUrl: 'https://discord.com/webhook1' },
          events: ['request_approved'],
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '2',
          type: 'pushover',
          name: 'Pushover - Users',
          config: { userKey: 'user123', appToken: 'app456' },
          events: ['request_approved'],
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      // First backend fails, second succeeds
      fetchMock
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        });

      const { NotificationService } = await import('@/lib/services/notification.service');
      const service = new NotificationService();

      await service.sendNotification({
        event: 'request_approved',
        requestId: 'req-1',
        title: 'Test Book',
        author: 'Test Author',
        userName: 'Test User',
        timestamp: new Date(),
      });

      // Should still attempt both
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('sendDiscord', () => {
    it('sends Discord webhook with rich embed', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { NotificationService } = await import('@/lib/services/notification.service');
      const service = new NotificationService();

      await service.sendDiscord(
        {
          webhookUrl: 'enc:https://discord.com/webhook',
          username: 'ReadMeABook',
        },
        {
          event: 'request_approved',
          requestId: 'req-1',
          title: 'Test Book',
          author: 'Test Author',
          userName: 'Test User',
          timestamp: new Date('2024-01-01T00:00:00Z'),
        }
      );

      // Should call the webhook (URL decryption happens internally)
      expect(fetchMock).toHaveBeenCalled();

      const fetchCall = fetchMock.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);

      expect(fetchCall[1].method).toBe('POST');
      expect(fetchCall[1].headers['Content-Type']).toBe('application/json');
      expect(body.username).toBe('ReadMeABook');
      expect(body.embeds).toHaveLength(1);
      expect(body.embeds[0].title).toBe('✅ Request Approved');
      expect(body.embeds[0].color).toBe(2278750); // Green for approved (0x22C55E)
    });

    it('uses default username if not provided', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { NotificationService } = await import('@/lib/services/notification.service');
      const service = new NotificationService();

      await service.sendDiscord(
        {
          webhookUrl: 'enc:https://discord.com/webhook',
        },
        {
          event: 'request_approved',
          requestId: 'req-1',
          title: 'Test Book',
          author: 'Test Author',
          userName: 'Test User',
          timestamp: new Date(),
        }
      );

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.username).toBe('ReadMeABook');
    });

    it('throws error if Discord API returns non-OK response', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'Bad Request',
      });

      const { NotificationService } = await import('@/lib/services/notification.service');
      const service = new NotificationService();

      await expect(
        service.sendDiscord(
          { webhookUrl: 'enc:https://discord.com/webhook' },
          {
            event: 'request_approved',
            requestId: 'req-1',
            title: 'Test Book',
            author: 'Test Author',
            userName: 'Test User',
            timestamp: new Date(),
          }
        )
      ).rejects.toThrow('Discord webhook failed: 400 Bad Request');
    });
  });

  describe('sendPushover', () => {
    it('sends Pushover notification with correct payload', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ status: 1 }),
      });

      const { NotificationService } = await import('@/lib/services/notification.service');
      const service = new NotificationService();

      await service.sendPushover(
        {
          userKey: 'enc:user123',
          appToken: 'enc:app456',
          priority: 1,
        },
        {
          event: 'request_approved',
          requestId: 'req-1',
          title: 'Test Book',
          author: 'Test Author',
          userName: 'Test User',
          timestamp: new Date(),
        }
      );

      // Should call the Pushover API (credential decryption happens internally)
      expect(fetchMock).toHaveBeenCalled();

      const fetchCall = fetchMock.mock.calls[0];

      expect(fetchCall[0]).toBe('https://api.pushover.net/1/messages.json');
      expect(fetchCall[1].method).toBe('POST');
      expect(fetchCall[1].headers['Content-Type']).toBe('application/x-www-form-urlencoded');

      const body = fetchCall[1].body;
      // Body should be URL-encoded string
      expect(typeof body).toBe('string');
      expect(body).toContain('priority=1');
    });

    it('uses default priority if not provided', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ status: 1 }),
      });

      const { NotificationService } = await import('@/lib/services/notification.service');
      const service = new NotificationService();

      await service.sendPushover(
        {
          userKey: 'enc:user123',
          appToken: 'enc:app456',
        },
        {
          event: 'request_approved',
          requestId: 'req-1',
          title: 'Test Book',
          author: 'Test Author',
          userName: 'Test User',
          timestamp: new Date(),
        }
      );

      const body = fetchMock.mock.calls[0][1].body;
      expect(body.toString()).toContain('priority=0');
    });

    it('throws error if Pushover API returns non-OK response', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'invalid user key',
      });

      const { NotificationService } = await import('@/lib/services/notification.service');
      const service = new NotificationService();

      await expect(
        service.sendPushover(
          { userKey: 'enc:user123', appToken: 'enc:app456' },
          {
            event: 'request_approved',
            requestId: 'req-1',
            title: 'Test Book',
            author: 'Test Author',
            userName: 'Test User',
            timestamp: new Date(),
          }
        )
      ).rejects.toThrow();
    });
  });

  // Note: formatDiscordEmbed is a private method, tested indirectly through sendDiscord

  describe('encryptConfig', () => {
    it('encrypts sensitive Discord config values', async () => {
      const { NotificationService } = await import('@/lib/services/notification.service');
      const service = new NotificationService();

      const encrypted = service.encryptConfig('discord', {
        webhookUrl: 'https://discord.com/webhook',
        username: 'ReadMeABook',
      });

      expect(encryptionMock.encrypt).toHaveBeenCalledWith('https://discord.com/webhook');
      expect(encrypted.webhookUrl).toBe('enc:https://discord.com/webhook');
      expect(encrypted.username).toBe('ReadMeABook'); // Not encrypted
    });

    it('encrypts sensitive Pushover config values', async () => {
      const { NotificationService } = await import('@/lib/services/notification.service');
      const service = new NotificationService();

      const encrypted = service.encryptConfig('pushover', {
        userKey: 'user123',
        appToken: 'app456',
        priority: 1,
      });

      expect(encryptionMock.encrypt).toHaveBeenCalledWith('user123');
      expect(encryptionMock.encrypt).toHaveBeenCalledWith('app456');
      expect(encrypted.userKey).toBe('enc:user123');
      expect(encrypted.appToken).toBe('enc:app456');
      expect(encrypted.priority).toBe(1); // Not encrypted
    });
  });

  // Note: decryptConfig is a private method, tested indirectly through sendDiscord/sendPushover

  describe('maskConfig', () => {
    it('masks sensitive Discord config values', async () => {
      const { NotificationService } = await import('@/lib/services/notification.service');
      const service = new NotificationService();

      const masked = service.maskConfig('discord', {
        webhookUrl: 'https://discord.com/webhook/very/long/url',
        username: 'ReadMeABook',
      });

      expect(masked.webhookUrl).toBe('••••••••');
      expect(masked.username).toBe('ReadMeABook'); // Not masked
    });

    it('masks sensitive Pushover config values', async () => {
      const { NotificationService } = await import('@/lib/services/notification.service');
      const service = new NotificationService();

      const masked = service.maskConfig('pushover', {
        userKey: 'user123',
        appToken: 'app456',
        priority: 1,
      });

      expect(masked.userKey).toBe('••••••••');
      expect(masked.appToken).toBe('••••••••');
      expect(masked.priority).toBe(1); // Not masked
    });
  });
});
