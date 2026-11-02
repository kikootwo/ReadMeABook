/**
 * Component: Admin Users API Route Tests
 * Documentation: documentation/testing.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

let authRequest: any;

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

describe('Admin users routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = { user: { sub: 'admin-1', role: 'admin' }, json: vi.fn() };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
    requireAdminMock.mockImplementation((_req: any, handler: any) => handler());
  });

  it('returns users list', async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([{ id: 'u1' }]);

    const { GET } = await import('@/app/api/admin/users/route');
    const response = await GET({} as any);
    const payload = await response.json();

    expect(payload.users).toHaveLength(1);
  });

  it('returns pending users list', async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([{ id: 'u2' }]);

    const { GET } = await import('@/app/api/admin/users/pending/route');
    const response = await GET({} as any);
    const payload = await response.json();

    expect(payload.users).toHaveLength(1);
  });

  it('updates a user role', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      isSetupAdmin: false,
      authProvider: 'local',
      plexUsername: 'user',
      deletedAt: null,
      role: 'user',
    });
    prismaMock.user.update.mockResolvedValueOnce({ id: 'u3', plexUsername: 'user', role: 'admin' });
    const request = { json: vi.fn().mockResolvedValue({ role: 'admin' }) };

    const { PUT } = await import('@/app/api/admin/users/[id]/route');
    const response = await PUT(request as any, { params: Promise.resolve({ id: 'u3' }) });
    const payload = await response.json();

    expect(payload.user.role).toBe('admin');
  });

  it('rejects invalid roles', async () => {
    const request = { json: vi.fn().mockResolvedValue({ role: 'owner' }) };

    const { PUT } = await import('@/app/api/admin/users/[id]/route');
    const response = await PUT(request as any, { params: Promise.resolve({ id: 'u3' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/Invalid role/);
  });

  it('rejects invalid autoApproveRequests values', async () => {
    const request = { json: vi.fn().mockResolvedValue({ role: 'user', autoApproveRequests: 'yes' }) };

    const { PUT } = await import('@/app/api/admin/users/[id]/route');
    const response = await PUT(request as any, { params: Promise.resolve({ id: 'u3' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/autoApproveRequests/);
  });

  it('prevents changing your own role', async () => {
    const request = { json: vi.fn().mockResolvedValue({ role: 'user' }) };

    const { PUT } = await import('@/app/api/admin/users/[id]/route');
    const response = await PUT(request as any, { params: Promise.resolve({ id: 'admin-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toMatch(/cannot change your own role/i);
  });

  it('returns 404 when updating a missing user', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    const request = { json: vi.fn().mockResolvedValue({ role: 'admin' }) };

    const { PUT } = await import('@/app/api/admin/users/[id]/route');
    const response = await PUT(request as any, { params: Promise.resolve({ id: 'missing' }) });
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toMatch(/User not found/);
  });

  it('prevents modifying deleted users', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      isSetupAdmin: false,
      authProvider: 'local',
      plexUsername: 'user',
      deletedAt: new Date(),
      role: 'user',
    });
    const request = { json: vi.fn().mockResolvedValue({ role: 'admin' }) };

    const { PUT } = await import('@/app/api/admin/users/[id]/route');
    const response = await PUT(request as any, { params: Promise.resolve({ id: 'u3' }) });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toMatch(/deleted user/);
  });

  it('prevents changing setup admin role', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      isSetupAdmin: true,
      authProvider: 'local',
      plexUsername: 'setup-admin',
      deletedAt: null,
      role: 'admin',
    });
    const request = { json: vi.fn().mockResolvedValue({ role: 'user' }) };

    const { PUT } = await import('@/app/api/admin/users/[id]/route');
    const response = await PUT(request as any, { params: Promise.resolve({ id: 'setup-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toMatch(/setup admin role/);
  });

  it('rejects admin role with autoApproveRequests false', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      isSetupAdmin: false,
      authProvider: 'local',
      plexUsername: 'admin',
      deletedAt: null,
      role: 'admin',
    });
    const request = { json: vi.fn().mockResolvedValue({ role: 'admin', autoApproveRequests: false }) };

    const { PUT } = await import('@/app/api/admin/users/[id]/route');
    const response = await PUT(request as any, { params: Promise.resolve({ id: 'admin-2' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/auto-approve requests/);
  });

  it('allows autoApproveRequests update for OIDC users without role change', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      isSetupAdmin: false,
      authProvider: 'oidc',
      plexUsername: 'oidc-user',
      deletedAt: null,
      role: 'user',
    });
    prismaMock.user.update.mockResolvedValueOnce({
      id: 'oidc-1',
      plexUsername: 'oidc-user',
      role: 'user',
      autoApproveRequests: true,
    });
    const request = { json: vi.fn().mockResolvedValue({ role: 'user', autoApproveRequests: true }) };

    const { PUT } = await import('@/app/api/admin/users/[id]/route');
    const response = await PUT(request as any, { params: Promise.resolve({ id: 'oidc-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.user.autoApproveRequests).toBe(true);
  });

  it('prevents OIDC user role change', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      isSetupAdmin: false,
      authProvider: 'oidc',
      plexUsername: 'oidc-user',
      deletedAt: null,
      role: 'user',
    });
    const request = { json: vi.fn().mockResolvedValue({ role: 'admin', autoApproveRequests: true }) };

    const { PUT } = await import('@/app/api/admin/users/[id]/route');
    const response = await PUT(request as any, { params: Promise.resolve({ id: 'oidc-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('OIDC');
  });

  it('allows autoApproveRequests update for setup admin without role change', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      isSetupAdmin: true,
      authProvider: 'local',
      plexUsername: 'setup-admin',
      deletedAt: null,
      role: 'admin',
    });
    prismaMock.user.update.mockResolvedValueOnce({
      id: 'setup-1',
      plexUsername: 'setup-admin',
      role: 'admin',
      autoApproveRequests: true,
    });
    const request = { json: vi.fn().mockResolvedValue({ role: 'admin', autoApproveRequests: true }) };

    const { PUT } = await import('@/app/api/admin/users/[id]/route');
    const response = await PUT(request as any, { params: Promise.resolve({ id: 'setup-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.user.autoApproveRequests).toBe(true);
  });

  it('soft deletes a local user and keeps the local key format', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'u4',
      plexId: 'local-user',
      plexUsername: 'user',
      oidcSubject: null,
      isSetupAdmin: false,
      authProvider: 'local',
      deletedAt: null,
      _count: { requests: 1 },
    });
    prismaMock.user.updateMany.mockResolvedValueOnce({ count: 1 });

    const { DELETE } = await import('@/app/api/admin/users/[id]/route');
    const response = await DELETE({} as any, { params: Promise.resolve({ id: 'u4' }) });
    const payload = await response.json();

    expect(payload.success).toBe(true);
    const write = (prismaMock.user.updateMany.mock.calls[0] ?? prismaMock.user.update.mock.calls[0])[0];
    expect(write.data).toMatchObject({ deletedAt: expect.any(Date), deletedBy: 'admin-1', oidcSubject: null, loginTokenHash: null });
    expect(write.data.plexId).toMatch(/^local-user-deleted-\d+$/);
    expect(write.where).toEqual({ id: 'u4', deletedAt: null });
  });

  it('prevents deleting yourself', async () => {
    const { DELETE } = await import('@/app/api/admin/users/[id]/route');
    const response = await DELETE({} as any, { params: Promise.resolve({ id: 'admin-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toMatch(/delete your own account/);
  });

  it('returns 404 when deleting a missing user', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    const { DELETE } = await import('@/app/api/admin/users/[id]/route');
    const response = await DELETE({} as any, { params: Promise.resolve({ id: 'missing' }) });
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toMatch(/User not found/);
  });

  it('returns 400 when deleting an already deleted user', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'u4',
      plexUsername: 'user',
      isSetupAdmin: false,
      authProvider: 'local',
      deletedAt: new Date(),
      _count: { requests: 1 },
    });

    const { DELETE } = await import('@/app/api/admin/users/[id]/route');
    const response = await DELETE({} as any, { params: Promise.resolve({ id: 'u4' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/already been deleted/);
  });

  it('prevents deleting setup admin users', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'setup-1',
      plexUsername: 'setup-admin',
      isSetupAdmin: true,
      authProvider: 'local',
      deletedAt: null,
      _count: { requests: 2 },
    });

    const { DELETE } = await import('@/app/api/admin/users/[id]/route');
    const response = await DELETE({} as any, { params: Promise.resolve({ id: 'setup-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toMatch(/setup admin/);
  });

  const FREED_KEY = /-deleted-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  async function deleteRow(row: Record<string, unknown>) {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'p1', plexUsername: 'pat', oidcSubject: null, isSetupAdmin: false, deletedAt: null, _count: { requests: 3 }, ...row,
    });
    prismaMock.user.updateMany.mockResolvedValueOnce({ count: 1 });
    const { DELETE } = await import('@/app/api/admin/users/[id]/route');
    const response = await DELETE({} as never, { params: Promise.resolve({ id: String(row.id ?? 'p1') }) });
    return { status: response.status, payload: await response.json(), data: prismaMock.user.updateMany.mock.calls.at(-1)?.[0].data };
  }

  it.each([
    ['plex', '1001'],
    [null, '1002'],
  ])('soft deletes a Plex user (provider %s) and frees its key with a random part', async (authProvider, plexId) => {
    const { status, payload, data } = await deleteRow({ authProvider, plexId });

    expect(status).toBe(200);
    expect(payload).toEqual({ success: true, message: 'User "pat" has been deleted. Their 3 request(s) have been preserved.' });
    expect(data).toMatchObject({ deletedAt: expect.any(Date), deletedBy: 'admin-1', oidcSubject: null, loginTokenHash: null });
    expect(data.plexId.startsWith(`${plexId}-deleted-`)).toBe(true);
    expect(data.plexId).toMatch(FREED_KEY);
  });

  it('soft deletes an OIDC user and frees both the plexId and the OIDC subject', async () => {
    const { status, data } = await deleteRow({ authProvider: 'oidc', plexId: 'sub-olive', oidcSubject: 'sub-olive' });

    expect(status).toBe(200);
    expect(data.plexId).toMatch(FREED_KEY);
    expect(data.oidcSubject).toBe(data.plexId);
    expect(data.oidcSubject.startsWith('sub-olive-deleted-')).toBe(true);
  });

  it('never gives two deletes of the same key the same freed key', async () => {
    const first = await deleteRow({ authProvider: 'plex', plexId: '1001' });
    const second = await deleteRow({ authProvider: 'plex', plexId: '1001' });

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(first.data.plexId).not.toBe(second.data.plexId);
  });

  it('answers as already deleted when a concurrent delete got there first', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'p1', plexId: '1001', plexUsername: 'pat', oidcSubject: null, isSetupAdmin: false, authProvider: 'plex', deletedAt: null, _count: { requests: 0 },
    });
    prismaMock.user.updateMany.mockResolvedValueOnce({ count: 0 });

    const { DELETE } = await import('@/app/api/admin/users/[id]/route');
    const response = await DELETE({} as never, { params: Promise.resolve({ id: 'p1' }) });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/already been deleted/);
  });

  it('refuses deleting your own account whatever the provider, before any lookup', async () => {
    authRequest = { user: { sub: 'plex-admin', role: 'admin' } };

    const { DELETE } = await import('@/app/api/admin/users/[id]/route');
    const response = await DELETE({} as never, { params: Promise.resolve({ id: 'plex-admin' }) });

    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe('You cannot delete your own account');
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it.each(['plex', 'oidc'])('refuses deleting a %s setup admin', async (authProvider) => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'setup-2', plexId: 'x', plexUsername: 'owner', oidcSubject: null, isSetupAdmin: true, authProvider, deletedAt: null, _count: { requests: 0 },
    });

    const { DELETE } = await import('@/app/api/admin/users/[id]/route');
    const response = await DELETE({} as never, { params: Promise.resolve({ id: 'setup-2' }) });

    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatch(/setup admin/);
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it('approves a pending user', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'u5',
      plexUsername: 'user',
      registrationStatus: 'pending_approval',
    });
    prismaMock.user.update.mockResolvedValueOnce({});
    const request = { json: vi.fn().mockResolvedValue({ approve: true }) };

    const { POST } = await import('@/app/api/admin/users/[id]/approve/route');
    const response = await POST(request as any, { params: Promise.resolve({ id: 'u5' }) });
    const payload = await response.json();

    expect(payload.success).toBe(true);
  });

  it('returns 404 when approving a missing user', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    const request = { json: vi.fn().mockResolvedValue({ approve: true }) };

    const { POST } = await import('@/app/api/admin/users/[id]/approve/route');
    const response = await POST(request as any, { params: Promise.resolve({ id: 'missing' }) });
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toMatch(/not found/i);
  });

  it('returns 400 when user is not pending approval', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'u6',
      plexUsername: 'user',
      registrationStatus: 'approved',
    });
    const request = { json: vi.fn().mockResolvedValue({ approve: true }) };

    const { POST } = await import('@/app/api/admin/users/[id]/approve/route');
    const response = await POST(request as any, { params: Promise.resolve({ id: 'u6' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/not pending/);
  });

  it('rejects a pending user when approve is false', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'u7',
      plexUsername: 'user',
      registrationStatus: 'pending_approval',
    });
    prismaMock.user.delete.mockResolvedValueOnce({});
    const request = { json: vi.fn().mockResolvedValue({ approve: false }) };

    const { POST } = await import('@/app/api/admin/users/[id]/approve/route');
    const response = await POST(request as any, { params: Promise.resolve({ id: 'u7' }) });
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(payload.message).toMatch(/rejected/);
  });
});
