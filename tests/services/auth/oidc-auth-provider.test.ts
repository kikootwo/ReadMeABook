/**
 * Component: OIDC Auth Provider Tests
 * Documentation: documentation/backend/services/auth.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../../helpers/prisma';

const prismaMock = createPrismaMock();
const configMock = vi.hoisted(() => ({ get: vi.fn() }));
const encryptionMock = vi.hoisted(() => ({
  encrypt: vi.fn((value: string) => value),
  decrypt: vi.fn((value: string) => value),
}));

const clientMock = {
  authorizationUrl: vi.fn(),
  callback: vi.fn(),
  userinfo: vi.fn(),
};

const issuerMock = {
  Client: class {
    constructor() {
      return clientMock;
    }
  },
};

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configMock,
}));

vi.mock('@/lib/services/encryption.service', () => ({
  getEncryptionService: () => encryptionMock,
}));

const schedulerMock = vi.hoisted(() => ({
  triggerJobNow: vi.fn(),
}));

vi.mock('@/lib/services/scheduler.service', () => ({
  getSchedulerService: () => schedulerMock,
}));

vi.mock('@/lib/utils/jwt', () => ({
  generateAccessToken: vi.fn(() => 'access-token'),
  generateRefreshToken: vi.fn(() => 'refresh-token'),
}));

vi.mock('@/lib/utils/url', () => ({
  getBaseUrl: () => 'http://localhost:3030',
}));

vi.mock('openid-client', () => ({
  Issuer: {
    discover: vi.fn(async () => issuerMock),
  },
  generators: {
    state: vi.fn(() => 'state-1'),
    nonce: vi.fn(() => 'nonce-1'),
    codeVerifier: vi.fn(() => 'verifier-1'),
    codeChallenge: vi.fn(() => 'challenge-1'),
  },
}));

describe('OIDCAuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PUBLIC_URL = 'http://localhost:3030';
  });

  const setConfig = (values: Record<string, string | null>) => {
    configMock.get.mockImplementation(async (key: string) => values[key] ?? null);
  };

  it('returns error when code or state is missing', async () => {
    const { OIDCAuthProvider } = await import('@/lib/services/auth/OIDCAuthProvider');
    const provider = new OIDCAuthProvider();
    const result = await provider.handleCallback({});

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/missing authorization code or state/i);
  });

  it('returns error when provider sends an error', async () => {
    const { OIDCAuthProvider } = await import('@/lib/services/auth/OIDCAuthProvider');
    const provider = new OIDCAuthProvider();
    const result = await provider.handleCallback({ error: 'access_denied' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('access_denied');
  });

  it('returns error for invalid callback state', async () => {
    setConfig({
      'oidc.issuer_url': 'https://issuer',
      'oidc.client_id': 'client',
      'oidc.client_secret': 'secret',
    });

    const { OIDCAuthProvider } = await import('@/lib/services/auth/OIDCAuthProvider');
    const provider = new OIDCAuthProvider();
    const result = await provider.handleCallback({ code: 'code', state: 'missing' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid or expired state/i);
  });

  it('initiates login and returns redirect URL with state', async () => {
    setConfig({
      'oidc.issuer_url': 'https://issuer',
      'oidc.client_id': 'client',
      'oidc.client_secret': 'secret',
    });

    clientMock.authorizationUrl.mockReturnValue('https://issuer/auth');

    const { OIDCAuthProvider } = await import('@/lib/services/auth/OIDCAuthProvider');
    const provider = new OIDCAuthProvider();
    const result = await provider.initiateLogin();

    expect(result.redirectUrl).toBe('https://issuer/auth');
    expect(result.state).toBe('state-1');
  });

  it('omits groups scope when access control does not need it', async () => {
    setConfig({
      'oidc.issuer_url': 'https://issuer',
      'oidc.client_id': 'client',
      'oidc.client_secret': 'secret',
      'oidc.access_control_method': 'open',
    });

    clientMock.authorizationUrl.mockReturnValue('https://issuer/auth');

    const { OIDCAuthProvider } = await import('@/lib/services/auth/OIDCAuthProvider');
    const provider = new OIDCAuthProvider();
    await provider.initiateLogin();

    expect(clientMock.authorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'openid profile email' })
    );
  });

  it('includes groups scope when access control uses group_claim', async () => {
    setConfig({
      'oidc.issuer_url': 'https://issuer',
      'oidc.client_id': 'client',
      'oidc.client_secret': 'secret',
      'oidc.access_control_method': 'group_claim',
    });

    clientMock.authorizationUrl.mockReturnValue('https://issuer/auth');

    const { OIDCAuthProvider } = await import('@/lib/services/auth/OIDCAuthProvider');
    const provider = new OIDCAuthProvider();
    await provider.initiateLogin();

    expect(clientMock.authorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'openid profile email groups' })
    );
  });

  it('includes groups scope when admin claim is enabled', async () => {
    setConfig({
      'oidc.issuer_url': 'https://issuer',
      'oidc.client_id': 'client',
      'oidc.client_secret': 'secret',
      'oidc.access_control_method': 'allowed_list',
      'oidc.admin_claim_enabled': 'true',
    });

    clientMock.authorizationUrl.mockReturnValue('https://issuer/auth');

    const { OIDCAuthProvider } = await import('@/lib/services/auth/OIDCAuthProvider');
    const provider = new OIDCAuthProvider();
    await provider.initiateLogin();

    expect(clientMock.authorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'openid profile email groups' })
    );
  });

  it('throws when OIDC is not fully configured', async () => {
    setConfig({
      'oidc.issuer_url': null,
      'oidc.client_id': null,
      'oidc.client_secret': null,
    });

    const { OIDCAuthProvider } = await import('@/lib/services/auth/OIDCAuthProvider');
    const provider = new OIDCAuthProvider();

    await expect(provider.initiateLogin()).rejects.toThrow('Failed to initiate OIDC authentication');
  });

  it('blocks access when group claim is missing', async () => {
    setConfig({
      'oidc.issuer_url': 'https://issuer',
      'oidc.client_id': 'client',
      'oidc.client_secret': 'secret',
      'oidc.access_control_method': 'group_claim',
      'oidc.access_group_claim': 'groups',
      'oidc.access_group_value': 'readmeabook-users',
    });

    clientMock.authorizationUrl.mockReturnValue('https://issuer/auth');
    clientMock.callback.mockResolvedValue({ access_token: 'token' });
    clientMock.userinfo.mockResolvedValue({ sub: 'sub-1', groups: ['other-group'] });

    const { OIDCAuthProvider } = await import('@/lib/services/auth/OIDCAuthProvider');
    const provider = new OIDCAuthProvider();
    await provider.initiateLogin();
    const result = await provider.handleCallback({ code: 'code', state: 'state-1' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/do not have access/i);
  });

  it('allows access for allowed list emails and returns tokens', async () => {
    setConfig({
      'oidc.issuer_url': 'https://issuer',
      'oidc.client_id': 'client',
      'oidc.client_secret': 'secret',
      'oidc.access_control_method': 'allowed_list',
      'oidc.allowed_emails': JSON.stringify(['user@example.com']),
      'oidc.allowed_usernames': JSON.stringify([]),
    });

    clientMock.authorizationUrl.mockReturnValue('https://issuer/auth');
    clientMock.callback.mockResolvedValue({ access_token: 'token' });
    clientMock.userinfo.mockResolvedValue({ sub: 'sub-3', email: 'user@example.com' });

    prismaMock.user.count.mockResolvedValue(1);
    prismaMock.user.upsert.mockResolvedValue({
      id: 'user-1',
      plexUsername: 'user@example.com',
      plexEmail: 'user@example.com',
      role: 'user',
      avatarUrl: null,
    });

    const { OIDCAuthProvider } = await import('@/lib/services/auth/OIDCAuthProvider');
    const provider = new OIDCAuthProvider();
    await provider.initiateLogin();
    const result = await provider.handleCallback({ code: 'code', state: 'state-1' });

    expect(result.success).toBe(true);
    expect(result.tokens?.accessToken).toBe('access-token');
  });

  it('returns requiresApproval for admin approval flow', async () => {
    setConfig({
      'oidc.issuer_url': 'https://issuer',
      'oidc.client_id': 'client',
      'oidc.client_secret': 'secret',
      'oidc.access_control_method': 'admin_approval',
      'oidc.provider_name': 'TestOIDC',
    });

    clientMock.authorizationUrl.mockReturnValue('https://issuer/auth');
    clientMock.callback.mockResolvedValue({ access_token: 'token' });
    clientMock.userinfo.mockResolvedValue({ sub: 'sub-2', preferred_username: 'user' });

    prismaMock.user.count.mockResolvedValue(2);
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({});

    const { OIDCAuthProvider } = await import('@/lib/services/auth/OIDCAuthProvider');
    const provider = new OIDCAuthProvider();
    await provider.initiateLogin();
    const result = await provider.handleCallback({ code: 'code', state: 'state-1' });

    expect(result.success).toBe(false);
    expect(result.requiresApproval).toBe(true);
  });

  it('bypasses approval for the first admin user', async () => {
    setConfig({
      'oidc.issuer_url': 'https://issuer',
      'oidc.client_id': 'client',
      'oidc.client_secret': 'secret',
      'oidc.access_control_method': 'admin_approval',
      'oidc.provider_name': 'TestOIDC',
      'oidc.admin_claim_enabled': 'true',
      'oidc.admin_claim_name': 'groups',
      'oidc.admin_claim_value': 'admins',
    });

    clientMock.authorizationUrl.mockReturnValue('https://issuer/auth');
    clientMock.callback.mockResolvedValue({ access_token: 'token' });
    clientMock.userinfo.mockResolvedValue({ sub: 'sub-4', preferred_username: 'first', groups: ['admins'] });

    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.upsert.mockResolvedValue({
      id: 'user-2',
      plexUsername: 'first',
      plexEmail: null,
      role: 'admin',
      avatarUrl: null,
    });
    prismaMock.scheduledJob.findFirst.mockResolvedValue({ id: 'sched-1' });
    prismaMock.configuration.upsert.mockResolvedValue({});

    const { OIDCAuthProvider } = await import('@/lib/services/auth/OIDCAuthProvider');
    const provider = new OIDCAuthProvider();
    await provider.initiateLogin();
    const result = await provider.handleCallback({ code: 'code', state: 'state-1' });

    expect(result.success).toBe(true);
    expect(result.user?.role).toBe('admin');
    expect(schedulerMock.triggerJobNow).toHaveBeenCalled();
  });

  it('blocks pending and rejected users during admin approval', async () => {
    setConfig({
      'oidc.issuer_url': 'https://issuer',
      'oidc.client_id': 'client',
      'oidc.client_secret': 'secret',
      'oidc.access_control_method': 'admin_approval',
    });

    clientMock.authorizationUrl.mockReturnValue('https://issuer/auth');
    clientMock.callback.mockResolvedValue({ access_token: 'token' });
    clientMock.userinfo.mockResolvedValue({ sub: 'sub-5', preferred_username: 'pending' });

    prismaMock.user.count.mockResolvedValue(2);
    prismaMock.user.findFirst.mockResolvedValue({ registrationStatus: 'pending_approval' });

    const { OIDCAuthProvider } = await import('@/lib/services/auth/OIDCAuthProvider');
    const provider = new OIDCAuthProvider();
    await provider.initiateLogin();
    const pending = await provider.handleCallback({ code: 'code', state: 'state-1' });

    expect(pending.success).toBe(false);
    expect(pending.requiresApproval).toBe(true);

    prismaMock.user.findFirst.mockResolvedValue({ registrationStatus: 'rejected' });
    await provider.initiateLogin();
    const rejected = await provider.handleCallback({ code: 'code', state: 'state-1' });

    expect(rejected.success).toBe(false);
    expect(rejected.error).toContain('rejected');
  });

  it('returns false when access validation fails', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-3',
      authProvider: 'oidc',
      registrationStatus: 'pending_approval',
    });

    const { OIDCAuthProvider } = await import('@/lib/services/auth/OIDCAuthProvider');
    const provider = new OIDCAuthProvider();
    const result = await provider.validateAccess({ id: 'user-3', username: 'user', role: 'user', authProvider: 'oidc' });

    expect(result).toBe(false);
  });

  it('returns true when access validation succeeds', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-4',
      authProvider: 'oidc',
      registrationStatus: 'approved',
    });

    const { OIDCAuthProvider } = await import('@/lib/services/auth/OIDCAuthProvider');
    const provider = new OIDCAuthProvider();
    const result = await provider.validateAccess({ id: 'user-4', username: 'user', role: 'user', authProvider: 'oidc' });

    expect(result).toBe(true);
  });

  it('returns false when access validation throws', async () => {
    prismaMock.user.findUnique.mockRejectedValue(new Error('db down'));

    const { OIDCAuthProvider } = await import('@/lib/services/auth/OIDCAuthProvider');
    const provider = new OIDCAuthProvider();
    const result = await provider.validateAccess({ id: 'user-5', username: 'user', role: 'user', authProvider: 'oidc' });

    expect(result).toBe(false);
  });

  it('expires old flow states during login', async () => {
    vi.useFakeTimers();
    const start = new Date('2024-01-01T00:00:00Z');
    vi.setSystemTime(start);

    setConfig({
      'oidc.issuer_url': 'https://issuer',
      'oidc.client_id': 'client',
      'oidc.client_secret': 'secret',
    });
    clientMock.authorizationUrl.mockReturnValue('https://issuer/auth');

    // Make generators return different values for each call
    const { generators } = await import('openid-client');
    (generators.state as any)
      .mockReturnValueOnce('state-1')
      .mockReturnValueOnce('state-2');
    (generators.nonce as any)
      .mockReturnValueOnce('nonce-1')
      .mockReturnValueOnce('nonce-2');
    (generators.codeVerifier as any)
      .mockReturnValueOnce('verifier-1')
      .mockReturnValueOnce('verifier-2');
    (generators.codeChallenge as any)
      .mockReturnValueOnce('challenge-1')
      .mockReturnValueOnce('challenge-2');

    const { OIDCAuthProvider } = await import('@/lib/services/auth/OIDCAuthProvider');
    const provider = new OIDCAuthProvider();
    const first = await provider.initiateLogin();

    vi.setSystemTime(new Date(start.getTime() + 10 * 60 * 1000 + 1));
    await provider.initiateLogin();

    const result = await provider.handleCallback({ code: 'code', state: first.state });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid or expired state/i);

    vi.useRealTimers();
  });
});


