/**
 * Component: BookDate Library Route Tests
 * Documentation: documentation/features/bookdate.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

let authRequest: any;

const prismaMock = createPrismaMock();
const requireAuthMock = vi.hoisted(() => vi.fn());
const configMock = vi.hoisted(() => ({
  getBackendMode: vi.fn(),
  get: vi.fn(),
  getPlexConfig: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: requireAuthMock,
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configMock,
}));

describe('BookDate library route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = { user: { id: 'user-1' } };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
  });

  it('returns 400 when Audiobookshelf library ID is missing', async () => {
    configMock.getBackendMode.mockResolvedValue('audiobookshelf');
    configMock.get.mockResolvedValue(null);

    const { GET } = await import('@/app/api/bookdate/library/route');
    const response = await GET({} as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/Audiobookshelf library ID/i);
  });

  it('returns 400 when Plex library ID is missing', async () => {
    configMock.getBackendMode.mockResolvedValue('plex');
    configMock.getPlexConfig.mockResolvedValue({ libraryId: null });

    const { GET } = await import('@/app/api/bookdate/library/route');
    const response = await GET({} as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/Plex library ID/i);
  });

  it('returns books with cover priority (library cache > audible cache > null)', async () => {
    configMock.getBackendMode.mockResolvedValue('plex');
    configMock.getPlexConfig.mockResolvedValue({ libraryId: 'lib-1' });

    prismaMock.plexLibrary.findMany.mockResolvedValue([
      {
        id: 'book-1',
        title: 'Cached Cover',
        author: 'Author A',
        asin: 'ASIN1',
        cachedLibraryCoverPath: '/cache/library/cover1.jpg',
      },
      {
        id: 'book-2',
        title: 'Audible Cover',
        author: 'Author B',
        asin: 'ASIN2',
        cachedLibraryCoverPath: null,
      },
      {
        id: 'book-3',
        title: 'No Cover',
        author: 'Author C',
        asin: null,
        cachedLibraryCoverPath: null,
      },
    ]);

    prismaMock.audibleCache.findMany.mockResolvedValue([
      { asin: 'ASIN1', coverArtUrl: 'http://audible/cover1.jpg' },
      { asin: 'ASIN2', coverArtUrl: 'http://audible/cover2.jpg' },
    ]);

    const { GET } = await import('@/app/api/bookdate/library/route');
    const response = await GET({} as any);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.books).toEqual([
      {
        id: 'book-1',
        title: 'Cached Cover',
        author: 'Author A',
        coverUrl: '/api/cache/library/cover1.jpg',
      },
      {
        id: 'book-2',
        title: 'Audible Cover',
        author: 'Author B',
        coverUrl: 'http://audible/cover2.jpg',
      },
      {
        id: 'book-3',
        title: 'No Cover',
        author: 'Author C',
        coverUrl: null,
      },
    ]);
  });

  it('returns 500 when database lookup fails', async () => {
    configMock.getBackendMode.mockResolvedValue('plex');
    configMock.getPlexConfig.mockResolvedValue({ libraryId: 'lib-1' });
    prismaMock.plexLibrary.findMany.mockRejectedValue(new Error('db down'));

    const { GET } = await import('@/app/api/bookdate/library/route');
    const response = await GET({} as any);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toMatch(/db down/i);
  });
});
