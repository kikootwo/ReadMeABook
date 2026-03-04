/**
 * Component: Works Service Tests
 * Documentation: documentation/integrations/audible.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import type { DedupGroup } from '@/lib/utils/deduplicate-audiobooks';

const prismaMock = createPrismaMock();

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: {
    create: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

describe('persistDedupGroups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('creates new work + work_asins for a fresh group', async () => {
    prismaMock.workAsin.findMany.mockResolvedValue([]);
    prismaMock.work.create.mockResolvedValue({ id: 'work-1' });
    prismaMock.workAsin.create.mockResolvedValue({});
    prismaMock.workAsin.updateMany.mockResolvedValue({ count: 0 });

    const { persistDedupGroups } = await import('@/lib/services/works.service');

    const groups: DedupGroup[] = [{
      canonicalAsin: 'ASIN_A',
      allAsins: ['ASIN_A', 'ASIN_B'],
      title: 'Test Book',
      author: 'Test Author',
      narrator: 'Test Narrator',
      durationMinutes: 600,
    }];

    await persistDedupGroups(groups);

    expect(prismaMock.work.create).toHaveBeenCalledWith({
      data: { title: 'Test Book', author: 'Test Author' },
    });
    expect(prismaMock.workAsin.create).toHaveBeenCalledTimes(2);

    // Canonical ASIN should have narrator, duration, isCanonical=true
    expect(prismaMock.workAsin.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workId: 'work-1',
        asin: 'ASIN_A',
        narrator: 'Test Narrator',
        durationMinutes: 600,
        isCanonical: true,
        source: 'dedup_auto',
      }),
    });

    // Non-canonical ASIN should have isCanonical=false
    expect(prismaMock.workAsin.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workId: 'work-1',
        asin: 'ASIN_B',
        isCanonical: false,
        source: 'dedup_auto',
      }),
    });
  });

  it('adds new ASINs to existing work when canonical already exists', async () => {
    prismaMock.workAsin.findMany.mockResolvedValue([
      { asin: 'ASIN_A', workId: 'existing-work' },
    ]);
    prismaMock.workAsin.create.mockResolvedValue({});
    prismaMock.workAsin.updateMany.mockResolvedValue({ count: 1 });

    const { persistDedupGroups } = await import('@/lib/services/works.service');

    const groups: DedupGroup[] = [{
      canonicalAsin: 'ASIN_A',
      allAsins: ['ASIN_A', 'ASIN_B', 'ASIN_C'],
      title: 'Test Book',
      author: 'Test Author',
      narrator: 'Narrator',
      durationMinutes: 500,
    }];

    await persistDedupGroups(groups);

    // Should NOT create a new work
    expect(prismaMock.work.create).not.toHaveBeenCalled();

    // Should create entries for ASIN_B and ASIN_C only (ASIN_A already exists)
    expect(prismaMock.workAsin.create).toHaveBeenCalledTimes(2);
    expect(prismaMock.workAsin.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workId: 'existing-work',
        asin: 'ASIN_B',
      }),
    });
    expect(prismaMock.workAsin.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workId: 'existing-work',
        asin: 'ASIN_C',
      }),
    });
  });

  it('merges two separate works when dedup groups them together', async () => {
    // ASIN_A is in work-1, ASIN_B is in work-2
    prismaMock.workAsin.findMany.mockResolvedValue([
      { asin: 'ASIN_A', workId: 'work-1' },
      { asin: 'ASIN_B', workId: 'work-2' },
    ]);
    prismaMock.workAsin.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.work.deleteMany.mockResolvedValue({ count: 1 });

    const { persistDedupGroups } = await import('@/lib/services/works.service');

    const groups: DedupGroup[] = [{
      canonicalAsin: 'ASIN_A',
      allAsins: ['ASIN_A', 'ASIN_B'],
      title: 'Merged Book',
      author: 'Author',
    }];

    await persistDedupGroups(groups);

    // Should move work-2 ASINs to work-1
    expect(prismaMock.workAsin.updateMany).toHaveBeenCalledWith({
      where: { workId: { in: ['work-2'] } },
      data: { workId: 'work-1' },
    });

    // Should delete work-2
    expect(prismaMock.work.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['work-2'] } },
    });
  });

  it('silently catches and logs errors without throwing', async () => {
    prismaMock.workAsin.findMany.mockRejectedValue(new Error('DB connection failed'));

    const { persistDedupGroups } = await import('@/lib/services/works.service');

    const groups: DedupGroup[] = [{
      canonicalAsin: 'ASIN_A',
      allAsins: ['ASIN_A', 'ASIN_B'],
      title: 'Test',
      author: 'Auth',
    }];

    // Should not throw
    await expect(persistDedupGroups(groups)).resolves.toBeUndefined();
  });
});

describe('seedAsin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('creates single-ASIN work for new ASIN', async () => {
    prismaMock.workAsin.findUnique.mockResolvedValue(null);
    prismaMock.work.create.mockResolvedValue({ id: 'new-work' });
    prismaMock.workAsin.create.mockResolvedValue({});

    const { seedAsin } = await import('@/lib/services/works.service');

    await seedAsin('NEW_ASIN', 'New Book', 'Author', 'Narrator', 300);

    expect(prismaMock.work.create).toHaveBeenCalledWith({
      data: { title: 'New Book', author: 'Author' },
    });
    expect(prismaMock.workAsin.create).toHaveBeenCalledWith({
      data: {
        workId: 'new-work',
        asin: 'NEW_ASIN',
        narrator: 'Narrator',
        durationMinutes: 300,
        isCanonical: true,
        source: 'dedup_auto',
      },
    });
  });

  it('does nothing for already-tracked ASIN', async () => {
    prismaMock.workAsin.findUnique.mockResolvedValue({
      id: 'existing',
      asin: 'EXISTING_ASIN',
      workId: 'work-1',
    });

    const { seedAsin } = await import('@/lib/services/works.service');

    await seedAsin('EXISTING_ASIN', 'Book', 'Author');

    expect(prismaMock.work.create).not.toHaveBeenCalled();
    expect(prismaMock.workAsin.create).not.toHaveBeenCalled();
  });

  it('silently catches and logs errors without throwing', async () => {
    prismaMock.workAsin.findUnique.mockRejectedValue(new Error('DB error'));

    const { seedAsin } = await import('@/lib/services/works.service');

    await expect(seedAsin('ASIN', 'Book', 'Auth')).resolves.toBeUndefined();
  });
});

describe('getSiblingAsins', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns sibling ASINs correctly', async () => {
    // First query: find input ASINs and their work IDs
    prismaMock.workAsin.findMany
      .mockResolvedValueOnce([
        { asin: 'ASIN_A', workId: 'work-1' },
        { asin: 'ASIN_C', workId: 'work-2' },
      ])
      // Second query: all ASINs in those works
      .mockResolvedValueOnce([
        { asin: 'ASIN_A', workId: 'work-1' },
        { asin: 'ASIN_B', workId: 'work-1' },
        { asin: 'ASIN_C', workId: 'work-2' },
        { asin: 'ASIN_D', workId: 'work-2' },
        { asin: 'ASIN_E', workId: 'work-2' },
      ]);

    const { getSiblingAsins } = await import('@/lib/services/works.service');

    const result = await getSiblingAsins(['ASIN_A', 'ASIN_C']);

    expect(result.get('ASIN_A')).toEqual(['ASIN_B']);
    expect(result.get('ASIN_C')).toEqual(['ASIN_D', 'ASIN_E']);
  });

  it('returns empty map for unknown ASINs', async () => {
    prismaMock.workAsin.findMany.mockResolvedValue([]);

    const { getSiblingAsins } = await import('@/lib/services/works.service');

    const result = await getSiblingAsins(['UNKNOWN']);

    expect(result.size).toBe(0);
  });

  it('returns empty map for empty input', async () => {
    const { getSiblingAsins } = await import('@/lib/services/works.service');

    const result = await getSiblingAsins([]);

    expect(result.size).toBe(0);
    // Should not query DB
    expect(prismaMock.workAsin.findMany).not.toHaveBeenCalled();
  });

  it('excludes the input ASIN itself from siblings', async () => {
    prismaMock.workAsin.findMany
      .mockResolvedValueOnce([
        { asin: 'ASIN_A', workId: 'work-1' },
      ])
      .mockResolvedValueOnce([
        { asin: 'ASIN_A', workId: 'work-1' },
        { asin: 'ASIN_B', workId: 'work-1' },
      ]);

    const { getSiblingAsins } = await import('@/lib/services/works.service');

    const result = await getSiblingAsins(['ASIN_A']);

    expect(result.get('ASIN_A')).toEqual(['ASIN_B']);
    expect(result.get('ASIN_A')).not.toContain('ASIN_A');
  });

  it('omits ASINs with no siblings (single-ASIN works)', async () => {
    prismaMock.workAsin.findMany
      .mockResolvedValueOnce([
        { asin: 'ASIN_LONELY', workId: 'work-solo' },
      ])
      .mockResolvedValueOnce([
        { asin: 'ASIN_LONELY', workId: 'work-solo' },
      ]);

    const { getSiblingAsins } = await import('@/lib/services/works.service');

    const result = await getSiblingAsins(['ASIN_LONELY']);

    // No siblings means it shouldn't be in the map at all
    expect(result.has('ASIN_LONELY')).toBe(false);
  });
});
