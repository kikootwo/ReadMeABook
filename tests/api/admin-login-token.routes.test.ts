/**
 * Component: Admin User Login Token Tests
 * Documentation: documentation/testing.md
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

let authRequest: any;

const prismaMock = createPrismaMock();
const requireAuthMock = vi.hoisted(() => vi.fn());
const requireAdminMock = vi.hoisted(() => vi.fn());
const generateApiTokenMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: requireAuthMock,
  requireAdmin: requireAdminMock,
}));

vi.mock('@/lib/utils/api-token', () => ({
  generateApiToken: generateApiTokenMock,
}));

describe('Admin login token routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = { user: { id: 'admin-1', username: 'admin', role: 'admin' }, json: vi.fn() };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
    requireAdminMock.mockImplementation((_req: any, handler: any) => handler());
    generateApiTokenMock.mockReturnValue({ fullToken: 'rmab_test_token', tokenHash: 'hash_abc123' });
  });

  describe('POST /api/admin/users/[id]/login-token', () => {
    it('generates a login token for an active user', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        plexUsername: 'testuser',
        deletedAt: null,
      });
      prismaMock.user.update.mockResolvedValueOnce({});

      const { POST } = await import('@/app/api/admin/users/[id]/login-token/route');
      const response = await POST({} as any, { params: Promise.resolve({ id: 'u1' }) });
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(payload.fullToken).toBe('rmab_test_token');
    });

    it('returns 404 when user does not exist', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      const { POST } = await import('@/app/api/admin/users/[id]/login-token/route');
      const response = await POST({} as any, { params: Promise.resolve({ id: 'missing' }) });
      const payload = await response.json();

      expect(response.status).toBe(404);
      expect(payload.error).toMatch(/User not found/);
    });

    it('returns 403 when user is deleted', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        plexUsername: 'deleteduser',
        deletedAt: new Date(),
      });

      const { POST } = await import('@/app/api/admin/users/[id]/login-token/route');
      const response = await POST({} as any, { params: Promise.resolve({ id: 'u2' }) });
      const payload = await response.json();

      expect(response.status).toBe(403);
      expect(payload.error).toMatch(/deleted user/);
    });

    it.each([['pending_approval'], ['rejected']])(
      'refuses a %s account with 403 and stores no token',
      async (status) => {
        prismaMock.user.findUnique.mockResolvedValueOnce({
          plexUsername: 'newuser',
          deletedAt: null,
          registrationStatus: status,
        });

        const { POST } = await import('@/app/api/admin/users/[id]/login-token/route');
        const response = await POST({} as any, { params: Promise.resolve({ id: 'u3' }) });
        const payload = await response.json();

        expect(response.status).toBe(403);
        expect(payload).toEqual({ error: 'Cannot generate token for an account that is not approved' });
        expect(prismaMock.user.update).not.toHaveBeenCalled();
      }
    );

    it.each([['approved'], [null]])('generates a token for an account with status %s', async (status) => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        plexUsername: 'testuser',
        deletedAt: null,
        registrationStatus: status,
      });
      prismaMock.user.update.mockResolvedValueOnce({});

      const { POST } = await import('@/app/api/admin/users/[id]/login-token/route');
      const response = await POST({} as any, { params: Promise.resolve({ id: 'u1' }) });

      expect(response.status).toBe(201);
      expect((await response.json()).fullToken).toBe('rmab_test_token');
      expect(prismaMock.user.findUnique.mock.calls[0][0].select).toMatchObject({
        registrationStatus: true,
      });
    });
  });

  describe('DELETE /api/admin/users/[id]/login-token', () => {
    it('revokes the login token for a user', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        plexUsername: 'testuser',
      });
      prismaMock.user.update.mockResolvedValueOnce({});

      const { DELETE } = await import('@/app/api/admin/users/[id]/login-token/route');
      const response = await DELETE({} as any, { params: Promise.resolve({ id: 'u1' }) });
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.success).toBe(true);
    });

    it('returns 404 when user does not exist', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      const { DELETE } = await import('@/app/api/admin/users/[id]/login-token/route');
      const response = await DELETE({} as any, { params: Promise.resolve({ id: 'missing' }) });
      const payload = await response.json();

      expect(response.status).toBe(404);
      expect(payload.error).toMatch(/User not found/);
    });
  });
});
