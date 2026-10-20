/**
 * Component: OIDC Sign-in Account Tests
 * Documentation: documentation/backend/services/auth.md
 *
 * OIDC sign-in writes the user row keyed on the IdP subject. It may only sign in to, and
 * update, an OIDC account's row. An in-memory users table stands in for Prisma so each
 * test can check which row was written and that others are unchanged.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const users = vi.hoisted(() => new Map<string, Record<string, any>>());
const prismaMock = vi.hoisted(() => ({
  user: {
    count: vi.fn(async () => users.size),
    findUnique: vi.fn(async ({ where }: any) => (users.has(where.plexId) ? { ...users.get(where.plexId) } : null)),
    findFirst: vi.fn(async ({ where }: any) => {
      for (const row of users.values()) {
        if (row.oidcSubject === where.oidcSubject && row.authProvider === where.authProvider) return { ...row };
      }
      return null;
    }),
    create: vi.fn(async ({ data }: any) => {
      if (users.has(data.plexId)) throw new Error('Unique constraint failed on plexId');
      const row = { id: `id-${data.plexId}`, ...data };
      users.set(data.plexId, row);
      return { ...row };
    }),
    upsert: vi.fn(async ({ where, create, update }: any) => {
      const existing = users.get(where.plexId);
      const row = existing ? { ...existing, ...update } : { id: `id-${where.plexId}`, ...create };
      users.set(where.plexId, row);
      return { ...row };
    }),
  },
  scheduledJob: { findFirst: vi.fn(async () => null) },
  configuration: { upsert: vi.fn() },
}));
const config = vi.hoisted(() => ({ values: {} as Record<string, string | null> }));
const clientMock = vi.hoisted(() => ({ authorizationUrl: vi.fn(() => 'https://issuer/auth'), callback: vi.fn(), userinfo: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => ({ get: async (key: string) => config.values[key] ?? null }) }));
vi.mock('@/lib/services/encryption.service', () => ({ getEncryptionService: () => ({ encrypt: (v: string) => v, decrypt: (v: string) => v }) }));
vi.mock('@/lib/services/scheduler.service', () => ({ getSchedulerService: () => ({ triggerJobNow: vi.fn() }) }));
vi.mock('@/lib/utils/jwt', () => ({ generateAccessToken: () => 'access-token', generateRefreshToken: () => 'refresh-token' }));
vi.mock('@/lib/utils/url', () => ({ getBaseUrl: () => 'http://localhost:3030' }));
vi.mock('openid-client', () => ({
  Issuer: { discover: vi.fn(async () => ({ Client: class { constructor() { return clientMock; } } })) },
  generators: { state: () => 'state-1', nonce: () => 'nonce-1', codeVerifier: () => 'verifier-1', codeChallenge: () => 'challenge-1' },
}));

const BASE_CONFIG = {
  'oidc.issuer_url': 'https://issuer',
  'oidc.client_id': 'client',
  'oidc.client_secret': 'secret',
  'oidc.provider_name': 'TestIdP',
  'oidc.access_control_method': 'open',
};

// Rows as each sign-in path creates them
const LOCAL_ROW = { id: 'row-l', plexId: 'local-admin', plexUsername: 'admin', role: 'admin', authProvider: 'plex', oidcSubject: null };
const PLEX_ROW = { id: 'row-p', plexId: '1001', plexUsername: 'owner', role: 'admin', authProvider: null, oidcSubject: null };
const OIDC_ROW = { id: 'row-o', plexId: 'sub-carol', plexUsername: 'carol', role: 'user', authProvider: 'oidc', oidcSubject: 'sub-carol', registrationStatus: 'approved' };
const OLDER_OIDC_ROW = { id: 'row-old', plexId: 'sub-dan', plexUsername: 'dan', role: 'user', authProvider: null, oidcSubject: 'sub-dan', registrationStatus: 'approved' };

function seed(...rows: Record<string, any>[]) {
  users.clear();
  for (const row of rows) users.set(row.plexId, { ...row });
}
const snapshot = (plexId: string) => JSON.stringify(users.get(plexId));

async function signIn(sub: string, extra: Record<string, unknown> = {}) {
  clientMock.callback.mockResolvedValue({ access_token: 'token' });
  clientMock.userinfo.mockResolvedValue({ sub, preferred_username: `user-${sub}`, ...extra });
  const { OIDCAuthProvider } = await import('@/lib/services/auth/OIDCAuthProvider');
  const provider = new OIDCAuthProvider();
  await provider.initiateLogin();
  return provider.handleCallback({ code: 'code', state: 'state-1' });
}

describe('OIDC sign-in accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PUBLIC_URL = 'http://localhost:3030';
    config.values = { ...BASE_CONFIG };
    seed(LOCAL_ROW, PLEX_ROW, OIDC_ROW, OLDER_OIDC_ROW);
  });

  it.each([LOCAL_ROW.plexId, PLEX_ROW.plexId])('refuses a subject whose row is not an OIDC account (case %#)', async (sub) => {
    const before = snapshot(sub);

    const result = await signIn(sub, { groups: ['admins'] });

    expect(result).toEqual({ success: false, error: expect.stringContaining('cannot sign in with single sign-on') });
    expect(result.tokens).toBeUndefined();
    expect(prismaMock.user.upsert).not.toHaveBeenCalled();
    expect(snapshot(sub)).toBe(before);
  });

  it('refuses before creating a pending account in the admin-approval flow', async () => {
    config.values['oidc.access_control_method'] = 'admin_approval';
    const before = snapshot(PLEX_ROW.plexId);

    const result = await signIn(PLEX_ROW.plexId);

    expect(result.success).toBe(false);
    expect(result.requiresApproval).toBeUndefined();
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(snapshot(PLEX_ROW.plexId)).toBe(before);
  });

  it('signs in an existing OIDC account and keeps existing roles', async () => {
    const result = await signIn('sub-carol');

    expect(result.success).toBe(true);
    expect(result.user).toMatchObject({ id: 'row-o', role: 'user', authProvider: 'oidc' });
    expect(users.get('sub-carol')).toMatchObject({ authProvider: 'oidc', role: 'user' });
  });

  it('refuses a row without a provider', async () => {
    const before = snapshot('sub-dan');

    const result = await signIn('sub-dan');

    expect(result.success).toBe(false);
    expect(snapshot('sub-dan')).toBe(before);
  });

  it('still signs in an existing OIDC account whatever its subject looks like', async () => {
    seed({ ...OIDC_ROW, id: 'row-o2', plexId: 'local-erin', oidcSubject: 'local-erin' });

    const result = await signIn('local-erin');

    expect(result.success).toBe(true);
    expect(users.get('local-erin')).toMatchObject({ id: 'row-o2', authProvider: 'oidc' });
  });

  it.each(['local-someone', 'LOCAL-Someone'])('refuses a reserved subject (%s)', async (sub) => {
    const result = await signIn(sub);

    expect(result.success).toBe(false);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(users.has(sub)).toBe(false);
  });

  it('creates a new OIDC account for a new subject', async () => {
    const result = await signIn('sub-new');

    expect(result.success).toBe(true);
    expect(users.get('sub-new')).toMatchObject({ authProvider: 'oidc', oidcSubject: 'sub-new', role: 'user' });
  });
});
