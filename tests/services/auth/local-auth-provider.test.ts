/**
 * Component: Local Auth Provider Tests
 * Documentation: documentation/backend/services/auth.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../../helpers/prisma';

const prismaMock = createPrismaMock();
const configMock = vi.hoisted(() => ({ get: vi.fn() }));
const encryptionMock = vi.hoisted(() => ({
  encrypt: vi.fn((value: string) => `enc:${value}`),
  decrypt: vi.fn((value: string) => value.replace('enc:', '')),
}));

const bcryptCompare = vi.fn();
const bcryptHash = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configMock,
}));

vi.mock('@/lib/services/encryption.service', () => ({
  getEncryptionService: () => encryptionMock,
}));

vi.mock('bcrypt', () => ({
  default: { compare: bcryptCompare, hash: bcryptHash },
  compare: bcryptCompare,
  hash: bcryptHash,
}));

describe('LocalAuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks registration when disabled', async () => {
    configMock.get.mockResolvedValueOnce('false');

    const { LocalAuthProvider } = await import('@/lib/services/auth/LocalAuthProvider');
    const provider = new LocalAuthProvider();
    const result = await provider.register({ username: 'user', password: 'password123' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/registration is disabled/i);
  });

  it('rejects short usernames or passwords on registration', async () => {
    const { LocalAuthProvider } = await import('@/lib/services/auth/LocalAuthProvider');
    const provider = new LocalAuthProvider();

    let result = await provider.register({ username: 'ab', password: 'password123' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Username');

    result = await provider.register({ username: 'user', password: 'short' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Password');
  });

  it('allows short passwords when ALLOW_WEAK_PASSWORD is enabled', async () => {
    process.env.ALLOW_WEAK_PASSWORD = 'true';
    configMock.get.mockResolvedValueOnce('true'); // registration enabled
    configMock.get.mockResolvedValueOnce('false'); // no admin approval
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.user.create.mockResolvedValue({
      id: 'user-1',
      plexId: 'local-user',
      plexUsername: 'user',
      role: 'admin',
    });
    bcryptHash.mockResolvedValue('hash');

    const { LocalAuthProvider } = await import('@/lib/services/auth/LocalAuthProvider');
    const provider = new LocalAuthProvider();
    const result = await provider.register({ username: 'user', password: 'ab' });

    expect(result.success).toBe(true);
    delete process.env.ALLOW_WEAK_PASSWORD;
  });

  it('still rejects empty passwords when ALLOW_WEAK_PASSWORD is enabled', async () => {
    process.env.ALLOW_WEAK_PASSWORD = 'true';

    const { LocalAuthProvider } = await import('@/lib/services/auth/LocalAuthProvider');
    const provider = new LocalAuthProvider();
    const result = await provider.register({ username: 'user', password: '' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('required');
    delete process.env.ALLOW_WEAK_PASSWORD;
  });

  it('rejects registration when username is taken', async () => {
    configMock.get.mockResolvedValueOnce('true');
    prismaMock.user.findFirst.mockResolvedValue({ id: 'user-10' });

    const { LocalAuthProvider } = await import('@/lib/services/auth/LocalAuthProvider');
    const provider = new LocalAuthProvider();
    const result = await provider.register({ username: 'user', password: 'password123' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('That username is already taken');
  });

  it('stores lowercase username and plexId on registration', async () => {
    configMock.get.mockResolvedValueOnce('true'); // registration enabled
    configMock.get.mockResolvedValueOnce('false'); // no admin approval
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.count.mockResolvedValue(1);
    prismaMock.user.create.mockResolvedValue({
      id: 'user-ci2',
      plexId: 'local-myuser',
      plexUsername: 'myuser',
      role: 'user',
    });
    bcryptHash.mockResolvedValue('hash');

    const { LocalAuthProvider } = await import('@/lib/services/auth/LocalAuthProvider');
    const provider = new LocalAuthProvider();
    await provider.register({ username: 'MyUser', password: 'password123' });

    expect(prismaMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          plexId: 'local-myuser',
          plexUsername: 'myuser',
        }),
      })
    );
  });

  it('rejects duplicate username case-insensitively on registration', async () => {
    configMock.get.mockResolvedValueOnce('true'); // registration enabled
    prismaMock.user.findFirst.mockResolvedValue({ id: 'user-existing' });

    const { LocalAuthProvider } = await import('@/lib/services/auth/LocalAuthProvider');
    const provider = new LocalAuthProvider();
    const result = await provider.register({ username: 'User', password: 'password123' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('That username is already taken');
    // The lookup should use the lowercased username
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ plexUsername: 'user' }),
      })
    );
  });

  it('creates admin user on first registration', async () => {
    configMock.get.mockResolvedValueOnce('true'); // registration enabled
    configMock.get.mockResolvedValueOnce('false'); // no admin approval
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.user.create.mockResolvedValue({
      id: 'user-1',
      plexId: 'local-user',
      plexUsername: 'user',
      role: 'admin',
    });
    bcryptHash.mockResolvedValue('hash');

    const { LocalAuthProvider } = await import('@/lib/services/auth/LocalAuthProvider');
    const provider = new LocalAuthProvider();
    const result = await provider.register({ username: 'user', password: 'password123' });

    expect(result.success).toBe(true);
    expect(result.user?.role).toBe('admin');
  });

  it('returns pending approval when admin approval is required', async () => {
    configMock.get.mockResolvedValueOnce('true'); // registration enabled
    configMock.get.mockResolvedValueOnce('true'); // admin approval required
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.count.mockResolvedValue(2);
    prismaMock.user.create.mockResolvedValue({
      id: 'user-11',
      plexId: 'local-user',
      plexUsername: 'user',
      role: 'user',
    });
    bcryptHash.mockResolvedValue('hash');

    const { LocalAuthProvider } = await import('@/lib/services/auth/LocalAuthProvider');
    const provider = new LocalAuthProvider();
    const result = await provider.register({ username: 'user', password: 'password123' });

    expect(result.success).toBe(false);
    expect(result.requiresApproval).toBe(true);
  });

  it('returns false for non-local or missing users during access validation', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    const { LocalAuthProvider } = await import('@/lib/services/auth/LocalAuthProvider');
    const provider = new LocalAuthProvider();
    const missing = await provider.validateAccess({ id: 'user-12', username: 'x' });

    expect(missing).toBe(false);

    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'user-13',
      authProvider: 'plex',
      deletedAt: null,
      registrationStatus: 'approved',
    });

    const notLocal = await provider.validateAccess({ id: 'user-13', username: 'x' });
    expect(notLocal).toBe(false);
  });

  it('returns null for refresh token placeholder', async () => {
    const { LocalAuthProvider } = await import('@/lib/services/auth/LocalAuthProvider');
    const provider = new LocalAuthProvider();

    const tokens = await provider.refreshToken('refresh');
    expect(tokens).toBeNull();
  });

  it('rejects access for deleted or unapproved users', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'user-4',
      authProvider: 'local',
      deletedAt: new Date(),
      registrationStatus: 'approved',
    });

    const { LocalAuthProvider } = await import('@/lib/services/auth/LocalAuthProvider');
    const provider = new LocalAuthProvider();
    const deletedAccess = await provider.validateAccess({ id: 'user-4', username: 'x' });

    expect(deletedAccess).toBe(false);

    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'user-5',
      authProvider: 'local',
      deletedAt: null,
      registrationStatus: 'pending_approval',
    });

    const pendingAccess = await provider.validateAccess({ id: 'user-5', username: 'x' });
    expect(pendingAccess).toBe(false);
  });
});



