/**
 * Component: Local Account Creation Tests (shared by self-registration and admin-added users)
 * Documentation: documentation/backend/services/auth.md
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../../helpers/prisma';

const prismaMock = createPrismaMock();
const config = vi.hoisted(() => ({ values: {} as Record<string, string | null> }));
const configMock = vi.hoisted(() => ({
  get: vi.fn(async (key: string) => config.values[key] ?? null),
  getBackendMode: vi.fn(async () => (config.values['system.backend_mode'] as string) || 'plex'),
}));
const encryptionMock = vi.hoisted(() => ({
  encrypt: vi.fn((value: string) => `enc:${value}`),
  decrypt: vi.fn((value: string) => value.replace('enc:', '')),
}));
const bcryptHash = vi.hoisted(() => vi.fn(async (value: string) => `bcrypt(${value.length})`));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/encryption.service', () => ({ getEncryptionService: () => encryptionMock }));
vi.mock('bcrypt', () => ({ default: { hash: bcryptHash, compare: vi.fn() }, hash: bcryptHash }));

const APPROVED_USER = { role: 'user', isSetupAdmin: false, registrationStatus: 'approved' } as const;
const uniqueKeyError = () =>
  Object.assign(new Error('Unique constraint failed on the fields: (`plex_id`)'), { code: 'P2002' });

describe('checkLocalCredentials', () => {
  afterEach(() => {
    delete process.env.ALLOW_WEAK_PASSWORD;
  });

  it('trims and lowercases the username and keeps the password as given', async () => {
    const { checkLocalCredentials } = await import('@/lib/services/auth/local-account');
    expect(checkLocalCredentials('  NewUser ', ' Pass word1 ')).toEqual({
      ok: true,
      username: 'newuser',
      password: ' Pass word1 ',
    });
  });

  it.each([
    ['empty', ''],
    ['two characters', 'ab'],
    ['three characters only after trimming', '  ab  '],
    ['missing', undefined],
    ['not a string', 12345],
  ])('refuses a username that is %s', async (_label, username) => {
    const { checkLocalCredentials } = await import('@/lib/services/auth/local-account');
    expect(checkLocalCredentials(username, 'password123')).toEqual({
      ok: false,
      error: 'Username must be at least 3 characters',
    });
  });

  it.each([
    ['empty', ''],
    ['missing', undefined],
    ['not a string', 12345678],
  ])('refuses a password that is %s', async (_label, password) => {
    const { checkLocalCredentials } = await import('@/lib/services/auth/local-account');
    expect(checkLocalCredentials('newuser', password)).toEqual({ ok: false, error: 'Password is required' });
  });

  it('refuses a password under 8 characters and accepts 8', async () => {
    const { checkLocalCredentials } = await import('@/lib/services/auth/local-account');
    expect(checkLocalCredentials('newuser', '1234567')).toEqual({
      ok: false,
      error: 'Password must be at least 8 characters',
    });
    expect(checkLocalCredentials('newuser', '12345678').ok).toBe(true);
  });

  it('accepts a short password when ALLOW_WEAK_PASSWORD is true, but never an empty one', async () => {
    process.env.ALLOW_WEAK_PASSWORD = 'true';
    const { checkLocalCredentials } = await import('@/lib/services/auth/local-account');
    expect(checkLocalCredentials('newuser', 'ab').ok).toBe(true);
    expect(checkLocalCredentials('newuser', '')).toEqual({ ok: false, error: 'Password is required' });
  });

  it('checks the username before the password', async () => {
    const { checkLocalCredentials } = await import('@/lib/services/auth/local-account');
    expect(checkLocalCredentials('ab', '')).toEqual({
      ok: false,
      error: 'Username must be at least 3 characters',
    });
  });
});

describe('createLocalAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'new-1', ...data }));
  });

  it('writes the local row with the given account state and an encrypted hash, never the password', async () => {
    const { createLocalAccount } = await import('@/lib/services/auth/local-account');
    const result = await createLocalAccount({ username: 'NewUser', password: 'password123' }, APPROVED_USER);

    expect(result.ok).toBe(true);
    expect(bcryptHash).toHaveBeenCalledWith('password123', 10);
    const { data } = prismaMock.user.create.mock.calls[0][0];
    expect(data).toEqual({
      plexId: 'local-newuser',
      plexUsername: 'newuser',
      authToken: 'enc:bcrypt(11)',
      authProvider: 'local',
      role: 'user',
      isSetupAdmin: false,
      registrationStatus: 'approved',
      lastLoginAt: expect.any(Date),
    });
    expect(JSON.stringify(data)).not.toContain('password123');
  });

  it('passes a pending first-run state through unchanged', async () => {
    const { createLocalAccount } = await import('@/lib/services/auth/local-account');
    await createLocalAccount(
      { username: 'first', password: 'password123' },
      { role: 'admin', isSetupAdmin: true, registrationStatus: 'pending_approval' }
    );
    expect(prismaMock.user.create.mock.calls[0][0].data).toMatchObject({
      role: 'admin',
      isSetupAdmin: true,
      registrationStatus: 'pending_approval',
    });
  });

  it('returns the rule message and touches nothing when the rules fail', async () => {
    const { createLocalAccount } = await import('@/lib/services/auth/local-account');
    const result = await createLocalAccount({ username: 'newuser', password: 'short' }, APPROVED_USER);

    expect(result).toEqual({ ok: false, error: 'Password must be at least 8 characters' });
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
    expect(bcryptHash).not.toHaveBeenCalled();
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('refuses a username a non-deleted local account holds, looked up lowercased', async () => {
    prismaMock.user.findFirst.mockResolvedValue({ id: 'existing' });
    const { createLocalAccount } = await import('@/lib/services/auth/local-account');
    const result = await createLocalAccount({ username: 'EXISTING', password: 'password123' }, APPROVED_USER);

    expect(result).toEqual({ ok: false, error: 'That username is already taken' });
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
      where: { plexUsername: 'existing', authProvider: 'local', deletedAt: null },
    });
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('answers a unique-key clash on write (a deleted account\'s freed key, or a concurrent sign-up) as taken', async () => {
    prismaMock.user.create.mockRejectedValue(uniqueKeyError());
    const { createLocalAccount } = await import('@/lib/services/auth/local-account');
    const result = await createLocalAccount(
      { username: 'bob-deleted-1700000000000', password: 'password123' },
      APPROVED_USER
    );

    expect(result).toEqual({ ok: false, error: 'That username is already taken' });
  });

  it('rethrows any other write error', async () => {
    prismaMock.user.create.mockRejectedValue(new Error('connection lost'));
    const { createLocalAccount } = await import('@/lib/services/auth/local-account');
    await expect(
      createLocalAccount({ username: 'newuser', password: 'password123' }, APPROVED_USER)
    ).rejects.toThrow('connection lost');
  });
});

describe('LocalAuthProvider.register on a unique-key clash', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.values = { 'auth.registration_enabled': 'true', 'auth.require_admin_approval': 'false' };
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.count.mockResolvedValue(3);
    prismaMock.user.create.mockRejectedValue(uniqueKeyError());
  });

  it('says the username is taken, never the database text', async () => {
    const { LocalAuthProvider } = await import('@/lib/services/auth/LocalAuthProvider');
    const result = await new LocalAuthProvider().register({
      username: 'bob-deleted-1700000000000',
      password: 'password123',
    });

    expect(result).toEqual({ success: false, error: 'That username is already taken' });
  });
});

describe('isLocalLoginEnabled', () => {
  afterEach(() => {
    delete process.env.DISABLE_LOCAL_LOGIN;
  });

  it.each([
    ['audiobookshelf', undefined, true],
    ['audiobookshelf', 'false', true],
    ['audiobookshelf', 'true', false],
    ['plex', undefined, false],
    [null, undefined, false],
  ])('backend %s with DISABLE_LOCAL_LOGIN=%s gives %s', async (mode, disable, expected) => {
    config.values = { 'system.backend_mode': mode };
    if (disable !== undefined) process.env.DISABLE_LOCAL_LOGIN = disable;
    const { isLocalLoginEnabled } = await import('@/lib/services/auth/local-account');
    expect(await isLocalLoginEnabled()).toBe(expected);
  });
});
