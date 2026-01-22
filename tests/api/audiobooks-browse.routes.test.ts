/**
 * Component: Audiobooks Browse API Route Tests
 * Documentation: documentation/testing.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const audibleServiceMock = vi.hoisted(() => ({
  search: vi.fn(),
  getAudiobookDetails: vi.fn(),
}));
const enrichMock = vi.hoisted(() => vi.fn());
const currentUserMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => audibleServiceMock,
}));

vi.mock('@/lib/utils/audiobook-matcher', () => ({
  enrichAudiobooksWithMatches: enrichMock,
}));

vi.mock('@/lib/middleware/auth', () => ({
  getCurrentUser: currentUserMock,
}));

describe('Audiobooks browse routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enrichMock.mockResolvedValue([]);
    currentUserMock.mockReturnValue(null);
  });

  it('searches Audible and enriches results', async () => {
    audibleServiceMock.search.mockResolvedValue({
      query: 'query',
      results: [{ asin: 'ASIN', title: 'Title', author: 'Author' }],
      totalResults: 1,
      page: 1,
      hasMore: false,
    });
    currentUserMock.mockReturnValue({ sub: 'user-1' });
    enrichMock.mockResolvedValue([{ asin: 'ASIN', available: false }]);

    const { GET } = await import('@/app/api/audiobooks/search/route');
    const response = await GET({ nextUrl: new URL('http://app/api/audiobooks/search?q=query') } as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(enrichMock).toHaveBeenCalledWith([{ asin: 'ASIN', title: 'Title', author: 'Author' }], 'user-1');
  });

  it('returns 400 for invalid popular pagination', async () => {
    const { GET } = await import('@/app/api/audiobooks/popular/route');

    const response = await GET({ nextUrl: new URL('http://app/api/audiobooks/popular?page=0') } as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('ValidationError');
  });

  it('returns popular audiobooks with cached cover URLs', async () => {
    prismaMock.audibleCache.findMany.mockResolvedValueOnce([
      {
        asin: 'ASIN',
        title: 'Title',
        author: 'Author',
        narrator: null,
        description: null,
        coverArtUrl: 'http://image',
        cachedCoverPath: '/tmp/cache/asin.jpg',
        durationMinutes: 90,
        releaseDate: new Date('2024-01-01'),
        rating: 4.5,
        genres: [],
        lastSyncedAt: new Date(),
      },
    ]);
    prismaMock.audibleCache.count.mockResolvedValueOnce(1);
    enrichMock.mockResolvedValueOnce([{ asin: 'ASIN', coverArtUrl: '/api/cache/thumbnails/asin.jpg' }]);

    const { GET } = await import('@/app/api/audiobooks/popular/route');
    const response = await GET({ nextUrl: new URL('http://app/api/audiobooks/popular?page=1&limit=1') } as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(payload.audiobooks[0].coverArtUrl).toBe('/api/cache/thumbnails/asin.jpg');
  });

  it('returns 400 for invalid new releases pagination', async () => {
    const { GET } = await import('@/app/api/audiobooks/new-releases/route');

    const response = await GET({ nextUrl: new URL('http://app/api/audiobooks/new-releases?page=0') } as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('ValidationError');
  });

  it('returns new release audiobooks', async () => {
    prismaMock.audibleCache.findMany.mockResolvedValueOnce([]);
    prismaMock.audibleCache.count.mockResolvedValueOnce(0);

    const { GET } = await import('@/app/api/audiobooks/new-releases/route');
    const response = await GET({ nextUrl: new URL('http://app/api/audiobooks/new-releases?page=1&limit=1') } as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(payload.count).toBe(0);
  });

  it('enriches new releases and uses cached cover URLs', async () => {
    prismaMock.audibleCache.findMany.mockResolvedValueOnce([
      {
        asin: 'ASIN',
        title: 'Title',
        author: 'Author',
        narrator: null,
        description: null,
        coverArtUrl: 'http://image',
        cachedCoverPath: '/tmp/cache/asin.jpg',
        durationMinutes: 90,
        releaseDate: new Date('2024-01-01'),
        rating: '4.2',
        genres: ['Fiction'],
        lastSyncedAt: new Date('2024-01-02'),
      },
    ]);
    prismaMock.audibleCache.count.mockResolvedValueOnce(1);
    currentUserMock.mockReturnValue({ sub: 'user-1' });
    enrichMock.mockResolvedValueOnce([{ asin: 'ASIN', available: true }]);

    const { GET } = await import('@/app/api/audiobooks/new-releases/route');
    const response = await GET({ nextUrl: new URL('http://app/api/audiobooks/new-releases?page=1&limit=1') } as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(enrichMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          asin: 'ASIN',
          coverArtUrl: '/api/cache/thumbnails/asin.jpg',
        }),
      ],
      'user-1'
    );
  });

  it('returns 500 when new releases query fails', async () => {
    prismaMock.audibleCache.findMany.mockRejectedValueOnce(new Error('db down'));

    const { GET } = await import('@/app/api/audiobooks/new-releases/route');
    const response = await GET({ nextUrl: new URL('http://app/api/audiobooks/new-releases?page=1&limit=1') } as any);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toBe('FetchError');
  });

  it('returns audiobook details when ASIN is valid', async () => {
    audibleServiceMock.getAudiobookDetails.mockResolvedValue({ asin: 'ASIN123456', title: 'Title' });
    const { GET } = await import('@/app/api/audiobooks/[asin]/route');

    const response = await GET({} as any, { params: Promise.resolve({ asin: 'ASIN123456' }) });
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(payload.audiobook.asin).toBe('ASIN123456');
  });

  it('returns 400 when ASIN is invalid', async () => {
    const { GET } = await import('@/app/api/audiobooks/[asin]/route');

    const response = await GET({} as any, { params: Promise.resolve({ asin: 'BAD' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('ValidationError');
  });

  it('returns 404 when audiobook is not found', async () => {
    audibleServiceMock.getAudiobookDetails.mockResolvedValue(null);
    const { GET } = await import('@/app/api/audiobooks/[asin]/route');

    const response = await GET({} as any, { params: Promise.resolve({ asin: 'ASIN123456' }) });
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe('NotFound');
  });

  it('returns 500 when audiobook lookup fails', async () => {
    audibleServiceMock.getAudiobookDetails.mockRejectedValue(new Error('fail'));
    const { GET } = await import('@/app/api/audiobooks/[asin]/route');

    const response = await GET({} as any, { params: Promise.resolve({ asin: 'ASIN123456' }) });
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toBe('FetchError');
  });

  it('returns cached covers for login', async () => {
    prismaMock.audibleCache.findMany.mockResolvedValueOnce([
      { asin: 'ASIN', title: 'Title', author: 'Author', cachedCoverPath: '/tmp/asin.jpg', coverArtUrl: null },
    ]);
    const { GET } = await import('@/app/api/audiobooks/covers/route');

    const response = await GET();
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(payload.covers[0].coverUrl).toBe('/api/cache/thumbnails/asin.jpg');
  });
});


