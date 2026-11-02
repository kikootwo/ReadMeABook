/**
 * Component: Plex Auth Provider Tests
 * Documentation: documentation/backend/services/auth.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../../helpers/prisma';

const prismaMock = createPrismaMock();
const configMock = vi.hoisted(() => ({
  getPlexConfig: vi.fn(),
}));
const encryptionMock = vi.hoisted(() => ({
  encrypt: vi.fn((value: string) => `enc:${value}`),
  decrypt: vi.fn((value: string) => value.replace('enc:', '')),
}));
const plexServiceMock = vi.hoisted(() => ({
  requestPin: vi.fn(),
  getOAuthUrl: vi.fn(),
  checkPin: vi.fn(),
  getUserInfo: vi.fn(),
  verifyServerAccess: vi.fn(),
  getHomeUsers: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configMock,
}));

vi.mock('@/lib/services/encryption.service', () => ({
  getEncryptionService: () => encryptionMock,
}));

vi.mock('@/lib/integrations/plex.service', () => ({
  getPlexService: () => plexServiceMock,
}));

describe('PlexAuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initiates login and returns OAuth URL', async () => {
    process.env.PLEX_OAUTH_CALLBACK_URL = 'http://app/callback';
    plexServiceMock.requestPin.mockResolvedValue({ id: 42, code: 'CODE' });
    plexServiceMock.getOAuthUrl.mockReturnValue('http://plex/oauth');

    const { PlexAuthProvider } = await import('@/lib/services/auth/PlexAuthProvider');
    const provider = new PlexAuthProvider();
    const result = await provider.initiateLogin();

    expect(result.redirectUrl).toBe('http://plex/oauth');
    expect(result.pinId).toBe('42');
  });

  it('handleCallback refuses and writes nothing (Plex sign-in completes in the Plex routes)', async () => {
    plexServiceMock.checkPin.mockResolvedValue('token');
    plexServiceMock.getUserInfo.mockResolvedValue({ id: 1, username: 'user', authToken: 'token' });

    const { PlexAuthProvider } = await import('@/lib/services/auth/PlexAuthProvider');
    const provider = new PlexAuthProvider();

    for (const params of [{}, { pinId: '123' }, { code: 'code', state: 'state' }]) {
      const result = await provider.handleCallback(params);
      expect(result).toEqual({ success: false, error: expect.any(String) });
    }
    expect(plexServiceMock.checkPin).not.toHaveBeenCalled();
    expect(prismaMock.user.upsert).not.toHaveBeenCalled();
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('returns false when access validation has no server config', async () => {
    configMock.getPlexConfig.mockResolvedValue({
      serverUrl: null,
      machineIdentifier: null,
    });

    const { PlexAuthProvider } = await import('@/lib/services/auth/PlexAuthProvider');
    const provider = new PlexAuthProvider();
    const ok = await provider.validateAccess({ id: 'user-1', username: 'user', role: 'user', authProvider: 'plex' });

    expect(ok).toBe(false);
  });

  it('returns false when Plex auth token is missing in the database', async () => {
    configMock.getPlexConfig.mockResolvedValue({
      serverUrl: 'http://plex',
      machineIdentifier: 'machine',
    });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', authToken: null });

    const { PlexAuthProvider } = await import('@/lib/services/auth/PlexAuthProvider');
    const provider = new PlexAuthProvider();
    const ok = await provider.validateAccess({ id: 'user-1', username: 'user', role: 'user', authProvider: 'plex' });

    expect(ok).toBe(false);
  });

  it('decrypts tokens and verifies server access', async () => {
    configMock.getPlexConfig.mockResolvedValue({
      serverUrl: 'http://plex',
      machineIdentifier: 'machine',
    });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', authToken: 'enc:token' });
    plexServiceMock.verifyServerAccess.mockResolvedValue(true);

    const { PlexAuthProvider } = await import('@/lib/services/auth/PlexAuthProvider');
    const provider = new PlexAuthProvider();
    const ok = await provider.validateAccess({ id: 'user-1', username: 'user', role: 'user', authProvider: 'plex' });

    expect(ok).toBe(true);
    expect(encryptionMock.decrypt).toHaveBeenCalledWith('enc:token');
  });
});


