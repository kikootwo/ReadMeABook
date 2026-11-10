/**
 * Component: Bulk Import Match API auth (real auth middleware)
 * Documentation: documentation/features/bulk-import.md
 *
 * GET /api/admin/bulk-import/match is for admin sessions only. An API token, even an admin's, is
 * refused with 403 because the path is not on the token allowlist (src/lib/constants/api-tokens.ts,
 * unchanged); a user session gets 403 and no session 401. A refused call reaches no Audible lookup.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { isEndpointAllowed } from '@/lib/constants/api-tokens';

const ISSUED_AT = vi.hoisted(() => 1_700_000_000);
const audibleMock = vi.hoisted(() => ({ getAudiobookDetails: vi.fn(), search: vi.fn() }));
const sessionUsers = vi.hoisted(() => ({
  'u-admin': { id: 'u-admin', role: 'admin', deletedAt: null, registrationStatus: 'approved' },
  'u-user': { id: 'u-user', role: 'user', deletedAt: null, registrationStatus: 'approved' },
} as Record<string, { id: string; role: string; deletedAt: null; registrationStatus: string }>));

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  apiToken: { findUnique: vi.fn(), update: vi.fn() },
  audiobook: { findFirst: vi.fn() },
  audibleCache: { findUnique: vi.fn() },
  plexLibrary: { findMany: vi.fn() },
  request: { findMany: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/utils/jwt', () => ({
  verifyAccessToken: (token: string) =>
    token === 'admin-token' ? { sub: 'u-admin', role: 'admin', plexId: 'local-admin', username: 'admin', iat: ISSUED_AT }
      : token === 'user-token' ? { sub: 'u-user', role: 'user', plexId: 'local-user', username: 'user', iat: ISSUED_AT }
      : null,
}));
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({
    get: async () => null,
    getBackendMode: async () => 'audiobookshelf',
    getAudibleRegion: async () => 'us',
  }),
}));
vi.mock('@/lib/integrations/audible.service', () => ({ getAudibleService: () => audibleMock }));

async function call(token: string | null) {
  const { GET } = await import('@/app/api/admin/bulk-import/match/route');
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await GET(new NextRequest('http://localhost/api/admin/bulk-import/match?q=Some%20title', { headers }));
  return { status: response.status, body: await response.json() };
}

describe('GET /api/admin/bulk-import/match: who may call it', () => {
  beforeEach(() => {
    prismaMock.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => sessionUsers[where.id] ?? null);
    prismaMock.apiToken.findUnique.mockResolvedValue({
      id: 't1', tokenPrefix: 'rmab_abc', expiresAt: null, role: 'admin',
      tokenUser: { id: 'u-admin', plexId: 'local-admin', plexUsername: 'admin', role: 'admin', deletedAt: null, registrationStatus: 'approved' },
    });
    prismaMock.apiToken.update.mockResolvedValue({});
    audibleMock.search.mockResolvedValue({ results: [] });
    prismaMock.plexLibrary.findMany.mockResolvedValue([]);
    prismaMock.request.findMany.mockResolvedValue([]);
  });

  it('is not on the API token allowlist', () => {
    expect(isEndpointAllowed('GET', '/api/admin/bulk-import/match')).toBe(false);
  });

  it('answers an admin session', async () => {
    const res = await call('admin-token');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kind: 'search', results: [] });
    expect(audibleMock.search).toHaveBeenCalledTimes(1);
  });

  it('refuses an API token, even an admin one', async () => {
    const res = await call('rmab_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('This endpoint is not available via API token authentication');
    expect(audibleMock.search).not.toHaveBeenCalled();
  });

  it('refuses a user session', async () => {
    const res = await call('user-token');

    expect(res.status).toBe(403);
    expect(audibleMock.search).not.toHaveBeenCalled();
  });

  it('refuses a call with no session', async () => {
    const res = await call(null);

    expect(res.status).toBe(401);
    expect(audibleMock.search).not.toHaveBeenCalled();
  });
});
