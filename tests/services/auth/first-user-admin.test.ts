/**
 * Component: First-user auto-admin check counts soft-deleted users
 * Documentation: documentation/backend/services/auth.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../../helpers/prisma';
import { countUsersIn } from '../../helpers/user-rows';

const prismaMock = createPrismaMock();
const configMock = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configMock,
}));

vi.mock('@/lib/services/encryption.service', () => ({
  getEncryptionService: () => ({ encrypt: (value: string) => `enc:${value}`, decrypt: (value: string) => value }),
}));

vi.mock('bcrypt', () => ({
  default: { compare: vi.fn(), hash: vi.fn(async () => 'hash') },
}));

describe('First-user auto-admin (local registration)', () => {
  beforeEach(() => {
    const config: Record<string, string> = {
      'auth.registration_enabled': 'true',
      'auth.require_admin_approval': 'false',
    };
    configMock.get.mockImplementation(async (key: string) => config[key] ?? null);
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'user-new', ...data }));
  });

  const register = async () => {
    const { LocalAuthProvider } = await import('@/lib/services/auth/LocalAuthProvider');
    return new LocalAuthProvider().register({ username: 'newcomer', password: 'password123' });
  };

  it('does not make the next sign-up an admin when the only existing user is soft-deleted', async () => {
    prismaMock.user.count.mockImplementation(countUsersIn([
      { id: 'u-gone', authProvider: 'local', role: 'admin', deletedAt: new Date('2026-01-01') },
    ]));

    await register();

    expect(prismaMock.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ role: 'user', isSetupAdmin: false }),
    });
  });

  it('makes the first sign-up an admin on an empty database', async () => {
    prismaMock.user.count.mockImplementation(countUsersIn([]));

    await register();

    expect(prismaMock.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ role: 'admin', isSetupAdmin: true }),
    });
  });
});
