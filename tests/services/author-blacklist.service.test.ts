/**
 * Component: Author Blacklist Service Tests
 * Documentation: documentation/admin-features/author-blacklist.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

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

function fakeEntry(overrides: Partial<{
  id: string;
  authorName: string;
  authorKey: string;
}> = {}) {
  return {
    id: overrides.id ?? 'ba-1',
    authorName: overrides.authorName ?? 'Stephen King',
    authorKey: overrides.authorKey ?? 'stephen king',
    createdById: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
}

describe('normalizeAuthorKey / parseAuthorNames', () => {
  it('normalizes trim + lowercase', async () => {
    const { normalizeAuthorKey } = await import(
      '@/lib/services/author-blacklist.service'
    );
    expect(normalizeAuthorKey('  Stephen King  ')).toBe('stephen king');
  });

  it('splits comma-separated authors and drops empties', async () => {
    const { parseAuthorNames } = await import(
      '@/lib/services/author-blacklist.service'
    );
    expect(parseAuthorNames('Stephen King,  J.K. Rowling ,')).toEqual([
      'stephen king',
      'j.k. rowling',
    ]);
  });

  it('returns empty for blank input', async () => {
    const { parseAuthorNames } = await import(
      '@/lib/services/author-blacklist.service'
    );
    expect(parseAuthorNames('')).toEqual([]);
    expect(parseAuthorNames('  ,  ')).toEqual([]);
  });
});

describe('isAuthorBlocked', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.blockedAuthor.findFirst.mockResolvedValue(null);
  });

  it('returns false when no names', async () => {
    const { isAuthorBlocked } = await import(
      '@/lib/services/author-blacklist.service'
    );
    expect(await isAuthorBlocked('')).toBe(false);
    expect(prismaMock.blockedAuthor.findFirst).not.toHaveBeenCalled();
  });

  it('matches a comma-separated segment exactly', async () => {
    prismaMock.blockedAuthor.findFirst.mockResolvedValueOnce({ id: 'ba-1' });
    const { isAuthorBlocked } = await import(
      '@/lib/services/author-blacklist.service'
    );
    expect(await isAuthorBlocked('Neil Gaiman, Stephen King')).toBe(true);
    expect(prismaMock.blockedAuthor.findFirst).toHaveBeenCalledWith({
      where: { authorKey: { in: ['neil gaiman', 'stephen king'] } },
      select: { id: true },
    });
  });

  it('does not substring-match (Stephen vs Stephen King)', async () => {
    prismaMock.blockedAuthor.findFirst.mockResolvedValueOnce(null);
    const { isAuthorBlocked } = await import(
      '@/lib/services/author-blacklist.service'
    );
    expect(await isAuthorBlocked('Stephen King')).toBe(false);
    expect(prismaMock.blockedAuthor.findFirst).toHaveBeenCalledWith({
      where: { authorKey: { in: ['stephen king'] } },
      select: { id: true },
    });
  });
});

describe('addBlockedAuthor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.blockedAuthor.findUnique.mockResolvedValue(null);
  });

  it('creates a new entry with normalized key', async () => {
    const created = fakeEntry();
    prismaMock.blockedAuthor.create.mockResolvedValueOnce(created);

    const { addBlockedAuthor } = await import(
      '@/lib/services/author-blacklist.service'
    );
    const result = await addBlockedAuthor({
      authorName: '  Stephen King  ',
      createdById: 'admin-1',
    });

    expect(result.wasNew).toBe(true);
    expect(prismaMock.blockedAuthor.create).toHaveBeenCalledWith({
      data: {
        authorName: 'Stephen King',
        authorKey: 'stephen king',
        createdById: 'admin-1',
      },
    });
  });

  it('returns existing entry without creating on duplicate key', async () => {
    const existing = fakeEntry();
    prismaMock.blockedAuthor.findUnique.mockResolvedValueOnce(existing);

    const { addBlockedAuthor } = await import(
      '@/lib/services/author-blacklist.service'
    );
    const result = await addBlockedAuthor({ authorName: 'stephen king' });

    expect(result.wasNew).toBe(false);
    expect(result.entry).toEqual(existing);
    expect(prismaMock.blockedAuthor.create).not.toHaveBeenCalled();
  });

  it('throws on empty name', async () => {
    const { addBlockedAuthor } = await import(
      '@/lib/services/author-blacklist.service'
    );
    await expect(addBlockedAuthor({ authorName: '   ' })).rejects.toThrow(
      'Author name is required'
    );
  });
});

describe('removeBlockedAuthor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when delete succeeds', async () => {
    prismaMock.blockedAuthor.delete.mockResolvedValueOnce(fakeEntry());
    const { removeBlockedAuthor } = await import(
      '@/lib/services/author-blacklist.service'
    );
    expect(await removeBlockedAuthor('ba-1')).toBe(true);
  });

  it('returns false when delete fails', async () => {
    prismaMock.blockedAuthor.delete.mockRejectedValueOnce(new Error('not found'));
    const { removeBlockedAuthor } = await import(
      '@/lib/services/author-blacklist.service'
    );
    expect(await removeBlockedAuthor('missing')).toBe(false);
  });
});
