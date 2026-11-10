/**
 * Component: Change Password API Route Tests
 * Documentation: documentation/backend/services/auth.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const bcryptMock = {
  compare: vi.fn(),
  hash: vi.fn(),
};
const encryptionMock = {
  decrypt: vi.fn(),
  encrypt: vi.fn(),
};
const requireAuthMock = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('bcrypt', () => ({
  default: bcryptMock,
  ...bcryptMock,
}));

vi.mock('@/lib/services/encryption.service', () => ({
  getEncryptionService: () => encryptionMock,
}));

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: requireAuthMock,
}));

const makeRequest = (body: Record<string, any>) => ({
  json: vi.fn().mockResolvedValue(body),
});

describe('Change password route', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    (await import('@/lib/utils/rateLimit'))._resetBuckets();
    requireAuthMock.mockImplementation((_req: any, handler: any) =>
      handler({ user: { id: 'user-1' } })
    );
  });

  it('validates required fields', async () => {
    const { POST } = await import('@/app/api/auth/change-password/route');

    const response = await POST(makeRequest({ currentPassword: 'old' }) as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/required/i);
  });

  it('rejects short passwords', async () => {
    const { POST } = await import('@/app/api/auth/change-password/route');

    const response = await POST(
      makeRequest({ currentPassword: 'old', newPassword: 'short', confirmPassword: 'short' }) as any
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/at least 8 characters/i);
  });

  it('allows short passwords when ALLOW_WEAK_PASSWORD is enabled', async () => {
    process.env.ALLOW_WEAK_PASSWORD = 'true';
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      authProvider: 'local',
      authToken: 'enc-hash',
      plexId: 'local-user',
      plexUsername: 'user',
    });
    encryptionMock.decrypt.mockReturnValue('hash');
    bcryptMock.compare.mockResolvedValue(true);
    bcryptMock.hash.mockResolvedValue('new-hash');
    encryptionMock.encrypt.mockReturnValue('enc-new-hash');
    prismaMock.user.update.mockResolvedValue({});
    const { POST } = await import('@/app/api/auth/change-password/route');

    const response = await POST(
      makeRequest({ currentPassword: 'oldpass', newPassword: 'ab', confirmPassword: 'ab' }) as any
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    delete process.env.ALLOW_WEAK_PASSWORD;
  });

  it('blocks non-local users', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      authProvider: 'plex',
      authToken: 'enc-hash',
      plexId: 'plex-1',
      plexUsername: 'user',
    });
    const { POST } = await import('@/app/api/auth/change-password/route');

    const response = await POST(
      makeRequest({ currentPassword: 'oldpass', newPassword: 'newpass123', confirmPassword: 'newpass123' }) as any
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toMatch(/local users/i);
  });

  it('rejects incorrect current password', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      authProvider: 'local',
      authToken: 'enc-hash',
      plexId: 'local-user',
      plexUsername: 'user',
    });
    encryptionMock.decrypt.mockReturnValue('hash');
    bcryptMock.compare.mockResolvedValue(false);
    const { POST } = await import('@/app/api/auth/change-password/route');

    const response = await POST(
      makeRequest({ currentPassword: 'wrong', newPassword: 'newpass123', confirmPassword: 'newpass123' }) as any
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/incorrect/i);
  });

  it('returns error when decryption fails', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      authProvider: 'local',
      authToken: 'enc-hash',
      plexId: 'local-user',
      plexUsername: 'user',
    });
    encryptionMock.decrypt.mockImplementation(() => {
      throw new Error('decrypt failed');
    });
    const { POST } = await import('@/app/api/auth/change-password/route');

    const response = await POST(
      makeRequest({ currentPassword: 'oldpass', newPassword: 'newpass123', confirmPassword: 'newpass123' }) as any
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toMatch(/verify current password/i);
  });

  it('updates password for local user', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      authProvider: 'local',
      authToken: 'enc-hash',
      plexId: 'local-user',
      plexUsername: 'user',
    });
    encryptionMock.decrypt.mockReturnValue('hash');
    bcryptMock.compare.mockResolvedValue(true);
    bcryptMock.hash.mockResolvedValue('new-hash');
    encryptionMock.encrypt.mockReturnValue('enc-new-hash');
    prismaMock.user.update.mockResolvedValue({});
    const { POST } = await import('@/app/api/auth/change-password/route');

    const response = await POST(
      makeRequest({ currentPassword: 'oldpass', newPassword: 'newpass123', confirmPassword: 'newpass123' }) as any
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ authToken: 'enc-new-hash' }),
      })
    );
  });

  describe('attempt limit (10 per 15 minutes per user)', () => {
    const asUser = (id: string) =>
      requireAuthMock.mockImplementation((_req: any, handler: any) => handler({ user: { id } }));
    const attempt = async (currentPassword: string) => {
      const { POST } = await import('@/app/api/auth/change-password/route');
      const response = await POST(
        makeRequest({ currentPassword, newPassword: 'newpass123', confirmPassword: 'newpass123' }) as any
      );
      return { status: response.status, body: await response.json(), retryAfter: response.headers.get('retry-after') };
    };

    beforeEach(() => {
      prismaMock.user.findUnique.mockImplementation(async ({ where }: any) => ({
        id: where.id,
        authProvider: 'local',
        authToken: 'enc-hash',
        plexId: `local-${where.id}`,
        plexUsername: where.id,
      }));
      encryptionMock.decrypt.mockReturnValue('hash');
      encryptionMock.encrypt.mockReturnValue('enc-new-hash');
      bcryptMock.hash.mockResolvedValue('new-hash');
      prismaMock.user.update.mockResolvedValue({});
      bcryptMock.compare.mockImplementation(async (password: string) => password === 'oldpass');
    });

    it('refuses the 11th wrong current password without checking it', async () => {
      for (let i = 0; i < 10; i += 1) expect((await attempt('wrong')).status).toBe(400);
      const comparesBefore = bcryptMock.compare.mock.calls.length;

      const refused = await attempt('oldpass');

      expect(refused.status).toBe(429);
      expect(refused.body).toEqual({ success: false, error: 'Too many password attempts. Try again in 15 minutes.' });
      expect(refused.retryAfter).toBe('900');
      expect(bcryptMock.compare.mock.calls.length).toBe(comparesBefore);
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it('counts each user separately', async () => {
      for (let i = 0; i < 10; i += 1) await attempt('wrong');
      expect((await attempt('wrong')).status).toBe(429);

      asUser('user-2');
      expect((await attempt('wrong')).status).toBe(400);
    });

    it('gives back the slot when the current password is right', async () => {
      for (let i = 0; i < 9; i += 1) await attempt('wrong');
      expect((await attempt('oldpass')).status).toBe(200);
      expect((await attempt('wrong')).status).toBe(400);
      expect((await attempt('wrong')).status).toBe(429);
    });

    it('is not touched by sign-in limits', async () => {
      const { reserve } = await import('@/lib/utils/rateLimit');
      for (let i = 0; i < 20; i += 1) {
        reserve([{ namespace: 'signin-account', key: 'user-1' }, { namespace: 'signin-address', key: 'none' }]);
      }
      expect((await attempt('oldpass')).status).toBe(200);
    });
  });
});
