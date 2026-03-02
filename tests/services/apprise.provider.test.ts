/**
 * Component: Apprise Notification Provider Tests
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
  isEncryptedFormat: vi.fn((value: string) => typeof value === 'string' && value.startsWith('enc:')),
}));

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/services/encryption.service', () => ({
  getEncryptionService: () => encryptionMock,
}));

describe('AppriseProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  describe('send — stateless mode (urls)', () => {
    it('sends notification to correct Apprise endpoint with JSON body', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: async () => 'ok',
      });

      const { AppriseProvider } = await import('@/lib/services/notification');
      const provider = new AppriseProvider();

      await provider.send(
        {
          serverUrl: 'http://apprise:8000',
          urls: 'slack://tokenA/tokenB/tokenC',
          authToken: 'mytoken123',
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

      expect(fetchMock).toHaveBeenCalledTimes(1);

      const fetchCall = fetchMock.mock.calls[0];
      expect(fetchCall[0]).toBe('http://apprise:8000/notify/');
      expect(fetchCall[1].method).toBe('POST');
      expect(fetchCall[1].headers['Content-Type']).toBe('application/json');
      expect(fetchCall[1].headers['Authorization']).toBe('Bearer mytoken123');

      const body = JSON.parse(fetchCall[1].body);
      expect(body.urls).toBe('slack://tokenA/tokenB/tokenC');
      expect(body.title).toBe('Request Approved');
      expect(body.body).toContain('Test Book');
      expect(body.body).toContain('Test Author');
      expect(body.body).toContain('Test User');
      expect(body.type).toBe('success');
    });

    it('strips trailing slashes from server URL', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: async () => 'ok',
      });

      const { AppriseProvider } = await import('@/lib/services/notification');
      const provider = new AppriseProvider();

      await provider.send(
        { serverUrl: 'http://apprise:8000/', urls: 'slack://token' },
        {
          event: 'request_approved',
          requestId: 'req-1',
          title: 'Test Book',
          author: 'Test Author',
          userName: 'Test User',
          timestamp: new Date(),
        }
      );

      const fetchCall = fetchMock.mock.calls[0];
      expect(fetchCall[0]).toBe('http://apprise:8000/notify/');
    });

    it('does not include Authorization header when authToken is not provided', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: async () => 'ok',
      });

      const { AppriseProvider } = await import('@/lib/services/notification');
      const provider = new AppriseProvider();

      await provider.send(
        { serverUrl: 'http://apprise:8000', urls: 'slack://token' },
        {
          event: 'request_approved',
          requestId: 'req-1',
          title: 'Test Book',
          author: 'Test Author',
          userName: 'Test User',
          timestamp: new Date(),
        }
      );

      const fetchCall = fetchMock.mock.calls[0];
      expect(fetchCall[1].headers['Authorization']).toBeUndefined();
    });

    it('throws error when neither urls nor configKey is provided', async () => {
      const { AppriseProvider } = await import('@/lib/services/notification');
      const provider = new AppriseProvider();

      await expect(
        provider.send(
          { serverUrl: 'http://apprise:8000' },
          {
            event: 'request_approved',
            requestId: 'req-1',
            title: 'Test Book',
            author: 'Test Author',
            userName: 'Test User',
            timestamp: new Date(),
          }
        )
      ).rejects.toThrow('Apprise requires either notification URLs or a config key');
    });
  });

  describe('send — stateful mode (configKey)', () => {
    it('sends notification to configKey endpoint', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: async () => 'ok',
      });

      const { AppriseProvider } = await import('@/lib/services/notification');
      const provider = new AppriseProvider();

      await provider.send(
        {
          serverUrl: 'http://apprise:8000',
          configKey: 'my-config',
          tag: 'audiobooks',
        },
        {
          event: 'request_available',
          requestId: 'req-1',
          title: 'Test Book',
          author: 'Test Author',
          userName: 'Test User',
          requestType: 'audiobook',
          timestamp: new Date(),
        }
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);

      const fetchCall = fetchMock.mock.calls[0];
      expect(fetchCall[0]).toBe('http://apprise:8000/notify/my-config');

      const body = JSON.parse(fetchCall[1].body);
      expect(body.tag).toBe('audiobooks');
      expect(body.title).toBe('Audiobook Available');
      expect(body.body).toContain('Test Book');
      expect(body.type).toBe('success');
    });

    it('omits tag from body when not provided', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: async () => 'ok',
      });

      const { AppriseProvider } = await import('@/lib/services/notification');
      const provider = new AppriseProvider();

      await provider.send(
        { serverUrl: 'http://apprise:8000', configKey: 'my-config' },
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
      expect(body.tag).toBeUndefined();
    });

    it('prefers configKey over urls when both are provided', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: async () => 'ok',
      });

      const { AppriseProvider } = await import('@/lib/services/notification');
      const provider = new AppriseProvider();

      await provider.send(
        {
          serverUrl: 'http://apprise:8000',
          configKey: 'my-config',
          urls: 'slack://token',
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

      const fetchCall = fetchMock.mock.calls[0];
      expect(fetchCall[0]).toBe('http://apprise:8000/notify/my-config');
      const body = JSON.parse(fetchCall[1].body);
      expect(body.urls).toBeUndefined();
    });
  });

  describe('send — URL with embedded credentials', () => {
    it('extracts credentials and sends Basic auth header with clean URL', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: async () => 'ok',
      });

      const { AppriseProvider } = await import('@/lib/services/notification');
      const provider = new AppriseProvider();

      await provider.send(
        {
          serverUrl: 'http://myuser:mypass@apprise:8000',
          urls: 'slack://token',
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

      const fetchCall = fetchMock.mock.calls[0];
      expect(fetchCall[0]).toBe('http://apprise:8000/notify/');
      expect(fetchCall[1].headers['Authorization']).toBe(
        `Basic ${Buffer.from('myuser:mypass').toString('base64')}`
      );
    });

    it('decodes URL-encoded special characters in credentials', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: async () => 'ok',
      });

      const { AppriseProvider } = await import('@/lib/services/notification');
      const provider = new AppriseProvider();

      await provider.send(
        {
          serverUrl: 'http://user%40domain:p%40ss%3Aword@apprise:8000',
          urls: 'slack://token',
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

      const fetchCall = fetchMock.mock.calls[0];
      expect(fetchCall[0]).toBe('http://apprise:8000/notify/');
      expect(fetchCall[1].headers['Authorization']).toBe(
        `Basic ${Buffer.from('user@domain:p@ss:word').toString('base64')}`
      );
    });

    it('authToken (Bearer) takes precedence over URL-embedded credentials', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: async () => 'ok',
      });

      const { AppriseProvider } = await import('@/lib/services/notification');
      const provider = new AppriseProvider();

      await provider.send(
        {
          serverUrl: 'http://myuser:mypass@apprise:8000',
          urls: 'slack://token',
          authToken: 'bearertoken123',
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

      const fetchCall = fetchMock.mock.calls[0];
      // URL should still be cleaned
      expect(fetchCall[0]).toBe('http://apprise:8000/notify/');
      // Bearer token wins over Basic
      expect(fetchCall[1].headers['Authorization']).toBe('Bearer bearertoken123');
    });
  });

  describe('notification types by event', () => {
    it('maps event types to correct Apprise notification types', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: async () => 'ok',
      });

      const { AppriseProvider } = await import('@/lib/services/notification');
      const provider = new AppriseProvider();

      const events = [
        { event: 'request_pending_approval', expectedType: 'info' },
        { event: 'request_approved', expectedType: 'success' },
        { event: 'request_available', expectedType: 'success' },
        { event: 'request_error', expectedType: 'failure' },
      ] as const;

      for (const { event, expectedType } of events) {
        fetchMock.mockClear();
        await provider.send(
          { serverUrl: 'http://apprise:8000', urls: 'slack://token' },
          {
            event,
            requestId: 'req-1',
            title: 'Test Book',
            author: 'Test Author',
            userName: 'Test User',
            timestamp: new Date(),
          }
        );

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.type).toBe(expectedType);
      }
    });
  });

  describe('error handling', () => {
    it('throws descriptive error when API returns non-OK response', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const { AppriseProvider } = await import('@/lib/services/notification');
      const provider = new AppriseProvider();

      await expect(
        provider.send(
          { serverUrl: 'http://apprise:8000', urls: 'slack://token' },
          {
            event: 'request_approved',
            requestId: 'req-1',
            title: 'Test Book',
            author: 'Test Author',
            userName: 'Test User',
            timestamp: new Date(),
          }
        )
      ).rejects.toThrow('Apprise API failed: 500 Internal Server Error');
    });

    it('throws descriptive error on stateful mode failure', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 424,
        text: async () => 'No recipients',
      });

      const { AppriseProvider } = await import('@/lib/services/notification');
      const provider = new AppriseProvider();

      await expect(
        provider.send(
          { serverUrl: 'http://apprise:8000', configKey: 'bad-key' },
          {
            event: 'request_approved',
            requestId: 'req-1',
            title: 'Test Book',
            author: 'Test Author',
            userName: 'Test User',
            timestamp: new Date(),
          }
        )
      ).rejects.toThrow('Apprise API failed: 424 No recipients');
    });

    it('includes error message in notification body for error events', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: async () => 'ok',
      });

      const { AppriseProvider } = await import('@/lib/services/notification');
      const provider = new AppriseProvider();

      await provider.send(
        { serverUrl: 'http://apprise:8000', urls: 'slack://token' },
        {
          event: 'request_error',
          requestId: 'req-1',
          title: 'Test Book',
          author: 'Test Author',
          userName: 'Test User',
          message: 'Download timed out',
          timestamp: new Date(),
        }
      );

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.body).toContain('⚠️ Error: Download timed out');
      expect(body.type).toBe('failure');
    });
  });

  describe('integration with NotificationService.sendToBackend', () => {
    it('decrypts sensitive fields and sends to Apprise', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: async () => 'ok',
      });

      const { NotificationService } = await import('@/lib/services/notification');
      const service = new NotificationService();

      await service.sendToBackend(
        'apprise',
        {
          serverUrl: 'http://apprise:8000',
          urls: 'enc:encryptedUrlsData',
          authToken: 'enc:mytoken123',
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

      // Verify decrypt was called for the sensitive fields
      expect(encryptionMock.decrypt).toHaveBeenCalledWith('enc:encryptedUrlsData');
      expect(encryptionMock.decrypt).toHaveBeenCalledWith('enc:mytoken123');

      // Verify the decrypted values reach the fetch call
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const fetchCall = fetchMock.mock.calls[0];
      expect(fetchCall[1].headers['Authorization']).toBe('Bearer mytoken123');

      const body = JSON.parse(fetchCall[1].body);
      expect(body.urls).toBe('encryptedUrlsData');
    });

    it('does not decrypt non-sensitive fields', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: async () => 'ok',
      });

      const { NotificationService } = await import('@/lib/services/notification');
      const service = new NotificationService();

      await service.sendToBackend(
        'apprise',
        {
          serverUrl: 'http://apprise:8000',
          configKey: 'my-config',
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

      // decrypt should not be called since there are no sensitive fields with encrypted values
      expect(encryptionMock.decrypt).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('encryptConfig and maskConfig', () => {
    it('encrypts urls and authToken', async () => {
      const { NotificationService } = await import('@/lib/services/notification');
      const service = new NotificationService();

      const encrypted = service.encryptConfig('apprise', {
        serverUrl: 'http://apprise:8000',
        urls: 'slack://tokenA/tokenB',
        configKey: 'my-config',
        authToken: 'mytoken123',
      });

      expect(encryptionMock.encrypt).toHaveBeenCalledWith('slack://tokenA/tokenB');
      expect(encryptionMock.encrypt).toHaveBeenCalledWith('mytoken123');
      expect(encrypted.urls).toBe('enc:slack://tokenA/tokenB');
      expect(encrypted.authToken).toBe('enc:mytoken123');
      expect(encrypted.serverUrl).toBe('http://apprise:8000'); // Not encrypted
      expect(encrypted.configKey).toBe('my-config'); // Not encrypted
    });

    it('masks urls and authToken', async () => {
      const { NotificationService } = await import('@/lib/services/notification');
      const service = new NotificationService();

      const masked = service.maskConfig('apprise', {
        serverUrl: 'http://apprise:8000',
        urls: 'slack://tokenA/tokenB',
        configKey: 'my-config',
        authToken: 'mytoken123',
      });

      expect(masked.urls).toBe('••••••••');
      expect(masked.authToken).toBe('••••••••');
      expect(masked.serverUrl).toBe('http://apprise:8000'); // Not masked
      expect(masked.configKey).toBe('my-config'); // Not masked
    });
  });
});
