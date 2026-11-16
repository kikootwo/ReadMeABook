/**
 * Component: Works Service Tests
 * Documentation: documentation/integrations/audible.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import type { DedupGroup } from '@/lib/utils/deduplicate-audiobooks';
import type { AudibleAudiobook } from '@/lib/integrations/audible.service';

function makeBook(overrides: Partial<AudibleAudiobook> & { asin: string }): AudibleAudiobook {
  return {
    title: 'Test Book',
    author: 'Test Author',
    ...overrides,
  };
}

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
    prismaMock.workAsin.createMany.mockResolvedValue({ count: 2 });
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
    // Canonical ASIN carries narrator, duration, isCanonical=true; concurrent inserts are skipped
    expect(prismaMock.workAsin.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          workId: 'work-1', asin: 'ASIN_A', narrator: 'Test Narrator', durationMinutes: 600, isCanonical: true, source: 'dedup_auto',
        }),
        expect.objectContaining({ workId: 'work-1', asin: 'ASIN_B', isCanonical: false, source: 'dedup_auto' }),
      ],
      skipDuplicates: true,
    });
    expect(prismaMock.work.deleteMany).not.toHaveBeenCalled();
  });

  it('adds new ASINs to existing work when canonical already exists', async () => {
    prismaMock.workAsin.findMany.mockResolvedValue([
      { asin: 'ASIN_A', workId: 'existing-work' },
    ]);
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
    expect(prismaMock.workAsin.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ workId: 'existing-work', asin: 'ASIN_B' }),
        expect.objectContaining({ workId: 'existing-work', asin: 'ASIN_C' }),
      ],
      skipDuplicates: true,
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

    // Should move the group's rows of work-2 to work-1 (both works lie wholly inside the group)
    expect(prismaMock.workAsin.updateMany).toHaveBeenCalledWith({
      where: { asin: { in: ['ASIN_A', 'ASIN_B'] }, workId: { in: ['work-2'] } },
      data: { workId: 'work-1' },
    });

    // Should delete work-2 only if it is left empty
    expect(prismaMock.work.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['work-2'] }, asins: { none: {} } },
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

describe('collapseByExistingWorks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns input unchanged when the list is empty or has one entry', async () => {
    const { collapseByExistingWorks } = await import('@/lib/services/works.service');

    expect(await collapseByExistingWorks([])).toEqual([]);
    expect(prismaMock.workAsin.findMany).not.toHaveBeenCalled();

    const single = [makeBook({ asin: 'A1' })];
    expect(await collapseByExistingWorks(single)).toEqual(single);
    expect(prismaMock.workAsin.findMany).not.toHaveBeenCalled();
  });

  it('returns input unchanged when none of the ASINs are in any work', async () => {
    prismaMock.workAsin.findMany.mockResolvedValue([]);

    const { collapseByExistingWorks } = await import('@/lib/services/works.service');

    const books = [
      makeBook({ asin: 'A1', title: 'Alpha' }),
      makeBook({ asin: 'A2', title: 'Beta' }),
    ];

    const result = await collapseByExistingWorks(books);
    expect(result).toEqual(books);
  });

  it('collapses two ASINs that share a work to a single representative', async () => {
    prismaMock.workAsin.findMany.mockResolvedValue([
      { asin: 'A1', workId: 'work-1' },
      { asin: 'A2', workId: 'work-1' },
    ]);

    const { collapseByExistingWorks } = await import('@/lib/services/works.service');

    const books = [
      makeBook({ asin: 'A1', title: 'The Passengers', coverArtUrl: 'cover.jpg' }),
      makeBook({ asin: 'A2', title: 'The Passengers' }),
    ];

    const result = await collapseByExistingWorks(books);
    expect(result).toHaveLength(1);
    // A1 wins — it has the cover URL (higher metadata score)
    expect(result[0].asin).toBe('A1');
  });

  it('keeps the richest-metadata entry when collapsing, regardless of input order', async () => {
    prismaMock.workAsin.findMany.mockResolvedValue([
      { asin: 'A1', workId: 'work-1' },
      { asin: 'A2', workId: 'work-1' },
    ]);

    const { collapseByExistingWorks } = await import('@/lib/services/works.service');

    // A1 first (sparse), A2 second (rich) — A2 should win on score
    const books = [
      makeBook({ asin: 'A1', title: 'Book' }),
      makeBook({
        asin: 'A2',
        title: 'Book',
        coverArtUrl: 'cover.jpg',
        rating: 4.5,
        durationMinutes: 600,
        narrator: 'Full Cast',
        description: 'Rich book',
        releaseDate: '2024-01-01',
        genres: ['Fiction'],
      }),
    ];

    const result = await collapseByExistingWorks(books);
    expect(result).toHaveLength(1);
    expect(result[0].asin).toBe('A2');
  });

  it('preserves position of the work in the input order', async () => {
    prismaMock.workAsin.findMany.mockResolvedValue([
      { asin: 'A2', workId: 'work-1' },
      { asin: 'A4', workId: 'work-1' },
    ]);

    const { collapseByExistingWorks } = await import('@/lib/services/works.service');

    const books = [
      makeBook({ asin: 'A1', title: 'Alpha' }),
      makeBook({ asin: 'A2', title: 'Beta' }),
      makeBook({ asin: 'A3', title: 'Gamma' }),
      makeBook({ asin: 'A4', title: 'Beta' }),
      makeBook({ asin: 'A5', title: 'Delta' }),
    ];

    const result = await collapseByExistingWorks(books);
    // A2 and A4 collapse to one entry at position 1 (the first occurrence)
    expect(result.map(b => b.asin)).toEqual(['A1', 'A2', 'A3', 'A5']);
  });

  it('handles multiple independent works in the same batch', async () => {
    prismaMock.workAsin.findMany.mockResolvedValue([
      { asin: 'A1', workId: 'work-1' },
      { asin: 'A2', workId: 'work-1' },
      { asin: 'B1', workId: 'work-2' },
      { asin: 'B2', workId: 'work-2' },
      { asin: 'B3', workId: 'work-2' },
    ]);

    const { collapseByExistingWorks } = await import('@/lib/services/works.service');

    const books = [
      makeBook({ asin: 'A1' }),
      makeBook({ asin: 'B1' }),
      makeBook({ asin: 'A2' }),
      makeBook({ asin: 'B2' }),
      makeBook({ asin: 'B3' }),
      makeBook({ asin: 'C1' }),
    ];

    const result = await collapseByExistingWorks(books);
    expect(result.map(b => b.asin)).toEqual(['A1', 'B1', 'C1']);
  });

  it('passes through books that are not in any work alongside collapsed ones', async () => {
    prismaMock.workAsin.findMany.mockResolvedValue([
      { asin: 'A1', workId: 'work-1' },
      { asin: 'A2', workId: 'work-1' },
    ]);

    const { collapseByExistingWorks } = await import('@/lib/services/works.service');

    const books = [
      makeBook({ asin: 'STANDALONE_1', title: 'Standalone 1' }),
      makeBook({ asin: 'A1', title: 'Same Book' }),
      makeBook({ asin: 'STANDALONE_2', title: 'Standalone 2' }),
      makeBook({ asin: 'A2', title: 'Same Book' }),
    ];

    const result = await collapseByExistingWorks(books);
    expect(result).toHaveLength(3);
    expect(result.map(b => b.asin)).toEqual(['STANDALONE_1', 'A1', 'STANDALONE_2']);
  });

  it('returns input unchanged on DB failure (does not throw)', async () => {
    prismaMock.workAsin.findMany.mockRejectedValue(new Error('DB exploded'));

    const { collapseByExistingWorks } = await import('@/lib/services/works.service');

    const books = [
      makeBook({ asin: 'A1' }),
      makeBook({ asin: 'A2' }),
    ];

    const result = await collapseByExistingWorks(books);
    expect(result).toEqual(books);
  });

  it('only queries the workAsin table once per call', async () => {
    prismaMock.workAsin.findMany.mockResolvedValue([
      { asin: 'A1', workId: 'work-1' },
      { asin: 'A2', workId: 'work-1' },
    ]);

    const { collapseByExistingWorks } = await import('@/lib/services/works.service');

    await collapseByExistingWorks([
      makeBook({ asin: 'A1' }),
      makeBook({ asin: 'A2' }),
      makeBook({ asin: 'A3' }),
    ]);

    expect(prismaMock.workAsin.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.workAsin.findMany).toHaveBeenCalledWith({
      where: { asin: { in: ['A1', 'A2', 'A3'] } },
      select: { asin: true, workId: true, isCanonical: true },
    });
  });
});
