/**
 * Component: Known-Browser Cookie Tests (admin and local sign-in routes)
 * Documentation: documentation/backend/services/auth.md
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RIGHT_PASSWORD,
  SIGN_IN_ROUTES,
  WRONG_PASSWORD,
  addAccount,
  bcryptMock,
  loggerMock,
  realCompares,
  resetFixture,
  signIn,
  type AccountRow,
  type SignInRoute,
} from '../helpers/sign-in-fixture';

vi.mock('@/lib/db', async () => ({ prisma: (await import('../helpers/sign-in-fixture')).prismaMock }));
vi.mock('bcrypt', async () => {
  const { bcryptMock: mock } = await import('../helpers/sign-in-fixture');
  return { default: mock, ...mock };
});
vi.mock('@/lib/services/encryption.service', async () => {
  const { encryptionMock } = await import('../helpers/sign-in-fixture');
  return { getEncryptionService: () => encryptionMock };
});
vi.mock('@/lib/utils/logger', async () => {
  const { loggerMock: mock } = await import('../helpers/sign-in-fixture');
  return { RMABLogger: { create: () => mock } };
});
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => ({ get: vi.fn() }) }));

const NINETY_DAYS = 90 * 24 * 60 * 60;

let admin: AccountRow;

/** Sign in once with the right password and return the cookie this browser was given */
async function knownCookie(route: SignInRoute = 'local', username = 'admin'): Promise<string> {
  const result = await signIn(route, username, RIGHT_PASSWORD);
  expect(result.status).toBe(200);
  expect(result.knownBrowserCookie).toBeTruthy();
  return result.knownBrowserCookie!;
}

async function fillAccount(username: string) {
  for (let i = 0; i < 10; i += 1) await signIn('admin', username, WRONG_PASSWORD, { ip: `198.51.100.${i + 1}` });
}

describe('known-browser cookie', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-access-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
  });

  beforeEach(async () => {
    delete process.env.DISABLE_LOCAL_LOGIN;
    resetFixture();
    (await import('@/lib/utils/rateLimit'))._resetBuckets();
    admin = addAccount('admin', { role: 'admin', isSetupAdmin: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(SIGN_IN_ROUTES)('%s: a known browser signs in while the account is at its limit; an unknown one is refused', async (route) => {
    const cookie = await knownCookie(route);
    await fillAccount('admin');

    const known = await signIn(route, 'admin', RIGHT_PASSWORD, { cookie });
    expect(known.status).toBe(200);
    expect(known.body).toMatchObject({ success: true });

    const unknown = await signIn(route, 'admin', RIGHT_PASSWORD);
    expect(unknown.status).toBe(429);
  });

  it('works on both routes: a cookie from one route is honoured on the other', async () => {
    const cookie = await knownCookie('local');
    await fillAccount('admin');
    expect((await signIn('admin', 'admin', RIGHT_PASSWORD, { cookie })).status).toBe(200);
  });

  it("never exempts another account: account A's cookie on account B at its limit is refused", async () => {
    addAccount('bob');
    const cookieA = await knownCookie('local', 'admin');
    await fillAccount('bob');
    const comparesBefore = bcryptMock.compare.mock.calls.length;

    const refused = await signIn('local', 'bob', RIGHT_PASSWORD, { cookie: cookieA });
    expect(refused.status).toBe(429);
    expect(bcryptMock.compare.mock.calls.length).toBe(comparesBefore);
  });

  it('stops working when the stored password hash changes', async () => {
    const cookie = await knownCookie();
    admin.authToken = `enc:hash-${admin.id}-changed`;
    await fillAccount('admin');

    expect((await signIn('local', 'admin', RIGHT_PASSWORD, { cookie })).status).toBe(429);
  });

  it.each(SIGN_IN_ROUTES)('%s: stops working when the account is deleted (generic answer, dummy check)', async (route) => {
    const cookie = await knownCookie();
    admin.deletedAt = new Date();
    bcryptMock.compare.mockClear();

    const result = await signIn(route, 'admin', RIGHT_PASSWORD, { cookie });
    expect(result.status).toBe(401);
    expect(bcryptMock.compare).toHaveBeenCalledTimes(1);
    expect(realCompares()).toBe(0);
    expect(result.setCookie).toBeNull();
  });

  it.each(SIGN_IN_ROUTES)('%s: sets the cookie on success with the agreed attributes', async (route) => {
    vi.stubEnv('NODE_ENV', 'production');
    const plain = await signIn(route, 'admin', RIGHT_PASSWORD);
    expect(plain.setCookie).toMatch(/^rmab_known_browser=v1\.user-admin\.\d+\.[A-Za-z0-9_-]{43};/);
    expect(plain.setCookie).toContain('HttpOnly');
    expect(plain.setCookie).toMatch(/SameSite=strict/i);
    expect(plain.setCookie).toContain('Path=/api/auth');
    expect(plain.setCookie).toContain('Max-Age=7776000');
    expect(plain.setCookie).not.toMatch(/Secure/i);

    const http = await signIn(route, 'admin', RIGHT_PASSWORD, { proto: 'http' });
    expect(http.setCookie).not.toMatch(/Secure/i);

    const https = await signIn(route, 'admin', RIGHT_PASSWORD, { proto: 'https' });
    expect(https.setCookie).toMatch(/; Secure/i);
  });

  it.each(SIGN_IN_ROUTES)('%s: sets no cookie on a wrong password, pending, rejected or refused attempt', async (route) => {
    addAccount('waiting', { registrationStatus: 'pending_approval' });
    addAccount('refused', { registrationStatus: 'rejected' });

    expect((await signIn(route, 'admin', WRONG_PASSWORD)).setCookie).toBeNull();
    const pending = await signIn(route, 'waiting', RIGHT_PASSWORD);
    expect(pending.body).toMatchObject({ pendingApproval: true });
    expect(pending.setCookie).toBeNull();
    const rejected = await signIn(route, 'refused', RIGHT_PASSWORD);
    expect(rejected.status).toBe(401);
    expect(rejected.setCookie).toBeNull();

    await fillAccount('admin');
    const refused = await signIn(route, 'admin', RIGHT_PASSWORD);
    expect(refused.status).toBe(429);
    expect(refused.setCookie).toBeNull();
  });

  it('is not a session token, and a session token is not a known-browser cookie', async () => {
    const cookie = await knownCookie();
    const { verifyAccessToken, generateAccessToken } = await import('@/lib/utils/jwt');
    expect(verifyAccessToken(cookie)).toBeNull();

    const sessionToken = generateAccessToken({ sub: admin.id, plexId: admin.plexId, username: 'admin', role: 'admin' });
    await fillAccount('admin');
    expect((await signIn('local', 'admin', RIGHT_PASSWORD, { cookie: sessionToken })).status).toBe(429);
  });

  it.each(SIGN_IN_ROUTES)('%s: a known browser is counted in its known-browser slot and leaves the account count alone', async (route) => {
    const cookie = await knownCookie(route);
    for (let i = 0; i < 10; i += 1) {
      expect((await signIn(route, 'admin', WRONG_PASSWORD, { cookie })).status).toBe(401);
    }
    expect(loggerMock.warn).not.toHaveBeenCalled();

    // Its attempts were never charged to the account: an unknown browser is still checked
    const comparesBefore = bcryptMock.compare.mock.calls.length;
    expect((await signIn(route, 'admin', WRONG_PASSWORD)).status).toBe(401);
    expect(bcryptMock.compare.mock.calls.length).toBe(comparesBefore + 1);
  });

  it.each(SIGN_IN_ROUTES)('%s: a known browser is checked even when its address is at its limit', async (route) => {
    const cookie = await knownCookie(route);
    for (let i = 0; i < 20; i += 1) await signIn(route, `name-${i}`, WRONG_PASSWORD);
    expect((await signIn(route, 'someone', WRONG_PASSWORD)).status).toBe(429);

    expect((await signIn(route, 'admin', RIGHT_PASSWORD, { cookie })).status).toBe(200);
  });

  it('renews the cookie on each full sign-in', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-01T00:00:00Z'));
      const first = await knownCookie();
      vi.setSystemTime(new Date('2026-11-02T00:00:00Z'));
      const renewed = await signIn('local', 'admin', RIGHT_PASSWORD, { cookie: first });
      expect(renewed.knownBrowserCookie).toBeTruthy();
      expect(renewed.knownBrowserCookie).not.toBe(first);
      expect(Number(renewed.knownBrowserCookie!.split('.')[2]) - Number(first.split('.')[2])).toBe(24 * 60 * 60);
    } finally {
      vi.useRealTimers();
    }
  });

  describe('knownBrowserBucket', () => {
    it('treats every malformed, tampered or out-of-date value as unknown without throwing', async () => {
      const { knownBrowserBucket } = await import('@/lib/services/auth/known-browser');
      const cookie = await knownCookie();
      const [, userId, issuedAt, mac] = cookie.split('.');
      const now = Number(issuedAt) * 1000;
      const flip = (text: string, at: number) =>
        `${text.slice(0, at)}${text[at] === 'A' ? 'B' : 'A'}${text.slice(at + 1)}`;

      expect(knownBrowserBucket(cookie, admin, now)).toMatch(/^[0-9a-f]{32}$/);
      const unknown = [
        `v1.${userId}.${issuedAt}.${flip(mac, 5)}`,
        `v1.${userId}.${issuedAt}.${mac.slice(0, 40)}`,
        `v1.${userId}.${issuedAt}.${mac}AAAA`,
        `v1.${userId}.${issuedAt}.${Buffer.alloc(31).toString('base64url')}`,
        `v2.${userId}.${issuedAt}.${mac}`,
        `v1.${userId}.${issuedAt}`,
        `v1.${userId}.${issuedAt}.${mac}.extra`,
        `${cookie}${'A'.repeat(300)}`,
        `v1.${userId}.${Number(issuedAt) - NINETY_DAYS - 1}.${mac}`,
        `v1.${userId}.${Number(issuedAt) + 3600}.${mac}`,
        `v1.${userId}.12ab.${mac}`,
        `v1.other-user.${issuedAt}.${mac}`,
        '',
        'garbage',
      ];
      for (const value of unknown) {
        expect(() => knownBrowserBucket(value, admin, now)).not.toThrow();
        expect(knownBrowserBucket(value, admin, now)).toBeNull();
      }
    });

    it('rejects a valid cookie once it is 90 days old, or for a missing account', async () => {
      const { knownBrowserBucket } = await import('@/lib/services/auth/known-browser');
      const cookie = await knownCookie();
      const issuedAtMs = Number(cookie.split('.')[2]) * 1000;

      expect(knownBrowserBucket(cookie, admin, issuedAtMs + NINETY_DAYS * 1000)).not.toBeNull();
      expect(knownBrowserBucket(cookie, admin, issuedAtMs + (NINETY_DAYS + 1) * 1000)).toBeNull();
      expect(knownBrowserBucket(cookie, null, issuedAtMs)).toBeNull();
      expect(knownBrowserBucket(cookie, { id: admin.id, authToken: null }, issuedAtMs)).toBeNull();
    });

    it('keys the bucket on the recomputed MAC, so encoding variants share one bucket', async () => {
      const { knownBrowserBucket } = await import('@/lib/services/auth/known-browser');
      const cookie = await knownCookie();
      const [, userId, issuedAt, mac] = cookie.split('.');
      const now = Number(issuedAt) * 1000;
      const bucket = knownBrowserBucket(cookie, admin, now);
      expect(bucket).not.toBeNull();

      // Same 32 bytes: only the unused low bits of the last base64url character differ
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
      const index = alphabet.indexOf(mac[42]);
      const variant = `${mac.slice(0, 42)}${alphabet[(index & ~3) | ((index + 1) & 3)]}`;
      expect(variant).not.toBe(mac);
      expect(Buffer.from(variant, 'base64url').equals(Buffer.from(mac, 'base64url'))).toBe(true);
      expect(knownBrowserBucket(`v1.${userId}.${issuedAt}.${variant}`, admin, now)).toBe(bucket);
      expect(knownBrowserBucket(`v1.${userId}.${issuedAt}.${mac}=`, admin, now)).toBeNull();
    });
  });
});
