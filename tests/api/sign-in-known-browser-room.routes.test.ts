/**
 * Component: Sign-in Limit Tests: known-browser room, JSON-only bodies, busy answer
 * Documentation: documentation/backend/services/auth.md
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import {
  RIGHT_PASSWORD,
  SIGN_IN_ROUTES,
  WRONG_PASSWORD,
  addAccount,
  loadRoute,
  realCompares,
  resetFixture,
  signIn,
  type AccountRow,
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

const ACCOUNT_TEXT = 'Too many sign-in attempts for this account.';

let admin: AccountRow;

async function limiter() {
  return import('@/lib/utils/rateLimit');
}

/** Fill a namespace with entries at or past half their limit, so no new key fits */
async function fillNamespace(namespace: 'signin-known-browser' | 'signin-account') {
  const { RATE_LIMITS, reserve } = await limiter();
  const { limit, maxEntries } = RATE_LIMITS[namespace];
  for (let i = 0; i < maxEntries; i += 1) {
    for (let n = 0; n < limit / 2; n += 1) reserve([{ namespace, key: `filler-${i}` }]);
  }
}

/** A known-browser cookie for the account, issued `secondsAgo` seconds ago */
async function cookieIssuedAgo(account: AccountRow, secondsAgo: number): Promise<string> {
  const { setKnownBrowserCookie } = await import('@/lib/services/auth/known-browser');
  const response = NextResponse.json({});
  setKnownBrowserCookie(response, new NextRequest('http://localhost/api/auth/local/login'), account, Date.now() - secondsAgo * 1000);
  return response.cookies.get('rmab_known_browser')!.value;
}

describe('sign-in limits: known-browser room, JSON-only bodies, busy answer', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-access-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
  });

  beforeEach(async () => {
    delete process.env.DISABLE_LOCAL_LOGIN;
    resetFixture();
    (await limiter())._resetBuckets();
    admin = addAccount('admin', { role: 'admin', isSetupAdmin: true });
  });

  it.each(SIGN_IN_ROUTES)('%s: a known browser whose table has no room is counted like any other browser', async (route) => {
    const cookie = await cookieIssuedAgo(admin, 60);
    await fillNamespace('signin-known-browser');

    const known = await signIn(route, 'admin', RIGHT_PASSWORD, { cookie });
    expect(known.status).toBe(200);

    // With the account at its limit as well, it gets the account answer, not a busy one
    for (let i = 0; i < 10; i += 1) await signIn(route, 'admin', WRONG_PASSWORD, { ip: `198.51.100.${i + 1}` });
    const refused = await signIn(route, 'admin', RIGHT_PASSWORD, { cookie });
    expect(refused.status).toBe(429);
    expect(String(refused.body.error)).toContain(ACCOUNT_TEXT);
  });

  it('gives one account at most 4 known-browser entries, however many browsers it has', async () => {
    const { SLOTS_PER_ACCOUNT, knownBrowserBucket } = await import('@/lib/services/auth/known-browser');
    const { _getBucketCount } = await limiter();

    const cookies = await Promise.all(Array.from({ length: 24 }, (_, i) => cookieIssuedAgo(admin, i + 1)));
    const buckets = new Set(cookies.map((cookie) => knownBrowserBucket(cookie, admin)));
    expect(buckets.has(null)).toBe(false);
    expect(buckets.size).toBeLessThanOrEqual(4);
    expect(buckets.size).toBeGreaterThan(1);

    for (const cookie of cookies) {
      expect((await signIn('local', 'admin', RIGHT_PASSWORD, { cookie })).status).toBe(200);
    }
    expect(_getBucketCount('signin-known-browser')).toBeLessThanOrEqual(4);
    expect(SLOTS_PER_ACCOUNT).toBe(4);
  });

  it('gives an account fresh known-browser entries after its password changes', async () => {
    const { knownBrowserBucket } = await import('@/lib/services/auth/known-browser');
    const before = knownBrowserBucket(await cookieIssuedAgo(admin, 1), admin);
    admin.authToken = `enc:hash-${admin.id}-changed`;
    const after = knownBrowserBucket(await cookieIssuedAgo(admin, 1), admin);

    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
  });

  describe.each(SIGN_IN_ROUTES)('%s route: JSON bodies only', (route) => {
    const path = route === 'admin' ? '/api/auth/admin/login' : '/api/auth/local/login';
    const send = async (contentType: string | null, body: string) => {
      const POST = await loadRoute(route);
      const headers: Record<string, string> = { 'x-forwarded-for': '203.0.113.7' };
      if (contentType) headers['content-type'] = contentType;
      return POST(new NextRequest(`http://localhost${path}`, { method: 'POST', body, headers }));
    };
    const json = JSON.stringify({ username: 'admin', password: RIGHT_PASSWORD });

    it.each([
      ['text/plain', 'text/plain', json],
      ['form', 'application/x-www-form-urlencoded', `username=admin&password=${encodeURIComponent(RIGHT_PASSWORD)}`],
      ['multipart', 'multipart/form-data; boundary=x', json],
      ['no Content-Type', null, json],
    ])('answers 415 to a %s body, with no check, no count and no cookie', async (_label, contentType, body) => {
      const { _getBucketCount } = await limiter();
      const response = await send(contentType, body);

      expect(response.status).toBe(415);
      expect(await response.json()).toEqual({ error: 'UnsupportedMediaType', message: 'Content-Type must be application/json' });
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(realCompares()).toBe(0);
      expect(_getBucketCount()).toBe(0);
    });

    it('accepts application/json with a charset', async () => {
      const response = await send('Application/JSON; charset=utf-8', json);
      expect(response.status).toBe(200);
      expect(response.headers.get('set-cookie')).toMatch(/rmab_known_browser=/);
    });
  });

  it.each(SIGN_IN_ROUTES)('%s: a full account table answers that sign-in is busy, not that the account is limited', async (route) => {
    await fillNamespace('signin-account');

    const refused = await signIn(route, 'newcomer', RIGHT_PASSWORD);

    expect(refused.status).toBe(429);
    expect(refused.body.error).toMatch(/^Sign-in is busy\. Try again in \d+ minutes?\.$/);
    expect(Number(refused.retryAfter)).toBeGreaterThan(0);
    expect(realCompares()).toBe(0);
  });
});
