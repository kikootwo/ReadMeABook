/**
 * Component: Admin Audible Settings API Route Tests
 * Documentation: documentation/settings-pages.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

let authRequest: any;

const requireAuthMock = vi.hoisted(() => vi.fn());
const requireAdminMock = vi.hoisted(() => vi.fn());
const configServiceMock = vi.hoisted(() => ({
  setMany: vi.fn(),
  clearCache: vi.fn(),
}));
const audibleServiceMock = vi.hoisted(() => ({
  forceReinitialize: vi.fn(),
}));
const jobQueueMock = vi.hoisted(() => ({
  addAudibleRefreshJob: vi.fn(),
}));

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: requireAuthMock,
  requireAdmin: requireAdminMock,
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configServiceMock,
}));

vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => audibleServiceMock,
}));

vi.mock('@/lib/services/job-queue.service', () => ({
  getJobQueueService: () => jobQueueMock,
}));

describe('Admin Audible settings route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = { user: { id: 'admin-1', role: 'admin' }, json: vi.fn() };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
    requireAdminMock.mockImplementation((_req: any, handler: any) => handler());
  });

  it('updates Audible region and triggers refresh', async () => {
    const request = { json: vi.fn().mockResolvedValue({ region: 'us' }) };

    const { PUT } = await import('@/app/api/admin/settings/audible/route');
    const response = await PUT(request as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(jobQueueMock.addAudibleRefreshJob).toHaveBeenCalled();
  });

  it('saves the Audible language filter with the region', async () => {
    const request = { json: vi.fn().mockResolvedValue({ region: 'fr', languageFilter: true }) };

    const { PUT } = await import('@/app/api/admin/settings/audible/route');
    const response = await PUT(request as any);

    expect(response.status).toBe(200);
    expect(configServiceMock.setMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ key: 'audible.region', value: 'fr' }),
        expect.objectContaining({ key: 'audible.language_filter', value: 'true' }),
      ]),
    );
    expect(configServiceMock.clearCache).toHaveBeenCalledWith('audible.language_filter');
  });

  it('leaves the Audible language filter untouched when only the region is sent', async () => {
    const request = { json: vi.fn().mockResolvedValue({ region: 'us' }) };

    const { PUT } = await import('@/app/api/admin/settings/audible/route');
    await PUT(request as any);

    const updates = configServiceMock.setMany.mock.calls[0][0];
    expect(updates.map((u: { key: string }) => u.key)).toEqual(['audible.region']);
  });

  it('rejects a non-boolean Audible language filter', async () => {
    const request = { json: vi.fn().mockResolvedValue({ region: 'fr', languageFilter: 'yes' }) };

    const { PUT } = await import('@/app/api/admin/settings/audible/route');
    const response = await PUT(request as any);

    expect(response.status).toBe(400);
    expect(configServiceMock.setMany).not.toHaveBeenCalled();
  });
});
