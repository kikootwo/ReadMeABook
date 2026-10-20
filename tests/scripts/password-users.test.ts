/**
 * Component: Credential Recovery User Selection and Reset Tests
 * Documentation: documentation/admin-features/credential-recovery.md
 *
 * The recovery script offers exactly the users who log in with a password (local users
 * and the Plex-mode setup admin, stored with authProvider 'plex'), never a Plex or OIDC
 * user. A reset ends the user's existing sessions: old access and refresh tokens are
 * rejected, a fresh login works. Fixtures mirror the rows each sign-in path creates.
 */

import { readFileSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';
import bcrypt from 'bcrypt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

process.env.CONFIG_ENCRYPTION_KEY ??= 'test-config-encryption-key-32-bytes!';

const prismaMock = createPrismaMock();
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

const require = createRequire(import.meta.url);
const {
  PASSWORD_LOGIN_WHERE,
  isPasswordLoginUser,
  listPasswordUsers,
  describePasswordUser,
  findPasswordUser,
} = require('../../scripts/lib/password-users.js');
const { passwordResetData } = require('../../scripts/lib/recovery-process.js');

// setup/complete (Plex mode and Audiobookshelf mode) and LocalAuthProvider registration
const plexModeAdmin = { id: 'u1', plexId: 'local-admin', plexUsername: 'admin', role: 'admin', isSetupAdmin: true, authProvider: 'plex', deletedAt: null };
const absModeAdmin = { id: 'u2', plexId: 'local-root', plexUsername: 'root', role: 'admin', isSetupAdmin: true, authProvider: 'local', deletedAt: null };
const registered = { id: 'u3', plexId: 'local-bob', plexUsername: 'bob', role: 'user', isSetupAdmin: false, authProvider: 'local', deletedAt: null };
// Plex callback (numeric account id) and switch-profile (Home uuid): no authProvider set
const plexUser = { id: 'p1', plexId: '12345678', plexUsername: 'admin', role: 'user', isSetupAdmin: false, authProvider: null, deletedAt: null };
const plexHomeProfile = { id: 'p2', plexId: '5f3a9c0e1b2d4a67', plexUsername: 'Kid', role: 'user', isSetupAdmin: false, authProvider: null, deletedAt: null };
// OIDC: plexId is the provider's subject, any string
const oidcUser = { id: 'o1', plexId: 'a7f3-subject', plexUsername: 'carol', role: 'user', isSetupAdmin: false, authProvider: 'oidc', deletedAt: null };
const oidcLocalLookingSubject = { id: 'o2', plexId: 'local-dave', plexUsername: 'dave', role: 'user', isSetupAdmin: false, authProvider: 'oidc', deletedAt: null };
// Not produced by any current path; refused anyway
const nullProviderLocalId = { id: 'x1', plexId: 'local-old', plexUsername: 'old', role: 'user', isSetupAdmin: false, authProvider: null, deletedAt: null };
const mismatchedName = { id: 'x2', plexId: 'local-admin', plexUsername: 'mallory', role: 'user', isSetupAdmin: false, authProvider: 'local', deletedAt: null };
const softDeleted = { id: 'd1', plexId: 'local-eve-deleted-1700000000000', plexUsername: 'eve', role: 'user', isSetupAdmin: false, authProvider: 'local', deletedAt: new Date() };

describe('isPasswordLoginUser', () => {
  it.each([
    ['the Plex-mode setup admin (authProvider plex)', plexModeAdmin],
    ['the Audiobookshelf-mode setup admin', absModeAdmin],
    ['a registered local user', registered],
    ['a row whose plexId differs from local-<name> only in case', { ...registered, plexId: 'local-Bob' }],
  ])('offers %s', (_label, user) => {
    expect(isPasswordLoginUser(user)).toBe(true);
  });

  it.each([
    ['a Plex user (numeric id, same username as the admin)', plexUser],
    ['a Plex Home profile (uuid id)', plexHomeProfile],
    ['an OIDC user', oidcUser],
    ['an OIDC user whose subject starts with "local-"', oidcLocalLookingSubject],
    ['a local-* row without a provider', nullProviderLocalId],
    ['a row whose plexId is not local-<its username>', mismatchedName],
    ['a soft-deleted local user', softDeleted],
  ])('does not offer %s', (_label, user) => {
    expect(isPasswordLoginUser(user)).toBe(false);
  });
});

describe('listPasswordUsers', () => {
  it('queries undeleted local-* rows of the password providers, then applies the exact rule', async () => {
    const findMany = vi.fn().mockResolvedValue([plexModeAdmin, registered, plexUser, oidcLocalLookingSubject, mismatchedName, softDeleted]);

    const users = await listPasswordUsers({ user: { findMany } });

    expect(users.map((u: { id: string }) => u.id)).toEqual(['u1', 'u3']);
    const args = findMany.mock.calls[0][0];
    expect(args.where).toEqual({ deletedAt: null, plexId: { startsWith: 'local-' }, authProvider: { in: ['local', 'plex'] } });
    expect(args.where).toBe(PASSWORD_LOGIN_WHERE);
    expect(args.orderBy).toEqual([{ isSetupAdmin: 'desc' }, { plexUsername: 'asc' }]);
  });

  it('returns the Plex-mode admin when it is the only password user (was "No local users exist")', async () => {
    const findMany = vi.fn().mockResolvedValue([plexModeAdmin, plexUser, plexHomeProfile]);

    expect(await listPasswordUsers({ user: { findMany } })).toEqual([plexModeAdmin]);
  });
});

describe('findPasswordUser / describePasswordUser', () => {
  const listed = [plexModeAdmin, registered];

  it('matches the typed username trimmed and case-insensitively', () => {
    expect(findPasswordUser(listed, '  ADMIN ')).toBe(plexModeAdmin);
    expect(findPasswordUser(listed, 'bob')).toBe(registered);
  });

  it('never resolves to an unlisted user, such as a Plex user with the same name', () => {
    expect(findPasswordUser([registered], 'admin')).toBeNull();
    expect(findPasswordUser(listed, '')).toBeNull();
  });

  it('labels the Plex-mode admin', () => {
    expect(describePasswordUser(plexModeAdmin)).toBe('admin   [admin, setup-admin, Plex-mode admin]');
    expect(describePasswordUser(registered)).toBe('bob   [user]');
  });
});

describe('a reset password works at the admin login', () => {
  beforeEach(() => vi.clearAllMocks());

  it('the Plex-mode admin logs in with the new password through /api/auth/admin/login', async () => {
    const { getEncryptionService } = await import('@/lib/services/encryption.service');
    const reset = passwordResetData(getEncryptionService().encrypt(await bcrypt.hash('new-Passw0rd', 4)));
    prismaMock.user.findUnique.mockImplementation(async ({ where }: any) =>
      where.plexId === 'local-admin' ? { ...plexModeAdmin, ...reset } : null
    );
    prismaMock.user.update.mockResolvedValue({});

    const { POST } = await import('@/app/api/auth/admin/login/route');
    const login = (password: string) => POST({ json: async () => ({ username: ' Admin ', password }) } as any);

    expect((await login('new-Passw0rd')).status).toBe(200);
    expect((await login('old-password')).status).toBe(401);
    expect(prismaMock.user.findUnique.mock.calls[0][0].where).toEqual({ plexId: 'local-admin' });
  });
});

describe('a reset ends existing sessions', () => {
  const T0 = new Date('2026-10-19T12:00:00Z');
  let row: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    row = { ...plexModeAdmin, sessionsInvalidatedAt: null };
    prismaMock.user.findUnique.mockImplementation(async () => ({ ...row }));
  });
  afterEach(() => vi.useRealTimers());

  const bearer = (token: string) => ({
    method: 'GET',
    nextUrl: { pathname: '/api/requests' },
    headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? `Bearer ${token}` : null) },
  });

  it('rejects access and refresh tokens issued before the reset, and accepts a new login', async () => {
    const { generateAccessToken, generateRefreshToken } = await import('@/lib/utils/jwt');
    const { requireAuth } = await import('@/lib/middleware/auth');
    const { POST: refresh } = await import('@/app/api/auth/refresh/route');
    const claims = { sub: 'u1', plexId: 'local-admin', username: 'admin', role: 'admin' };
    const oldAccess = generateAccessToken(claims);
    const oldRefresh = generateRefreshToken('u1');
    const handler = vi.fn(async () => new Response('ok', { status: 200 }) as any);

    // Before the reset both work
    expect((await requireAuth(bearer(oldAccess) as any, handler)).status).toBe(200);

    // The reset, one minute later, writes sessionsInvalidatedAt
    vi.setSystemTime(new Date(T0.getTime() + 60_000));
    Object.assign(row, passwordResetData('enc-hash'));
    expect(row.sessionsInvalidatedAt).toEqual(new Date(T0.getTime() + 60_000));

    const revokedAccess = await requireAuth(bearer(oldAccess) as any, handler);
    expect(revokedAccess.status).toBe(401);
    expect((await revokedAccess.json()).message).toBe('Session has been revoked');
    const revokedRefresh = await refresh({ json: async () => ({ refreshToken: oldRefresh }) } as any);
    expect(revokedRefresh.status).toBe(401);

    // A login after the reset gets tokens that work
    vi.setSystemTime(new Date(T0.getTime() + 120_000));
    handler.mockClear();
    expect((await requireAuth(bearer(generateAccessToken(claims)) as any, handler)).status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect((await refresh({ json: async () => ({ refreshToken: generateRefreshToken('u1') }) } as any)).status).toBe(200);
  });

  it('both reset paths in the script use passwordResetData', () => {
    // The script runs main() on load (interactive), so its two update calls are pinned here
    const source = readFileSync(path.join(__dirname, '../../scripts/recover-credentials.js'), 'utf8');
    expect(source.match(/data: passwordResetData\(encryptedHash\)/g)).toHaveLength(2);
    expect(source).toContain('await listPasswordUsers(prisma)');
  });
});
