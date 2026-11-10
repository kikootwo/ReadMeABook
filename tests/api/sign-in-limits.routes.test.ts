/**
 * Component: Sign-in Attempt Limit Tests (admin and local sign-in routes)
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

const ACCOUNT_TEXT =
  "Too many sign-in attempts for this account. Try again in 15 minutes, or sign in from a browser you've used with this account before.";
const ADDRESS_TEXT = 'Too many sign-in attempts from your network. Try again in 15 minutes.';

describe('sign-in attempt limits', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-access-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
  });

  beforeEach(async () => {
    delete process.env.DISABLE_LOCAL_LOGIN;
    resetFixture();
    (await import('@/lib/utils/rateLimit'))._resetBuckets();
    addAccount('admin', { role: 'admin', isSetupAdmin: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(SIGN_IN_ROUTES)('%s: 25 parallel wrong attempts get exactly 10 password checks and 15 refusals', async (route) => {
    const pending: Array<() => void> = [];
    bcryptMock.compare.mockImplementation(
      () => new Promise<boolean>((resolve) => pending.push(() => resolve(false)))
    );

    const attempts = Array.from({ length: 25 }, () => signIn(route, 'admin', WRONG_PASSWORD));
    // Let every request run up to its password check (or its refusal) before any check finishes
    await vi.waitFor(() => expect(pending.length).toBeGreaterThanOrEqual(10));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(bcryptMock.compare).toHaveBeenCalledTimes(10);
    pending.forEach((release) => release());

    const results = await Promise.all(attempts);
    expect(results.filter((r) => r.status === 401)).toHaveLength(10);
    expect(results.filter((r) => r.status === 429)).toHaveLength(15);
    expect(bcryptMock.compare).toHaveBeenCalledTimes(10);
  });

  it('shares one account count between both routes and normalises the name', async () => {
    for (let i = 0; i < 5; i += 1) expect((await signIn('admin', ' Admin ', WRONG_PASSWORD)).status).toBe(401);
    for (let i = 0; i < 5; i += 1) expect((await signIn('local', 'admin', WRONG_PASSWORD)).status).toBe(401);

    for (const route of SIGN_IN_ROUTES) {
      const comparesBefore = bcryptMock.compare.mock.calls.length;
      const refused = await signIn(route, 'ADMIN', RIGHT_PASSWORD);
      expect(refused.status).toBe(429);
      expect(bcryptMock.compare.mock.calls.length).toBe(comparesBefore);
    }
  });

  it.each(SIGN_IN_ROUTES)('%s: at the account limit an unknown browser is refused even with the right password', async (route) => {
    for (let i = 0; i < 10; i += 1) await signIn(route, 'admin', WRONG_PASSWORD, { ip: `198.51.100.${i + 1}` });
    const comparesBefore = bcryptMock.compare.mock.calls.length;

    const refused = await signIn(route, 'admin', RIGHT_PASSWORD, { ip: '192.0.2.200' });

    expect(refused.status).toBe(429);
    expect(refused.body).toEqual({ error: ACCOUNT_TEXT });
    expect(refused.retryAfter).toBe('900');
    expect(refused.setCookie).toBeNull();
    expect(bcryptMock.compare.mock.calls.length).toBe(comparesBefore);
  });

  it.each(SIGN_IN_ROUTES)('%s: a right password gives back its own slot only', async (route) => {
    for (let i = 0; i < 9; i += 1) await signIn(route, 'admin', WRONG_PASSWORD);
    expect((await signIn(route, 'admin', RIGHT_PASSWORD)).status).toBe(200);

    expect((await signIn(route, 'admin', WRONG_PASSWORD)).status).toBe(401);
    expect((await signIn(route, 'admin', WRONG_PASSWORD)).status).toBe(429);
  });

  it.each(SIGN_IN_ROUTES)('%s: 20 attempts from one address pause that address for every name', async (route) => {
    for (let i = 0; i < 20; i += 1) {
      expect((await signIn(route, `name-${i}`, WRONG_PASSWORD, { ip: '203.0.113.50' })).status).toBe(401);
    }

    const refused = await signIn(route, 'name-21', WRONG_PASSWORD, { ip: '203.0.113.50' });
    expect(refused.status).toBe(429);
    expect(refused.body).toEqual({ error: ADDRESS_TEXT });

    const comparesBefore = bcryptMock.compare.mock.calls.length;
    expect((await signIn(route, 'name-21', WRONG_PASSWORD, { ip: '203.0.113.51' })).status).toBe(401);
    expect(bcryptMock.compare.mock.calls.length).toBe(comparesBefore + 1);
  });

  it.each(SIGN_IN_ROUTES)('%s: unknown, existing and deleted names answer and count the same way', async (route) => {
    addAccount('gone', { deletedAt: new Date('2026-01-01T00:00:00Z') });
    const runs: Record<string, Array<{ status: number; body: unknown; retryAfter: string | null }>> = {};

    for (const name of ['admin', 'nobody', 'gone']) {
      runs[name] = [];
      for (let i = 0; i < 11; i += 1) {
        const comparesBefore = bcryptMock.compare.mock.calls.length;
        const result = await signIn(route, name, WRONG_PASSWORD, { ip: `198.51.100.${i + 1}` });
        runs[name].push({ status: result.status, body: result.body, retryAfter: result.retryAfter });
        expect(bcryptMock.compare.mock.calls.length - comparesBefore).toBe(i < 10 ? 1 : 0);
      }
    }

    expect(runs.nobody).toEqual(runs.admin);
    expect(runs.gone).toEqual(runs.admin);
    expect(runs.admin.slice(0, 10).every((r) => r.status === 401)).toBe(true);
    expect(runs.admin[10].status).toBe(429);
  });

  it('local route: pending and rejected accounts answer a wrong password like any other account', async () => {
    addAccount('waiting', { registrationStatus: 'pending_approval' });
    addAccount('refused', { registrationStatus: 'rejected' });
    const generic = { status: 401, body: { error: 'Invalid username or password' } };

    expect(await signIn('local', 'waiting', WRONG_PASSWORD)).toMatchObject(generic);
    expect(await signIn('local', 'refused', WRONG_PASSWORD)).toMatchObject(generic);

    const pending = await signIn('local', 'waiting', RIGHT_PASSWORD);
    expect(pending.status).toBe(200);
    expect(pending.body).toMatchObject({ success: false, pendingApproval: true });
    const rejected = await signIn('local', 'refused', RIGHT_PASSWORD);
    expect(rejected).toMatchObject({ status: 401, body: { error: 'Account has been rejected' } });
    expect(pending.setCookie).toBeNull();
    expect(rejected.setCookie).toBeNull();
  });

  it('uses a cost-10 dummy hash that never matches', async () => {
    const realBcrypt = await vi.importActual<typeof import('bcrypt')>('bcrypt');
    const { DUMMY_PASSWORD_HASH } = await import('@/lib/services/auth/signin-guard');
    expect(realBcrypt.getRounds(DUMMY_PASSWORD_HASH)).toBe(10);
    expect(await realBcrypt.compare('', DUMMY_PASSWORD_HASH)).toBe(false);
  });

  it.each(SIGN_IN_ROUTES)('%s: a stored hash that cannot be read runs the dummy check and is counted', async (route) => {
    addAccount('broken', { authToken: 'not-encrypted' });
    const result = await signIn(route, 'broken', RIGHT_PASSWORD);
    expect(result.status).toBe(401);
    expect(bcryptMock.compare).toHaveBeenCalledTimes(1);
    expect(realCompares()).toBe(0);
    expect(loggerMock.error).toHaveBeenCalledWith('Password verification failed', expect.any(Object));

    for (let i = 0; i < 9; i += 1) await signIn(route, 'broken', RIGHT_PASSWORD);
    expect((await signIn(route, 'broken', RIGHT_PASSWORD)).status).toBe(429);
  });

  it('LocalAuthProvider refuses a sign-in without a guard, before any lookup or check', async () => {
    const { LocalAuthProvider } = await import('@/lib/services/auth/LocalAuthProvider');
    const result = await new LocalAuthProvider().handleCallback({ username: 'admin', password: RIGHT_PASSWORD });

    expect(result).toEqual({ success: false, error: 'Invalid username or password' });
    expect(result.tokens).toBeUndefined();
    expect(bcryptMock.compare).not.toHaveBeenCalled();
    expect(loggerMock.error).toHaveBeenCalled();
  });

  it.each([
    [841, '1 minute', '59'],
    [839, '2 minutes', '61'],
    [0, '15 minutes', '900'],
  ])('after %d seconds the refusal says %s', async (elapsedSeconds, wait, retryAfter) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-09T12:00:00Z'));
    for (let i = 0; i < 10; i += 1) await signIn('admin', 'admin', WRONG_PASSWORD);
    vi.setSystemTime(new Date(Date.parse('2026-11-09T12:00:00Z') + elapsedSeconds * 1000));

    const refused = await signIn('admin', 'admin', WRONG_PASSWORD);
    expect(refused.body.error).toContain(`Try again in ${wait}`);
    expect(refused.retryAfter).toBe(retryAfter);
  });

  it.each(SIGN_IN_ROUTES)('%s: logs one pause per window, cuts long names, and never logs the password', async (route) => {
    const longName = 'n'.repeat(5000);
    for (let i = 0; i < 25; i += 1) await signIn(route, longName, WRONG_PASSWORD, { ip: `198.51.100.${i + 1}` });

    const pauses = loggerMock.warn.mock.calls.filter(([message]) => message === 'Sign-in attempts paused for an account');
    expect(pauses).toHaveLength(1);
    expect(pauses[0][1]).toEqual({ username: 'n'.repeat(64), minutes: 15 });

    const allLogged = JSON.stringify(
      [loggerMock.debug, loggerMock.info, loggerMock.warn, loggerMock.error].flatMap((fn) => fn.mock.calls)
    );
    expect(allLogged).not.toContain(WRONG_PASSWORD);
    expect(allLogged).not.toContain('n'.repeat(65));
  });

  it.each(SIGN_IN_ROUTES)('%s: a non-string name or password is a 400 with nothing counted', async (route) => {
    const { _getBucketCount } = await import('@/lib/utils/rateLimit');
    for (const [username, password] of [
      [['admin'], RIGHT_PASSWORD],
      ['admin', { value: RIGHT_PASSWORD }],
      [12345, RIGHT_PASSWORD],
    ] as Array<[unknown, unknown]>) {
      const result = await signIn(route as SignInRoute, username, password);
      expect(result.status).toBe(400);
    }
    expect(_getBucketCount()).toBe(0);
    expect(bcryptMock.compare).not.toHaveBeenCalled();
  });
});
