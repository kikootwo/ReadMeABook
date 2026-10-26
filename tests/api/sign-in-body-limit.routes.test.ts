/**
 * Component: Sign-in Routes Request Size Limit Tests (64 KB tier)
 * Documentation: documentation/backend/validation.md
 *
 * Every route in the sign-in tier rejects a real request body just over 64 KB with a 413,
 * and reads a body of exactly 64 KB, so a route that drops the tier (1 MB default) fails here.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createPrismaMock } from '../helpers/prisma';

/** The sign-in tier (AUTH_JSON_BODY_LIMIT_BYTES); checked against the constant below. */
const AUTH_JSON_BODY_LIMIT_BYTES = 64 * 1024;

const prismaMock = createPrismaMock();

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('bcrypt', () => ({ default: { compare: vi.fn(async () => false) } }));
vi.mock('@/lib/utils/jwt', () => ({
  generateAccessToken: vi.fn(() => 'access'),
  generateRefreshToken: vi.fn(() => 'refresh'),
  verifyRefreshToken: vi.fn(() => null),
}));
vi.mock('@/lib/services/encryption.service', () => ({
  getEncryptionService: () => ({ encrypt: vi.fn(), decrypt: vi.fn() }),
}));
vi.mock('@/lib/services/auth/LocalAuthProvider', () => ({
  LocalAuthProvider: class {
    handleCallback = vi.fn(async () => ({ success: false, error: 'Invalid credentials' }));
    register = vi.fn(async () => ({ success: false, error: 'Registration failed' }));
  },
}));
vi.mock('@/lib/integrations/plex.service', () => ({ getPlexService: () => ({}) }));
vi.mock('@/lib/services/auth-token-cache.service', () => ({
  getAuthTokenCache: () => ({ get: vi.fn(() => null), set: vi.fn(), delete: vi.fn() }),
}));
vi.mock('@/lib/services/auth/plex-identity', () => ({ canSignInAsPlexIdentity: vi.fn(() => false) }));
vi.mock('@/lib/utils/rateLimit', () => ({
  checkTokenLoginRateLimit: vi.fn(() => ({ allowed: true, retryAfterSeconds: 0 })),
}));

const SIGN_IN_ROUTES: Array<[path: string, load: () => Promise<{ POST: (req: NextRequest) => Promise<Response> }>]> = [
  ['/api/auth/admin/login', () => import('@/app/api/auth/admin/login/route')],
  ['/api/auth/local/login', () => import('@/app/api/auth/local/login/route')],
  ['/api/auth/register', () => import('@/app/api/auth/register/route')],
  ['/api/auth/token/login', () => import('@/app/api/auth/token/login/route')],
  ['/api/auth/refresh', () => import('@/app/api/auth/refresh/route')],
  ['/api/auth/plex/switch-profile', () => import('@/app/api/auth/plex/switch-profile/route')],
];

/** A valid JSON body of exactly `bytes` bytes. */
function bodyOfSize(bytes: number): string {
  const shell = JSON.stringify({ username: 'user', password: 'pass', refreshToken: 'r', token: 't', pinId: 'p', pad: '' });
  const body = `${shell.slice(0, -2)}${'x'.repeat(bytes - shell.length)}"}`;
  expect(Buffer.byteLength(body)).toBe(bytes);
  return body;
}

let ip = 0;
function post(path: string, body: string) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${++ip}` },
  });
}

describe('sign-in routes: request size limit', () => {
  beforeEach(() => {
    delete process.env.DISABLE_LOCAL_LOGIN;
  });

  it('matches the 64 KB tier constant', async () => {
    const { AUTH_JSON_BODY_LIMIT_BYTES: tier } = await import('@/lib/utils/request-body');
    expect(tier).toBe(AUTH_JSON_BODY_LIMIT_BYTES);
  });

  it.each(SIGN_IN_ROUTES)('%s returns 413 for a body one byte over 64 KB', async (path, load) => {
    const { POST } = await load();

    const response = await POST(post(path, bodyOfSize(AUTH_JSON_BODY_LIMIT_BYTES + 1)));

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'PayloadTooLarge', message: 'Request body is larger than 64 KB' });
  });

  it.each(SIGN_IN_ROUTES)('%s reads a body at exactly 64 KB', async (path, load) => {
    const { POST } = await load();

    const response = await POST(post(path, bodyOfSize(AUTH_JSON_BODY_LIMIT_BYTES)));

    expect(response.status).not.toBe(413);
  });
});
