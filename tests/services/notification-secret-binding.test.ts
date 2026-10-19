/**
 * Component: Notification Saved-Secret Binding Tests
 * Documentation: documentation/backend/services/notifications.md
 *
 * On update, a masked secret keeps the saved value. For Apprise and ntfy the saved
 * secret is kept only while the server URL is unchanged (ntfy: empty = https://ntfy.sh).
 * Discord and Pushover have no separate server URL and behave as before.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: { notificationBackend: {} } }));
vi.mock('@/lib/services/encryption.service', () => ({
  getEncryptionService: () => ({
    encrypt: (value: string) => `enc:${value}`,
    decrypt: (value: string) => value.replace('enc:', ''),
    isEncryptedFormat: (value: string) => typeof value === 'string' && value.startsWith('enc:'),
  }),
}));

const MASK = '••••••••';

async function merge(type: string, existing: Record<string, unknown>, updated: Record<string, unknown>) {
  const { NotificationService } = await import('@/lib/services/notification');
  return new NotificationService().mergeMaskedSecrets(type, existing, updated);
}

describe('NotificationService.mergeMaskedSecrets', () => {
  describe('apprise', () => {
    const existing = { serverUrl: 'http://apprise.saved:8000', urls: 'enc:slack://token', authToken: 'enc:tok' };

    it('keeps the saved secrets when the server URL is unchanged (trailing slash ignored)', async () => {
      const result = await merge('apprise', existing, { serverUrl: 'http://apprise.saved:8000/', urls: MASK, authToken: MASK });

      expect(result).toEqual({ ok: true, config: { serverUrl: 'http://apprise.saved:8000/', urls: 'enc:slack://token', authToken: 'enc:tok' } });
    });

    it('refuses masked secrets with a new server URL, naming the fields', async () => {
      const result = await merge('apprise', existing, { serverUrl: 'https://evil.example', urls: MASK, authToken: MASK });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('Apprise notification URLs');
      expect(result.error).toContain('Notification URLs, Auth Token');
    });

    it('accepts a new server URL when the secrets are re-entered', async () => {
      const result = await merge('apprise', existing, { serverUrl: 'https://apprise.new', urls: 'discord://id/token', authToken: 'new' });

      expect(result).toEqual({ ok: true, config: { serverUrl: 'https://apprise.new', urls: 'discord://id/token', authToken: 'new' } });
    });

    it.each([
      ['empty', ''],
      ['missing its scheme', 'apprise.saved:8000'],
    ])('asks for the full server URL when it is %s and secrets are kept', async (_label, serverUrl) => {
      const result = await merge('apprise', existing, { serverUrl, urls: MASK });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('Enter the full Server URL (starting with http:// or https://) to keep the saved Notification URLs.');
    });

    it('allows a new server URL when no secret was saved for the masked field', async () => {
      const result = await merge('apprise', { serverUrl: 'http://apprise.saved:8000' }, { serverUrl: 'https://apprise.new', urls: MASK });

      expect(result.ok).toBe(true);
    });
  });

  describe('ntfy', () => {
    it('treats an empty server URL as https://ntfy.sh on both sides', async () => {
      const savedEmpty = await merge('ntfy', { serverUrl: '', topic: 't', accessToken: 'enc:tk' }, { serverUrl: 'https://ntfy.sh', topic: 't', accessToken: MASK });
      const updatedEmpty = await merge('ntfy', { serverUrl: 'https://ntfy.sh/', topic: 't', accessToken: 'enc:tk' }, { topic: 't', accessToken: MASK });

      expect(savedEmpty).toMatchObject({ ok: true, config: { accessToken: 'enc:tk' } });
      expect(updatedEmpty).toMatchObject({ ok: true, config: { accessToken: 'enc:tk' } });
    });

    it('refuses the saved token for a different server', async () => {
      const result = await merge('ntfy', { topic: 't', accessToken: 'enc:tk' }, { serverUrl: 'https://ntfy.evil.example', topic: 't', accessToken: MASK });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('ntfy access token');
    });
  });

  describe('providers without a separate server URL', () => {
    it('discord keeps the masked webhook as before', async () => {
      const result = await merge('discord', { webhookUrl: 'enc:https://discord.com/api/webhooks/1/a' }, { webhookUrl: MASK, username: 'Bot' });

      expect(result).toEqual({ ok: true, config: { webhookUrl: 'enc:https://discord.com/api/webhooks/1/a', username: 'Bot' } });
    });

    it('pushover keeps masked keys as before', async () => {
      const result = await merge('pushover', { userKey: 'enc:u', appToken: 'enc:a' }, { userKey: MASK, appToken: MASK, priority: 1 });

      expect(result).toEqual({ ok: true, config: { userKey: 'enc:u', appToken: 'enc:a', priority: 1 } });
    });
  });
});
