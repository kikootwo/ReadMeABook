/**
 * Component: Returning User Sign-in After Delete Tests
 * Documentation: documentation/backend/services/auth.md
 *
 * An admin deletes a Plex, Plex Home, OIDC or local account through the real
 * DELETE /api/admin/users/:id route (real requireAuth/requireAdmin and JWTs), then the
 * same person signs in again through the real sign-in route. Every path gives a new
 * account (role user, approval as for any new account) and never the deleted row.
 */

import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usersDb } from '../helpers/in-memory-users';
import { generateAccessToken } from '@/lib/utils/jwt';

const config = vi.hoisted(() => ({ values: {} as Record<string, string> }));
const plexServiceMock = vi.hoisted(() => ({
  checkPin: vi.fn(), getUserInfo: vi.fn(), verifyServerAccess: vi.fn(), getHomeUsers: vi.fn(), switchHomeUser: vi.fn(),
}));
const oidcClient = vi.hoisted(() => ({ authorizationUrl: vi.fn(() => 'https://issuer/auth'), callback: vi.fn(), userinfo: vi.fn() }));

vi.mock('@/lib/db', async () => ({ prisma: (await import('../helpers/in-memory-users')).usersDb.prisma }));
vi.mock('@/lib/integrations/plex.service', () => ({ getPlexService: () => plexServiceMock }));
vi.mock('@/lib/services/encryption.service', () => ({
  getEncryptionService: () => ({ encrypt: (v: string) => v, decrypt: (v: string) => v }),
}));
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({
    get: async (key: string) => config.values[key] ?? null,
    getBackendMode: async () => 'audiobookshelf',
    getPlexConfig: async () => ({ serverUrl: 'http://plex', authToken: 't', machineIdentifier: 'm' }),
  }),
}));
vi.mock('@/lib/services/auth-token-cache.service', () => ({
  getAuthTokenCache: () => ({ get: () => 'main-account-token', set: vi.fn(), delete: vi.fn() }),
}));
vi.mock('@/lib/services/scheduler.service', () => ({ getSchedulerService: () => ({ triggerJobNow: vi.fn() }) }));
vi.mock('@/lib/utils/url', () => ({ getBaseUrl: () => 'http://localhost:3030' }));
vi.mock('openid-client', () => ({
  Issuer: { discover: vi.fn(async () => ({ Client: class { constructor() { return oidcClient; } } })) },
  generators: { state: () => 'state-1', nonce: () => 'nonce-1', codeVerifier: () => 'verifier-1', codeChallenge: () => 'challenge-1' },
}));

const FREED_KEY = /-deleted-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HOME_PROFILE = { id: '2002', uuid: 'cccc3333dddd4444', title: 'Kid', friendlyName: 'Kid', username: '', email: '', thumb: '/kid.png' };

let adminBearer: string;

function seedSetupAdmin() {
  const admin = usersDb.addUser({
    plexId: 'local-admin', plexUsername: 'admin', role: 'admin', isSetupAdmin: true, authProvider: 'local',
  });
  adminBearer = `Bearer ${generateAccessToken({ sub: admin.id, plexId: admin.plexId, username: 'admin', role: 'admin' })}`;
}

async function deleteUser(id: string) {
  const { DELETE } = await import('@/app/api/admin/users/[id]/route');
  const request = new NextRequest(`http://localhost/api/admin/users/${id}`, {
    method: 'DELETE', headers: { authorization: adminBearer },
  });
  const response = await DELETE(request, { params: Promise.resolve({ id }) });
  return { status: response.status, body: await response.json() };
}

function postJson(url: string, body: unknown) {
  return new NextRequest(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
}

async function plexCallback(plexId: number, username: string) {
  plexServiceMock.checkPin.mockResolvedValue(`token-${plexId}`);
  plexServiceMock.getUserInfo.mockResolvedValue({ id: plexId, username, email: `${username}@example.com` });
  const { GET } = await import('@/app/api/auth/plex/callback/route');
  const response = await GET(new NextRequest('http://localhost/api/auth/plex/callback?pinId=1'));
  return { status: response.status, body: await response.json() };
}

async function switchProfile() {
  const { POST } = await import('@/app/api/auth/plex/switch-profile/route');
  const response = await POST(postJson('http://localhost/api/auth/plex/switch-profile', {
    pinId: 'pin-1', userId: '2002', profileInfo: { uuid: HOME_PROFILE.uuid },
  }));
  return { status: response.status, body: await response.json() };
}

async function oidcCallback(sub: string, claims: Record<string, unknown> = {}) {
  oidcClient.callback.mockResolvedValue({ access_token: 'idp-token' });
  oidcClient.userinfo.mockResolvedValue({ sub, preferred_username: 'olive', email: 'olive@example.com', ...claims });
  const { OIDCAuthProvider } = await import('@/lib/services/auth/OIDCAuthProvider');
  await new OIDCAuthProvider().initiateLogin();
  const { GET } = await import('@/app/api/auth/oidc/callback/route');
  const response = await GET(new NextRequest('http://localhost/api/auth/oidc/callback?code=c&state=state-1'));
  return { status: response.status, location: response.headers.get('location'), html: await response.text() };
}

/** The one live row for a sign-in key, and the deleted row, after a returning sign-in. */
function rowsAfterReturn(oldId: string, where: Record<string, unknown>) {
  return { live: usersDb.findUser({ ...where, deletedAt: null }), old: usersDb.getUser(oldId)! };
}

describe('a deleted user signing in again gets a new account', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usersDb.reset();
    config.values = {
      'auth.require_admin_approval': 'true',
      'oidc.issuer_url': 'https://issuer', 'oidc.client_id': 'client', 'oidc.client_secret': 'secret', 'oidc.provider_name': 'TestIdP',
    };
    process.env.PUBLIC_URL = 'http://localhost:3030';
    plexServiceMock.verifyServerAccess.mockResolvedValue(true);
    plexServiceMock.getHomeUsers.mockResolvedValue([]);
    plexServiceMock.switchHomeUser.mockResolvedValue('profile-token');
    seedSetupAdmin();
  });

  it('Plex OAuth callback: new row with role user and the status a new Plex user gets (approved)', async () => {
    const old = usersDb.addUser({
      plexId: '1001', plexUsername: 'pat', role: 'admin', authProvider: 'plex', autoApproveRequests: true, downloadAccess: true,
    });
    usersDb.addRequest(old.id);

    const deleted = await deleteUser(old.id);
    const returning = await plexCallback(1001, 'pat');

    const { live, old: oldRow } = rowsAfterReturn(old.id, { plexId: '1001' });
    expect(returning.status).toBe(200);
    expect(returning.body.user.id).not.toBe(old.id);
    expect(live).toMatchObject({ id: returning.body.user.id, role: 'user', registrationStatus: 'approved', autoApproveRequests: null, downloadAccess: null });
    expect(oldRow).toMatchObject({ role: 'admin', deletedAt: expect.any(Date), plexUsername: 'pat' });
    expect(oldRow.plexId).toMatch(/^1001/);
    expect(oldRow.plexId).toMatch(FREED_KEY);
    expect(usersDb.requestOwnerIds()).toEqual([old.id]);
    expect(deleted).toMatchObject({ status: 200, body: { success: true, message: expect.stringContaining('1 request(s)') } });

    // Same status as a Plex user who was never here (Plex sign-in has no approval step)
    await plexCallback(1002, 'newcomer');
    expect(usersDb.findUser({ plexId: '1002' })).toMatchObject({ role: 'user', registrationStatus: 'approved' });
  });

  it('Plex Home profile switch: new row for the same Home profile, role user, approved', async () => {
    plexServiceMock.getHomeUsers.mockResolvedValue([HOME_PROFILE]);
    const old = usersDb.addUser({
      plexId: HOME_PROFILE.uuid, plexUsername: 'Kid', role: 'admin', authProvider: 'plex', plexHomeUserId: '2002',
    });

    const deleted = await deleteUser(old.id);
    const returning = await switchProfile();

    const { live, old: oldRow } = rowsAfterReturn(old.id, { plexId: HOME_PROFILE.uuid });
    expect(returning.status).toBe(200);
    expect(returning.body.user.id).not.toBe(old.id);
    expect(live).toMatchObject({ id: returning.body.user.id, role: 'user', registrationStatus: 'approved', plexHomeUserId: '2002' });
    expect(oldRow.deletedAt).toEqual(expect.any(Date));
    expect(oldRow.plexId).toMatch(FREED_KEY);
    expect(deleted.status).toBe(200);
  });

  it('OIDC callback with admin approval: new pending row, the deleted approved row is never used', async () => {
    config.values['oidc.access_control_method'] = 'admin_approval';
    const old = usersDb.addUser({
      plexId: 'sub-olive', oidcSubject: 'sub-olive', plexUsername: 'olive', role: 'admin', authProvider: 'oidc', registrationStatus: 'approved',
    });

    const deleted = await deleteUser(old.id);
    const returning = await oidcCallback('sub-olive');

    const { live, old: oldRow } = rowsAfterReturn(old.id, { plexId: 'sub-olive' });
    expect(returning.location).toBe('http://localhost:3030/login?pending=approval');
    expect(live).toMatchObject({ role: 'user', registrationStatus: 'pending_approval', oidcSubject: 'sub-olive' });
    expect(live!.id).not.toBe(old.id);
    expect(oldRow.plexId).toMatch(FREED_KEY);
    expect(oldRow.oidcSubject).toMatch(/^sub-olive/);
    expect(oldRow.oidcSubject).toMatch(FREED_KEY);
    expect(deleted.status).toBe(200);

    // Same status as an OIDC user who was never here
    await oidcCallback('sub-newcomer');
    expect(usersDb.findUser({ plexId: 'sub-newcomer' })).toMatchObject({ registrationStatus: 'pending_approval' });
  });

  it('OIDC callback with open access: new approved row with role user (the old admin role is not kept)', async () => {
    config.values['oidc.access_control_method'] = 'open';
    const old = usersDb.addUser({
      plexId: 'sub-olive', oidcSubject: 'sub-olive', plexUsername: 'olive', role: 'admin', authProvider: 'oidc',
    });

    const deleted = await deleteUser(old.id);
    const returning = await oidcCallback('sub-olive');

    const { live } = rowsAfterReturn(old.id, { plexId: 'sub-olive' });
    expect(returning.html).toContain('/login?auth=success');
    expect(live).toMatchObject({ role: 'user', registrationStatus: 'approved' });
    expect(live!.id).not.toBe(old.id);
    expect(deleted.status).toBe(200);
  });

  it('login token: the deleted account\'s link is refused and cleared', async () => {
    const loginToken = 'login-token-for-pat';
    const old = usersDb.addUser({
      plexId: '1001', plexUsername: 'pat', authProvider: 'plex',
      loginTokenHash: crypto.createHash('sha256').update(loginToken).digest('hex'),
    });

    const deleted = await deleteUser(old.id);
    const { POST } = await import('@/app/api/auth/token/login/route');
    const response = await POST(postJson('http://localhost/api/auth/token/login', { token: loginToken }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Invalid token' });
    expect(usersDb.getUser(old.id)!.loginTokenHash).toBeNull();
    expect(deleted.status).toBe(200);
  });

  it('admin login: a deleted local admin is refused; registering again gives a new pending user', async () => {
    const hash = await bcrypt.hash('erin-password', 4);
    config.values['auth.registration_enabled'] = 'true';
    const old = usersDb.addUser({ plexId: 'local-erin', plexUsername: 'erin', role: 'admin', authProvider: 'local', authToken: hash });
    const adminLogin = async () => {
      const { POST } = await import('@/app/api/auth/admin/login/route');
      const response = await POST(postJson('http://localhost/api/auth/admin/login', { username: 'erin', password: 'erin-password' }));
      return { status: response.status, body: await response.json() };
    };

    const deleted = await deleteUser(old.id);
    expect(deleted.status).toBe(200);
    expect(usersDb.getUser(old.id)!.plexId).toMatch(/^local-erin-deleted-\d+$/);
    expect(await adminLogin()).toMatchObject({ status: 401, body: { message: 'Invalid username or password' } });

    const { LocalAuthProvider } = await import('@/lib/services/auth/LocalAuthProvider');
    const registered = await new LocalAuthProvider().register({ username: 'erin', password: 'erin-password' });
    expect(registered).toEqual({ success: false, requiresApproval: true });
    const live = usersDb.findUser({ plexId: 'local-erin' })!;
    expect(live).toMatchObject({ role: 'user', registrationStatus: 'pending_approval' });
    expect(live.id).not.toBe(old.id);
    expect(await adminLogin()).toMatchObject({ status: 200, body: { pendingApproval: true } });
  });
});
