/**
 * Component: Local Auth Provider Tests (password sign-in)
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

// A guard that allows every attempt; the limits themselves are tested in tests/api/sign-in-limits.routes.test.ts
const allowAll = () => ({ begin: vi.fn(() => ({ ok: true as const })), settle: vi.fn(), remember: vi.fn() });

describe('LocalAuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs in approved local users with valid password', async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      plexId: 'local-user',
      plexUsername: 'user',
      role: 'user',
      authProvider: 'local',
      authToken: 'enc:hash',
      registrationStatus: 'approved',
      deletedAt: null,
    });
    prismaMock.user.update.mockResolvedValue({});
    bcryptCompare.mockResolvedValue(true);

    const { LocalAuthProvider } = await import('@/lib/services/auth/LocalAuthProvider');
    const provider = new LocalAuthProvider();
    const result = await provider.handleCallback({ username: 'user', password: 'pass', guard: allowAll() });

    expect(result.success).toBe(true);
    expect(result.user?.authProvider).toBe('local');
    expect(result.tokens?.accessToken).toBeTruthy();
    expect(result.tokens?.refreshToken).toBeTruthy();
  });

  it('rejects login when credentials are missing', async () => {
    const { LocalAuthProvider } = await import('@/lib/services/auth/LocalAuthProvider');
    const provider = new LocalAuthProvider();
    const result = await provider.handleCallback({ username: '', password: '', guard: allowAll() });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Username and password required');
  });

  it('blocks login when approval is pending', async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-2',
      plexId: 'local-user',
      plexUsername: 'user',
      role: 'user',
      authProvider: 'local',
      authToken: 'enc:hash',
      registrationStatus: 'pending_approval',
      deletedAt: null,
    });
    bcryptCompare.mockResolvedValue(true);

    const { LocalAuthProvider } = await import('@/lib/services/auth/LocalAuthProvider');
    const provider = new LocalAuthProvider();
    const result = await provider.handleCallback({ username: 'user', password: 'pass', guard: allowAll() });

    expect(result.success).toBe(false);
    expect(result.requiresApproval).toBe(true);
  });

  it('rejects login when account is rejected', async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-2b',
      plexId: 'local-user',
      plexUsername: 'user',
      role: 'user',
      authProvider: 'local',
      authToken: 'enc:hash',
      registrationStatus: 'rejected',
      deletedAt: null,
    });
    bcryptCompare.mockResolvedValue(true);

    const { LocalAuthProvider } = await import('@/lib/services/auth/LocalAuthProvider');
    const provider = new LocalAuthProvider();
    const result = await provider.handleCallback({ username: 'user', password: 'pass', guard: allowAll() });

    expect(result.success).toBe(false);
    expect(result.error).toContain('rejected');
  });

  it('rejects login with invalid password', async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-3',
      plexId: 'local-user',
      plexUsername: 'user',
      role: 'user',
      authProvider: 'local',
      authToken: 'enc:hash',
      registrationStatus: 'approved',
      deletedAt: null,
    });
    bcryptCompare.mockResolvedValue(false);

    const { LocalAuthProvider } = await import('@/lib/services/auth/LocalAuthProvider');
    const provider = new LocalAuthProvider();
    const result = await provider.handleCallback({ username: 'user', password: 'bad', guard: allowAll() });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid username or password/i);
  });

  it('rejects login when password hash cannot be decrypted', async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-4',
      plexId: 'local-user',
      plexUsername: 'user',
      role: 'user',
      authProvider: 'local',
      authToken: 'enc:hash',
      registrationStatus: 'approved',
      deletedAt: null,
    });
    encryptionMock.decrypt.mockImplementationOnce(() => {
      throw new Error('decrypt failed');
    });

    const { LocalAuthProvider } = await import('@/lib/services/auth/LocalAuthProvider');
    const provider = new LocalAuthProvider();
    const result = await provider.handleCallback({ username: 'user', password: 'pass', guard: allowAll() });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid username or password/i);
  });

  it('rejects login when user is not found', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);

    const { LocalAuthProvider } = await import('@/lib/services/auth/LocalAuthProvider');
    const provider = new LocalAuthProvider();
    const result = await provider.handleCallback({ username: 'user', password: 'pass', guard: allowAll() });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid username or password/i);
  });

  it('normalizes username to lowercase on login', async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-ci',
      plexId: 'local-admin',
      plexUsername: 'admin',
      role: 'admin',
      authProvider: 'local',
      authToken: 'enc:hash',
      registrationStatus: 'approved',
      deletedAt: null,
    });
    prismaMock.user.update.mockResolvedValue({});
    bcryptCompare.mockResolvedValue(true);

    const { LocalAuthProvider } = await import('@/lib/services/auth/LocalAuthProvider');
    const provider = new LocalAuthProvider();
    await provider.handleCallback({ username: 'Admin', password: 'pass', guard: allowAll() });

    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ plexUsername: 'admin' }),
      })
    );
  });
});
