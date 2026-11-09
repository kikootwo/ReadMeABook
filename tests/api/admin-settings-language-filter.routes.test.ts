/**
 * Component: Audible Language Filter Settings Route Tests (#259)
 * Documentation: documentation/integrations/audible-language-filter.md
 *
 * PUT /api/admin/settings/audible takes an optional boolean `languageFilter`; GET
 * /api/admin/settings reports it (an absent key is off).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const configServiceMock = vi.hoisted(() => ({ setMany: vi.fn(), clearCache: vi.fn() }));
const jobQueueMock = vi.hoisted(() => ({ addAudibleRefreshJob: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (_req: unknown, handler: (r: unknown) => unknown) => handler({ user: { id: 'admin-1', role: 'admin' } }),
  requireAdmin: (_req: unknown, handler: () => unknown) => handler(),
}));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configServiceMock }));
vi.mock('@/lib/integrations/audible.service', () => ({ getAudibleService: () => ({ forceReinitialize: () => {} }) }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/services/encryption.service', () => ({
  getEncryptionService: () => ({ decrypt: (value: string) => value, isEncryptedFormat: () => false }),
}));

async function put(body: unknown) {
  const { PUT } = await import('@/app/api/admin/settings/audible/route');
  const response = await PUT({ json: async () => body } as never);
  return { status: response.status, body: await response.json() };
}

async function getSettings(rows: Array<{ key: string; value: string }>) {
  prismaMock.configuration.findMany.mockResolvedValueOnce(rows);
  prismaMock.user.count.mockResolvedValue(0);
  const { GET } = await import('@/app/api/admin/settings/route');
  return (await GET({} as never)).json();
}

beforeEach(() => {
  configServiceMock.setMany.mockResolvedValue(undefined);
  jobQueueMock.addAudibleRefreshJob.mockResolvedValue(undefined);
});

describe('PUT /api/admin/settings/audible languageFilter', () => {
  it.each([['a string', 'true'], ['a number', 1], ['null', null]])('rejects %s with a 400 before any write', async (_label, value) => {
    const { status, body } = await put({ region: 'de', languageFilter: value });

    expect(status).toBe(400);
    expect(body).toEqual({ success: false, error: 'languageFilter must be true or false' });
    expect(configServiceMock.setMany).not.toHaveBeenCalled();
    expect(jobQueueMock.addAudibleRefreshJob).not.toHaveBeenCalled();
  });

  it.each([[true, 'true'], [false, 'false']])('saves %s with the region and clears both cache keys', async (value, stored) => {
    const { status } = await put({ region: 'de', languageFilter: value });

    expect(status).toBe(200);
    expect(configServiceMock.setMany).toHaveBeenCalledWith([
      expect.objectContaining({ key: 'audible.region', value: 'de' }),
      expect.objectContaining({ key: 'audible.language_filter', value: stored, category: 'system' }),
    ]);
    expect(configServiceMock.clearCache).toHaveBeenCalledWith('audible.language_filter');
    expect(jobQueueMock.addAudibleRefreshJob).toHaveBeenCalled();
  });

  it('omitted: keeps the stored value (only the region is written)', async () => {
    await put({ region: 'de' });

    expect(configServiceMock.setMany).toHaveBeenCalledWith([expect.objectContaining({ key: 'audible.region', value: 'de' })]);
  });
});

describe('GET /api/admin/settings audibleLanguageFilter', () => {
  it.each([
    ['absent', false, []],
    ['"false"', false, [{ key: 'audible.language_filter', value: 'false' }]],
    ['"true"', true, [{ key: 'audible.language_filter', value: 'true' }]],
  ])('key %s -> %s', async (_label, expected, rows) => {
    expect((await getSettings(rows)).audibleLanguageFilter).toBe(expected);
  });
});
