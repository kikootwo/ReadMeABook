/**
 * Component: Admin Login API Route Tests
 * Documentation: documentation/backend/services/auth.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const bcryptMock = {
  compare: vi.fn(),
};
const encryptionMock = {
  decrypt: vi.fn(),
};
const tokenMock = {
  generateAccessToken: vi.fn(() => 'access-token'),
  generateRefreshToken: vi.fn(() => 'refresh-token'),
};

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

vi.mock('@/lib/utils/jwt', () => ({
  generateAccessToken: tokenMock.generateAccessToken,
  generateRefreshToken: tokenMock.generateRefreshToken,
}));

const makeRequest = (body: Record<string, any>) => ({
  json: vi.fn().mockResolvedValue(body),
});

describe('Admin login route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DISABLE_LOCAL_LOGIN;
  });

  it('blocks local login when disabled', async () => {
    process.env.DISABLE_LOCAL_LOGIN = 'true';
    const { POST } = await import('@/app/api/auth/admin/login/route');

    const response = await POST(makeRequest({ username: 'admin', password: 'pass' }) as any);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Local login is disabled');
  });

  it('rejects missing credentials', async () => {
    const { POST } = await import('@/app/api/auth/admin/login/route');

    const response = await POST(makeRequest({ username: 'admin' }) as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('ValidationError');
  });

  it('rejects unknown user', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const { POST } = await import('@/app/api/auth/admin/login/route');

    const response = await POST(makeRequest({ username: 'admin', password: 'pass' }) as any);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('AuthenticationError');
  });

  it('rejects invalid password', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      plexId: 'local-admin',
      plexUsername: 'admin',
      plexEmail: null,
      role: 'admin',
      avatarUrl: null,
      authToken: 'enc-hash',
    });
    encryptionMock.decrypt.mockReturnValue('hash');
    bcryptMock.compare.mockResolvedValue(false);
    const { POST } = await import('@/app/api/auth/admin/login/route');

    const response = await POST(makeRequest({ username: 'admin', password: 'wrong' }) as any);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('AuthenticationError');
  });

  it('rejects when password verification throws', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-2',
      plexId: 'local-admin',
      plexUsername: 'admin',
      plexEmail: null,
      role: 'admin',
      avatarUrl: null,
      authToken: 'enc-hash',
    });
    encryptionMock.decrypt.mockImplementation(() => {
      throw new Error('decrypt failed');
    });
    const { POST } = await import('@/app/api/auth/admin/login/route');

    const response = await POST(makeRequest({ username: 'admin', password: 'pass' }) as any);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('AuthenticationError');
  });

  it('returns tokens for valid credentials', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-3',
      plexId: 'local-admin',
      plexUsername: 'admin',
      plexEmail: 'admin@example.com',
      role: 'admin',
      avatarUrl: null,
      authToken: 'enc-hash',
    });
    prismaMock.user.update.mockResolvedValue({});
    encryptionMock.decrypt.mockReturnValue('hash');
    bcryptMock.compare.mockResolvedValue(true);
    const { POST } = await import('@/app/api/auth/admin/login/route');

    const response = await POST(makeRequest({ username: 'admin', password: 'pass' }) as any);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.accessToken).toBe('access-token');
    expect(payload.refreshToken).toBe('refresh-token');
    expect(prismaMock.user.update).toHaveBeenCalled();
  });

  describe('account checks', () => {
    const baseUser = {
      id: 'user-10',
      plexId: 'local-reader',
      plexUsername: 'reader',
      plexEmail: null,
      role: 'user',
      avatarUrl: null,
      authToken: 'enc-hash',
      authProvider: 'local',
      isSetupAdmin: false,
      registrationStatus: 'approved' as string | null,
      deletedAt: null as Date | null,
    };

    const signIn = async (row: Record<string, unknown>) => {
      prismaMock.user.findUnique.mockResolvedValue(row);
      prismaMock.user.update.mockResolvedValue({});
      encryptionMock.decrypt.mockReturnValue('hash');
      bcryptMock.compare.mockResolvedValue(true);
      const { POST } = await import('@/app/api/auth/admin/login/route');
      const request = makeRequest({ username: 'reader', password: 'pass' }) as unknown as Parameters<typeof POST>[0];
      const response = await POST(request);
      return { response, payload: await response.json() };
    };

    const expectNoSession = (payload: Record<string, unknown>) => {
      expect(payload.accessToken).toBeUndefined();
      expect(payload.refreshToken).toBeUndefined();
      expect(tokenMock.generateAccessToken).not.toHaveBeenCalled();
      expect(tokenMock.generateRefreshToken).not.toHaveBeenCalled();
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    };

    it('gives an account pending approval the regular pending response and no session', async () => {
      const { response, payload } = await signIn({ ...baseUser, registrationStatus: 'pending_approval' });

      expect(response.status).toBe(200);
      expect(payload).toEqual({
        success: false,
        pendingApproval: true,
        message: 'Account pending admin approval.',
      });
      expectNoSession(payload);
    });

    it('refuses a rejected account with the regular rejected response and no session', async () => {
      const { response, payload } = await signIn({ ...baseUser, registrationStatus: 'rejected' });

      expect(response.status).toBe(401);
      expect(payload).toEqual({ error: 'Account has been rejected' });
      expectNoSession(payload);
    });

    it('answers a deleted account exactly like a wrong password and gives no session', async () => {
      const { response, payload } = await signIn({ ...baseUser, deletedAt: new Date('2026-01-01T00:00:00Z') });

      expect(response.status).toBe(401);
      expect(payload).toEqual({
        error: 'AuthenticationError',
        message: 'Invalid username or password',
      });
      expectNoSession(payload);
    });

    it('still signs in the setup admin', async () => {
      const { response, payload } = await signIn({
        ...baseUser,
        id: 'setup-admin',
        plexId: 'local-admin',
        plexUsername: 'admin',
        role: 'admin',
        authProvider: 'plex',
        isSetupAdmin: true,
      });

      expect(response.status).toBe(200);
      expect(payload.success).toBe(true);
      expect(payload.accessToken).toBe('access-token');
      expect(payload.refreshToken).toBe('refresh-token');
      expect(payload.user).toMatchObject({ id: 'setup-admin', role: 'admin' });
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'setup-admin' },
        data: { lastLoginAt: expect.any(Date) },
      });
    });

    it('still signs in an approved local user', async () => {
      const { response, payload } = await signIn({ ...baseUser });

      expect(response.status).toBe(200);
      expect(payload.success).toBe(true);
      expect(payload.accessToken).toBe('access-token');
      expect(payload.user).toMatchObject({ id: 'user-10', role: 'user' });
      expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
    });

    it('still signs in an older row with no registration status', async () => {
      const { response, payload } = await signIn({ ...baseUser, id: 'legacy-1', registrationStatus: null });

      expect(response.status).toBe(200);
      expect(payload.success).toBe(true);
      expect(payload.accessToken).toBe('access-token');
      expect(payload.user).toMatchObject({ id: 'legacy-1' });
      expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
    });
  });
});
