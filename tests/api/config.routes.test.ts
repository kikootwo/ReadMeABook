/**
 * Component: Config API Route Tests
 * Documentation: documentation/testing.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const configServiceMock = vi.hoisted(() => ({
  setMany: vi.fn(),
  getAll: vi.fn(),
  getCategory: vi.fn(),
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configServiceMock,
}));

describe('Config API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns full configuration', async () => {
    configServiceMock.getAll.mockResolvedValue({ plex_url: 'http://plex' });
    const { GET } = await import('@/app/api/config/route');

    const response = await GET();
    const payload = await response.json();

    expect(payload.config.plex_url).toBe('http://plex');
  });

  it('updates configuration values', async () => {
    const { PUT } = await import('@/app/api/config/route');
    const response = await PUT({
      json: vi.fn().mockResolvedValue({
        updates: [{ key: 'plex_url', value: 'http://plex' }],
      }),
    } as any);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.updated).toBe(1);
    expect(configServiceMock.setMany).toHaveBeenCalled();
  });

  it('returns 400 when configuration update payload is invalid', async () => {
    const { PUT } = await import('@/app/api/config/route');
    const response = await PUT({ json: vi.fn().mockResolvedValue({}) } as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/Validation error/);
  });

  it('returns 500 when configuration update fails', async () => {
    configServiceMock.setMany.mockRejectedValueOnce(new Error('db down'));
    const { PUT } = await import('@/app/api/config/route');
    const response = await PUT({
      json: vi.fn().mockResolvedValue({
        updates: [{ key: 'plex_url', value: 'http://plex' }],
      }),
    } as any);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toMatch(/Failed to update configuration/);
  });

  it('returns 500 when configuration lookup fails', async () => {
    configServiceMock.getAll.mockRejectedValueOnce(new Error('db down'));
    const { GET } = await import('@/app/api/config/route');

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toMatch(/Failed to get configuration/);
  });

  it('returns category configuration', async () => {
    configServiceMock.getCategory.mockResolvedValue({ plex_url: 'http://plex' });
    const { GET } = await import('@/app/api/config/[category]/route');

    const response = await GET({} as any, { params: Promise.resolve({ category: 'plex' }) });
    const payload = await response.json();

    expect(payload.category).toBe('plex');
    expect(payload.config.plex_url).toBe('http://plex');
  });

  it('returns 500 when category configuration lookup fails', async () => {
    configServiceMock.getCategory.mockRejectedValueOnce(new Error('db down'));
    const { GET } = await import('@/app/api/config/[category]/route');

    const response = await GET({} as any, { params: Promise.resolve({ category: 'plex' }) });
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toMatch(/Failed to get configuration/);
  });
});


