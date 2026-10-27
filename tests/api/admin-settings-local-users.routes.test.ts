/**
 * Component: Admin Settings API local-user flags (hasLocalUsers, hasLocalAdmins)
 * Documentation: documentation/settings-pages.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { countUsersIn } from '../helpers/user-rows';

const prismaMock = createPrismaMock();
const requireAuthMock = vi.hoisted(() => vi.fn());
const requireAdminMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: requireAuthMock,
  requireAdmin: requireAdminMock,
}));

const deleted = new Date('2026-01-01');

const getSettings = async () => {
  const { GET } = await import('@/app/api/admin/settings/route');
  const response = await GET({} as Parameters<typeof GET>[0]);
  expect(response.status).toBe(200);
  return response.json();
};

describe('Admin settings local-user flags', () => {
  beforeEach(() => {
    requireAuthMock.mockImplementation((_req: unknown, handler: (req: unknown) => unknown) =>
      handler({ user: { id: 'admin-1', role: 'admin' } })
    );
    requireAdminMock.mockImplementation((_req: unknown, handler: () => unknown) => handler());
    prismaMock.configuration.findMany.mockResolvedValue([
      { key: 'system.backend_mode', value: 'audiobookshelf' },
    ]);
  });

  it('does not count a soft-deleted local admin as a local user or a local admin', async () => {
    prismaMock.user.count.mockImplementation(countUsersIn([
      { id: 'u-gone', authProvider: 'local', role: 'admin', deletedAt: deleted },
      { id: 'u-oidc', authProvider: 'oidc', role: 'admin', deletedAt: null },
    ]));

    const settings = await getSettings();

    expect(settings.hasLocalUsers).toBe(false);
    expect(settings.hasLocalAdmins).toBe(false);
  });

  it('does not count a soft-deleted local admin when only a local non-admin is active', async () => {
    prismaMock.user.count.mockImplementation(countUsersIn([
      { id: 'u-gone', authProvider: 'local', role: 'admin', deletedAt: deleted },
      { id: 'u-local', authProvider: 'local', role: 'user', deletedAt: null },
    ]));

    const settings = await getSettings();

    expect(settings.hasLocalUsers).toBe(true);
    expect(settings.hasLocalAdmins).toBe(false);
  });

  it('counts an active local admin', async () => {
    prismaMock.user.count.mockImplementation(countUsersIn([
      { id: 'u-admin', authProvider: 'local', role: 'admin', deletedAt: null },
    ]));

    const settings = await getSettings();

    expect(settings.hasLocalUsers).toBe(true);
    expect(settings.hasLocalAdmins).toBe(true);
  });
});
