/**
 * Component: Home Sections API Route Tests
 * Documentation: documentation/features/home-sections.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: vi.fn((_req: any, handler: any) => {
    const mockReq = {
      user: { id: 'user-1', sub: 'user-1', role: 'user' },
      json: async () => (globalThis as any).__testBody || {},
    };
    return handler(mockReq);
  }),
}));

vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

describe('GET /api/user/home-sections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-apply default mock implementations after clearAllMocks
    prismaMock.userHomeSection.createMany.mockResolvedValue({ count: 0 });
    prismaMock.userHomeSection.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
  });

  it('returns default sections for new user', async () => {
    // ensureDefaultSections check: no existing sections
    prismaMock.userHomeSection.findMany
      .mockResolvedValueOnce([]) // ensureDefaultSections
      .mockResolvedValueOnce([ // actual fetch after defaults created
        { id: '1', sectionType: 'popular', categoryId: null, categoryName: null, sortOrder: 0 },
        { id: '2', sectionType: 'new_releases', categoryId: null, categoryName: null, sortOrder: 1 },
      ]);
    prismaMock.scheduledJob.findFirst.mockResolvedValueOnce(null);

    const { GET } = await import('@/app/api/user/home-sections/route');
    const request = new Request('http://localhost/api/user/home-sections');
    const response = await GET(request as any);
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.sections).toHaveLength(2);
    expect(data.sections[0].sectionType).toBe('popular');
    expect(data.sections[1].sectionType).toBe('new_releases');
  });

  it('returns existing sections without creating defaults', async () => {
    prismaMock.userHomeSection.findMany
      .mockResolvedValueOnce([{ id: '1' }]) // has existing
      .mockResolvedValueOnce([
        { id: '1', sectionType: 'category', categoryId: '123', categoryName: 'Sci-Fi', sortOrder: 0 },
      ]);
    prismaMock.scheduledJob.findFirst.mockResolvedValueOnce({
      nextRun: new Date('2026-03-05T00:00:00Z'),
    });

    const { GET } = await import('@/app/api/user/home-sections/route');
    const request = new Request('http://localhost/api/user/home-sections');
    const response = await GET(request as any);
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.sections).toHaveLength(1);
    expect(data.sections[0].categoryName).toBe('Sci-Fi');
    expect(data.nextRefresh).toBe('2026-03-05T00:00:00.000Z');
    expect(prismaMock.userHomeSection.createMany).not.toHaveBeenCalled();
  });
});

describe('PUT /api/user/home-sections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.userHomeSection.createMany.mockResolvedValue({ count: 0 });
    prismaMock.userHomeSection.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
  });

  it('saves new section configuration', async () => {
    (globalThis as any).__testBody = {
      sections: [
        { sectionType: 'new_releases', sortOrder: 0 },
        { sectionType: 'popular', sortOrder: 1 },
        { sectionType: 'category', categoryId: '123', categoryName: 'Sci-Fi', sortOrder: 2 },
      ],
    };

    prismaMock.userHomeSection.findMany.mockResolvedValueOnce([
      { id: '1', sectionType: 'new_releases', categoryId: null, categoryName: null, sortOrder: 0 },
      { id: '2', sectionType: 'popular', categoryId: null, categoryName: null, sortOrder: 1 },
      { id: '3', sectionType: 'category', categoryId: '123', categoryName: 'Sci-Fi', sortOrder: 2 },
    ]);

    const { PUT } = await import('@/app/api/user/home-sections/route');
    const request = new Request('http://localhost/api/user/home-sections', { method: 'PUT' });
    const response = await PUT(request as any);
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.sections).toHaveLength(3);
    expect(prismaMock.userHomeSection.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
    expect(prismaMock.userHomeSection.createMany).toHaveBeenCalled();
  });

  it('rejects more than 10 sections', async () => {
    (globalThis as any).__testBody = {
      sections: Array.from({ length: 11 }, (_, i) => ({
        sectionType: 'category',
        categoryId: `cat-${i}`,
        categoryName: `Cat ${i}`,
        sortOrder: i,
      })),
    };

    const { PUT } = await import('@/app/api/user/home-sections/route');
    const request = new Request('http://localhost/api/user/home-sections', { method: 'PUT' });
    const response = await PUT(request as any);

    expect(response.status).toBe(400);
  });

  it('rejects duplicate sections', async () => {
    (globalThis as any).__testBody = {
      sections: [
        { sectionType: 'popular', sortOrder: 0 },
        { sectionType: 'popular', sortOrder: 1 },
      ],
    };

    const { PUT } = await import('@/app/api/user/home-sections/route');
    const request = new Request('http://localhost/api/user/home-sections', { method: 'PUT' });
    const response = await PUT(request as any);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.message).toContain('Duplicate');
  });

  it('rejects category section without categoryId', async () => {
    (globalThis as any).__testBody = {
      sections: [{ sectionType: 'category', sortOrder: 0 }],
    };

    const { PUT } = await import('@/app/api/user/home-sections/route');
    const request = new Request('http://localhost/api/user/home-sections', { method: 'PUT' });
    const response = await PUT(request as any);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.message).toContain('categoryId');
  });
});
