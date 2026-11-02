/**
 * Component: Admin API Tokens Route Tests
 * Documentation: documentation/testing.md
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

// Valid UUIDs for testing
const ADMIN_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const ADMIN2_ID = '33333333-3333-3333-3333-333333333333';
const NONEXISTENT_ID = '99999999-9999-9999-9999-999999999999';

let authRequest: any;

const prismaMock = createPrismaMock();
const requireAuthMock = vi.hoisted(() => vi.fn());
const requireAdminMock = vi.hoisted(() => vi.fn());
const checkApiTokenCreateRateLimitMock = vi.hoisted(() => vi.fn());
const generateApiTokenMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: requireAuthMock,
  requireAdmin: requireAdminMock,
}));

vi.mock('@/lib/utils/rateLimit', () => ({
  checkApiTokenCreateRateLimit: checkApiTokenCreateRateLimitMock,
}));

vi.mock('@/lib/utils/api-token', () => ({
  generateApiToken: generateApiTokenMock,
}));

describe('Admin API tokens routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = {
      user: { id: ADMIN_ID, username: 'admin', role: 'admin' },
      json: vi.fn(),
    };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
    requireAdminMock.mockImplementation((_req: any, handler: any) => handler());
    checkApiTokenCreateRateLimitMock.mockReturnValue({ allowed: true });
    generateApiTokenMock.mockReturnValue({
      fullToken: 'rmab_test_full_token',
      tokenHash: 'hashed_token',
      tokenPrefix: 'rmab_test',
    });
  });

  describe('POST /api/admin/api-tokens', () => {
    it('creates token for self with own role when no userId specified', async () => {
      authRequest.json.mockResolvedValueOnce({ name: 'Test Token' });

      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: ADMIN_ID,
        role: 'admin',
        plexUsername: 'admin',
      });
      prismaMock.apiToken.count.mockResolvedValueOnce(0);
      prismaMock.apiToken.create.mockResolvedValueOnce({
        id: 'token-1',
        name: 'Test Token',
        tokenPrefix: 'rmab_test',
        role: 'admin',
        expiresAt: null,
        createdAt: new Date(),
      });

      const { POST } = await import('@/app/api/admin/api-tokens/route');
      const response = await POST({} as any);
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(payload.token.role).toBe('admin');
      expect(payload.fullToken).toBe('rmab_test_full_token');
    });

    it('creates token for another user with their role', async () => {
      authRequest.json.mockResolvedValueOnce({
        name: 'Token for User',
        userId: USER_ID,
      });

      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: USER_ID,
        role: 'user',
        plexUsername: 'regularuser',
      });
      prismaMock.apiToken.count.mockResolvedValueOnce(0);
      prismaMock.apiToken.create.mockResolvedValueOnce({
        id: 'token-2',
        name: 'Token for User',
        tokenPrefix: 'rmab_test',
        role: 'user',
        expiresAt: null,
        createdAt: new Date(),
      });

      const { POST } = await import('@/app/api/admin/api-tokens/route');
      const response = await POST({} as any);
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(payload.token.role).toBe('user');
    });

    it('rejects role override when role differs from target user role', async () => {
      authRequest.json.mockResolvedValueOnce({
        name: 'Escalation Attempt',
        userId: USER_ID,
        role: 'admin', // Trying to give admin role to a regular user
      });

      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: USER_ID,
        role: 'user', // Target user is actually a regular user
        plexUsername: 'regularuser',
      });

      const { POST } = await import('@/app/api/admin/api-tokens/route');
      const response = await POST({} as any);
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload.error).toContain("must match target user's role");
    });

    it('rejects role downgrade when role differs from target user role', async () => {
      authRequest.json.mockResolvedValueOnce({
        name: 'Downgrade Attempt',
        userId: ADMIN2_ID,
        role: 'user', // Trying to give user role to an admin
      });

      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: ADMIN2_ID,
        role: 'admin', // Target user is actually an admin
        plexUsername: 'otheradmin',
      });

      const { POST } = await import('@/app/api/admin/api-tokens/route');
      const response = await POST({} as any);
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload.error).toContain("must match target user's role");
    });

    it('accepts role when it matches target user role', async () => {
      authRequest.json.mockResolvedValueOnce({
        name: 'Matching Role',
        userId: USER_ID,
        role: 'user', // Explicitly specifying role that matches
      });

      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: USER_ID,
        role: 'user',
        plexUsername: 'regularuser',
      });
      prismaMock.apiToken.count.mockResolvedValueOnce(0);
      prismaMock.apiToken.create.mockResolvedValueOnce({
        id: 'token-3',
        name: 'Matching Role',
        tokenPrefix: 'rmab_test',
        role: 'user',
        expiresAt: null,
        createdAt: new Date(),
      });

      const { POST } = await import('@/app/api/admin/api-tokens/route');
      const response = await POST({} as any);

      expect(response.status).toBe(201);
    });

    it('returns 404 when target user does not exist', async () => {
      authRequest.json.mockResolvedValueOnce({
        name: 'Token for Ghost',
        userId: NONEXISTENT_ID,
      });

      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      const { POST } = await import('@/app/api/admin/api-tokens/route');
      const response = await POST({} as any);
      const payload = await response.json();

      expect(response.status).toBe(404);
      expect(payload.error).toBe('Target user not found');
    });

    it.each([['pending_approval'], ['rejected']])(
      'refuses a %s target with 403 and creates no token',
      async (status) => {
        authRequest.json.mockResolvedValueOnce({ name: 'Token for New User', userId: USER_ID });
        prismaMock.user.findUnique.mockResolvedValueOnce({
          id: USER_ID,
          role: 'user',
          plexUsername: 'newuser',
          registrationStatus: status,
        });
        prismaMock.apiToken.count.mockResolvedValue(0);

        const { POST } = await import('@/app/api/admin/api-tokens/route');
        const response = await POST({} as any);

        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({
          error: 'Cannot create a token for an account that is not approved',
        });
        expect(prismaMock.apiToken.create).not.toHaveBeenCalled();
      }
    );

    it.each([['approved'], [null]])('creates a token for a target with status %s', async (status) => {
      authRequest.json.mockResolvedValueOnce({ name: 'Token for User', userId: USER_ID });
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: USER_ID,
        role: 'user',
        plexUsername: 'regularuser',
        registrationStatus: status,
      });
      prismaMock.apiToken.count.mockResolvedValueOnce(0);
      prismaMock.apiToken.create.mockResolvedValueOnce({
        id: 'token-3',
        name: 'Token for User',
        tokenPrefix: 'rmab_test',
        role: 'user',
        expiresAt: null,
        createdAt: new Date(),
      });

      const { POST } = await import('@/app/api/admin/api-tokens/route');
      const response = await POST({} as any);

      expect(response.status).toBe(201);
      expect(prismaMock.user.findUnique.mock.calls[0][0].select).toMatchObject({
        registrationStatus: true,
      });
    });

    it('returns 429 when rate limited', async () => {
      checkApiTokenCreateRateLimitMock.mockReturnValueOnce({
        allowed: false,
        retryAfterSeconds: 60,
      });

      authRequest.json.mockResolvedValueOnce({ name: 'Rate Limited Token' });

      const { POST } = await import('@/app/api/admin/api-tokens/route');
      const response = await POST({} as any);

      expect(response.status).toBe(429);
      expect(response.headers.get('Retry-After')).toBe('60');
    });
  });
});
