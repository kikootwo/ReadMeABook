/**
 * Component: Admin settings routes, the Explicit mark setting (#542)
 * Documentation: documentation/features/explicit-flag.md
 *
 * GET returns `audiobookshelf.explicitMarkEnabled`, false when the key is absent (the upgrade path)
 * or holds anything but 'true'. The ABS PUT writes audiobookshelf.explicit_mark_enabled only for a
 * boolean. Both are admin only (the real requireAdmin).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const configServiceMock = vi.hoisted(() => ({ get: vi.fn(), setMany: vi.fn(), clearCache: vi.fn() }));
const state = vi.hoisted(() => ({ role: 'admin' }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/middleware/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/middleware/auth')>('@/lib/middleware/auth');
  return {
    requireAdmin: actual.requireAdmin,
    requireAuth: (_req: unknown, handler: (r: unknown) => unknown) => handler({ user: { id: 'user-1', role: state.role } }),
  };
});
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configServiceMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => ({ addBackfillRequesterTagsJob: vi.fn() }) }));
vi.mock('@/lib/services/encryption.service', () => ({
  getEncryptionService: () => ({ encrypt: (v: string) => `enc-${v}`, decrypt: (v: string) => v.replace('enc-', ''), isEncryptedFormat: () => false }),
}));

const KEY = 'audiobookshelf.explicit_mark_enabled';

async function getSettings() {
  const { GET } = await import('@/app/api/admin/settings/route');
  const response = await GET({} as never);
  return { status: response.status, body: await response.json() };
}

async function putAbs(body: Record<string, unknown>) {
  const { PUT } = await import('@/app/api/admin/settings/audiobookshelf/route');
  const request = { json: vi.fn().mockResolvedValue({ serverUrl: 'http://abs', apiToken: 'token', libraryId: 'lib', triggerScanAfterImport: false, ...body }) };
  const response = await PUT(request as never);
  return { status: response.status, body: await response.json() };
}

const savedKey = () => configServiceMock.setMany.mock.calls[0]?.[0].find((u: { key: string }) => u.key === KEY);

beforeEach(() => {
  vi.clearAllMocks();
  state.role = 'admin';
  prismaMock.user.count.mockResolvedValue(0);
  prismaMock.user.findMany.mockResolvedValue([]);
  configServiceMock.get.mockResolvedValue(null);
  configServiceMock.setMany.mockResolvedValue(undefined);
});

describe('settings GET: explicitMarkEnabled (#542)', () => {
  it('is false when the key is absent (an upgrade from a version without it)', async () => {
    prismaMock.configuration.findMany.mockResolvedValue([{ key: 'system.backend_mode', value: 'audiobookshelf' }]);

    expect((await getSettings()).body.audiobookshelf.explicitMarkEnabled).toBe(false);
  });

  it.each([['true', true], ['false', false], ['yes', false]])('reads %s as %s', async (value, expected) => {
    prismaMock.configuration.findMany.mockResolvedValue([{ key: KEY, value }]);

    expect((await getSettings()).body.audiobookshelf.explicitMarkEnabled).toBe(expected);
  });

  it('refuses a non-admin', async () => {
    state.role = 'user';
    prismaMock.configuration.findMany.mockResolvedValue([{ key: KEY, value: 'true' }]);

    const res = await getSettings();

    expect(res.status).toBe(403);
    expect(res.body.audiobookshelf).toBeUndefined();
  });
});

describe('ABS settings PUT: explicitMarkEnabled (#542)', () => {
  it.each([[true, 'true'], [false, 'false']])('saves %s as %s', async (sent, stored) => {
    const res = await putAbs({ explicitMarkEnabled: sent });

    expect(res.status).toBe(200);
    expect(savedKey()).toEqual({ key: KEY, value: stored });
  });

  it.each([['omitted', {}], ['a string', { explicitMarkEnabled: 'true' }]])('leaves the key alone when %s', async (_label, body) => {
    await putAbs(body);

    expect(savedKey()).toBeUndefined();
  });

  it('refuses a non-admin and saves nothing', async () => {
    state.role = 'user';

    const res = await putAbs({ explicitMarkEnabled: true });

    expect(res.status).toBe(403);
    expect(configServiceMock.setMany).not.toHaveBeenCalled();
  });
});
