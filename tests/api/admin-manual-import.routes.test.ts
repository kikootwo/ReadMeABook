/**
 * Component: Admin Manual Import API Route Tests
 * Documentation: documentation/features/manual-import.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

let authRequest: any;
let requestBody: any;

const prismaMock = createPrismaMock();
const requireAuthMock = vi.hoisted(() => vi.fn());
const requireAdminMock = vi.hoisted(() => vi.fn());
const jobQueueMock = vi.hoisted(() => ({
  addOrganizeJob: vi.fn(() => Promise.resolve()),
}));
const audibleServiceMock = vi.hoisted(() => ({
  getAudiobookDetails: vi.fn(),
}));

// fs mock
const fsMock = vi.hoisted(() => ({
  stat: vi.fn(),
  readdir: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: requireAuthMock,
  requireAdmin: requireAdminMock,
  AuthenticatedRequest: {},
}));

vi.mock('@/lib/services/job-queue.service', () => ({
  getJobQueueService: () => jobQueueMock,
}));

vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => audibleServiceMock,
}));

vi.mock('fs/promises', () => fsMock);

vi.mock('path', async () => {
  const actual = await vi.importActual<typeof import('path')>('path');
  return {
    ...actual,
    default: actual,
    resolve: (...args: string[]) => actual.posix.resolve(...args),
    extname: actual.posix.extname,
  };
});

describe('Admin manual-import route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    authRequest = { user: { id: 'admin-1', role: 'admin' } };
    requestBody = { asin: 'B00TEST0001', folderPath: '/bookdrop/author/title' };

    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
    requireAdminMock.mockImplementation((_req: any, handler: any) => handler());

    // Default: download_dir and media_dir not configured, bookdrop exists
    prismaMock.configuration.findUnique.mockResolvedValue(null);
    fsMock.stat.mockImplementation(async (p: string) => {
      if (p === '/bookdrop') return { isDirectory: () => true };
      if (p === '/bookdrop/author/title') return { isDirectory: () => true };
      throw new Error('ENOENT');
    });
    fsMock.readdir.mockResolvedValue([
      { name: 'chapter1.m4b', isFile: () => true },
    ]);
  });

  it('creates audiobook from Audnexus when ASIN is not in DB or cache', async () => {
    // Neither audiobook nor audibleCache has this ASIN
    prismaMock.audiobook.findFirst.mockResolvedValueOnce(null);
    prismaMock.audibleCache.findUnique.mockResolvedValueOnce(null);

    // Audnexus returns live data
    audibleServiceMock.getAudiobookDetails.mockResolvedValueOnce({
      asin: 'B00TEST0001',
      title: 'Live Title',
      author: 'Live Author',
      coverArtUrl: 'https://example.com/cover.jpg',
      narrator: 'Live Narrator',
      series: 'Test Series',
      seriesPart: '1',
      seriesAsin: 'SERIES0001',
      releaseDate: '2024-01-15',
    });

    // audiobook.create returns the new record
    prismaMock.audiobook.create.mockResolvedValueOnce({
      id: 'ab-new',
      audibleAsin: 'B00TEST0001',
      title: 'Live Title',
      author: 'Live Author',
      status: 'pending',
    });

    // audiobook.findUnique for the verification step
    prismaMock.audiobook.findUnique.mockResolvedValueOnce({
      id: 'ab-new',
      audibleAsin: 'B00TEST0001',
      title: 'Live Title',
      author: 'Live Author',
      status: 'pending',
    });

    // No existing request
    prismaMock.request.findFirst.mockResolvedValueOnce(null);
    prismaMock.request.create.mockResolvedValueOnce({ id: 'req-new' });

    const { POST } = await import('@/app/api/admin/manual-import/route');
    const request = {
      json: vi.fn().mockResolvedValue(requestBody),
      nextUrl: new URL('http://localhost/api/admin/manual-import'),
    };
    const response = await POST(request as any);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(audibleServiceMock.getAudiobookDetails).toHaveBeenCalledWith('B00TEST0001');
    expect(prismaMock.audiobook.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          audibleAsin: 'B00TEST0001',
          title: 'Live Title',
          author: 'Live Author',
        }),
      })
    );
  });

  it('returns 404 when ASIN is not in DB, cache, or Audnexus', async () => {
    prismaMock.audiobook.findFirst.mockResolvedValueOnce(null);
    prismaMock.audibleCache.findUnique.mockResolvedValueOnce(null);
    audibleServiceMock.getAudiobookDetails.mockResolvedValueOnce(null);

    const { POST } = await import('@/app/api/admin/manual-import/route');
    const request = {
      json: vi.fn().mockResolvedValue(requestBody),
      nextUrl: new URL('http://localhost/api/admin/manual-import'),
    };
    const response = await POST(request as any);
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe('Audiobook not found for the given ASIN');
  });

  it('returns 404 when Audnexus lookup throws an error', async () => {
    prismaMock.audiobook.findFirst.mockResolvedValueOnce(null);
    prismaMock.audibleCache.findUnique.mockResolvedValueOnce(null);
    audibleServiceMock.getAudiobookDetails.mockRejectedValueOnce(new Error('Network timeout'));

    const { POST } = await import('@/app/api/admin/manual-import/route');
    const request = {
      json: vi.fn().mockResolvedValue(requestBody),
      nextUrl: new URL('http://localhost/api/admin/manual-import'),
    };
    const response = await POST(request as any);
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe('Audiobook not found for the given ASIN');
  });

  it('uses existing audiobook record when ASIN is in DB', async () => {
    prismaMock.audiobook.findFirst.mockResolvedValueOnce({
      id: 'ab-existing',
      audibleAsin: 'B00TEST0001',
    });

    prismaMock.audiobook.findUnique.mockResolvedValueOnce({
      id: 'ab-existing',
      audibleAsin: 'B00TEST0001',
      title: 'Existing Title',
      author: 'Existing Author',
      status: 'pending',
    });

    prismaMock.request.findFirst.mockResolvedValueOnce(null);
    prismaMock.request.create.mockResolvedValueOnce({ id: 'req-1' });

    const { POST } = await import('@/app/api/admin/manual-import/route');
    const request = {
      json: vi.fn().mockResolvedValue(requestBody),
      nextUrl: new URL('http://localhost/api/admin/manual-import'),
    };
    const response = await POST(request as any);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    // Should NOT have queried audibleCache for ASIN resolution
    expect(prismaMock.audibleCache.findUnique).not.toHaveBeenCalled();
  });

  it('uses audibleCache when ASIN is not in audiobook table but is cached', async () => {
    prismaMock.audiobook.findFirst.mockResolvedValueOnce(null);
    prismaMock.audibleCache.findUnique.mockResolvedValueOnce({
      asin: 'B00TEST0001',
      title: 'Cached Title',
      author: 'Cached Author',
      coverArtUrl: 'https://example.com/cached.jpg',
      narrator: 'Cached Narrator',
    });

    // audiobook.create from cache
    prismaMock.audiobook.create.mockResolvedValueOnce({
      id: 'ab-from-cache',
      audibleAsin: 'B00TEST0001',
      title: 'Cached Title',
      author: 'Cached Author',
      status: 'pending',
    });

    prismaMock.audiobook.findUnique.mockResolvedValueOnce({
      id: 'ab-from-cache',
      audibleAsin: 'B00TEST0001',
      title: 'Cached Title',
      author: 'Cached Author',
      status: 'pending',
    });

    prismaMock.request.findFirst.mockResolvedValueOnce(null);
    prismaMock.request.create.mockResolvedValueOnce({ id: 'req-2' });

    const { POST } = await import('@/app/api/admin/manual-import/route');
    const request = {
      json: vi.fn().mockResolvedValue(requestBody),
      nextUrl: new URL('http://localhost/api/admin/manual-import'),
    };
    const response = await POST(request as any);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    // audiobook.create should have used cache data, not Audnexus
    expect(prismaMock.audiobook.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Cached Title',
          author: 'Cached Author',
        }),
      })
    );
  });
});
