/**
 * Component: Audiobookshelf E-Reader Devices API Tests
 * Documentation: documentation/integrations/ebook-sidecar.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getEreaderDevicesMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: vi.fn((_req: unknown, handler: (req: unknown) => unknown) => handler({ user: { id: 'admin-1', role: 'admin' } })),
  requireAdmin: vi.fn((_req: unknown, handler: () => unknown) => handler()),
}));
vi.mock('@/lib/services/audiobookshelf/ereader', () => ({ getEreaderDevices: getEreaderDevicesMock }));

describe('GET /api/admin/settings/ebook/ereader-devices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists the Audiobookshelf devices', async () => {
    getEreaderDevicesMock.mockResolvedValue([{ name: 'Kindle', email: 'me@kindle.com', sendable: true }]);
    const { GET } = await import('@/app/api/admin/settings/ebook/ereader-devices/route');

    const payload = await (await GET({} as any)).json();

    expect(payload).toEqual({ devices: [{ name: 'Kindle', email: 'me@kindle.com', sendable: true }] });
  });

  it('answers an empty list when Audiobookshelf is unreachable or not configured', async () => {
    getEreaderDevicesMock.mockRejectedValue(new Error('Audiobookshelf not configured'));
    const { GET } = await import('@/app/api/admin/settings/ebook/ereader-devices/route');

    const response = await GET({} as any);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.devices).toEqual([]);
  });
});
