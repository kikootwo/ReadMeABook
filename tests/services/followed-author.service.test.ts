/**
 * Component: Followed Author Service Tests
 * Documentation: documentation/features/followed-authors.md
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
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

describe('Followed Author Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('followAuthor', () => {
    it('upserts a followed author record', async () => {
      const mockResult = {
        id: 'fa-1',
        userId: 'user-1',
        asin: 'B001H6UJO8',
        name: 'Brandon Sanderson',
        image: 'https://example.com/img.jpg',
        createdAt: new Date(),
      };
      prismaMock.followedAuthor.upsert.mockResolvedValue(mockResult);

      const { followAuthor } = await import('@/lib/services/followed-author.service');
      const result = await followAuthor('user-1', {
        asin: 'B001H6UJO8',
        name: 'Brandon Sanderson',
        image: 'https://example.com/img.jpg',
      });

      expect(result).toEqual(mockResult);
      expect(prismaMock.followedAuthor.upsert).toHaveBeenCalledWith({
        where: { userId_asin: { userId: 'user-1', asin: 'B001H6UJO8' } },
        update: { name: 'Brandon Sanderson', image: 'https://example.com/img.jpg' },
        create: {
          userId: 'user-1',
          asin: 'B001H6UJO8',
          name: 'Brandon Sanderson',
          image: 'https://example.com/img.jpg',
        },
      });
    });

    it('stores null image when not provided', async () => {
      prismaMock.followedAuthor.upsert.mockResolvedValue({
        id: 'fa-2',
        userId: 'user-1',
        asin: 'B000APIGH4',
        name: 'Stephen King',
        image: null,
        createdAt: new Date(),
      });

      const { followAuthor } = await import('@/lib/services/followed-author.service');
      await followAuthor('user-1', { asin: 'B000APIGH4', name: 'Stephen King' });

      expect(prismaMock.followedAuthor.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ image: null }),
          update: expect.objectContaining({ image: null }),
        })
      );
    });
  });

  describe('unfollowAuthor', () => {
    it('deletes a followed author and returns true', async () => {
      prismaMock.followedAuthor.delete.mockResolvedValue({});

      const { unfollowAuthor } = await import('@/lib/services/followed-author.service');
      const result = await unfollowAuthor('user-1', 'B001H6UJO8');

      expect(result).toBe(true);
      expect(prismaMock.followedAuthor.delete).toHaveBeenCalledWith({
        where: { userId_asin: { userId: 'user-1', asin: 'B001H6UJO8' } },
      });
    });

    it('returns false when record not found', async () => {
      prismaMock.followedAuthor.delete.mockRejectedValue(
        new Error('Record to delete does not exist')
      );

      const { unfollowAuthor } = await import('@/lib/services/followed-author.service');
      const result = await unfollowAuthor('user-1', 'NONEXISTENT');

      expect(result).toBe(false);
    });
  });

  describe('getFollowedAuthors', () => {
    it('returns all followed authors sorted by createdAt desc', async () => {
      const mockAuthors = [
        { id: 'fa-1', userId: 'user-1', asin: 'A1', name: 'Author A', image: null, createdAt: new Date() },
        { id: 'fa-2', userId: 'user-1', asin: 'A2', name: 'Author B', image: null, createdAt: new Date() },
      ];
      prismaMock.followedAuthor.findMany.mockResolvedValue(mockAuthors);

      const { getFollowedAuthors } = await import('@/lib/services/followed-author.service');
      const result = await getFollowedAuthors('user-1');

      expect(result).toEqual(mockAuthors);
      expect(prismaMock.followedAuthor.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('isFollowingAuthor', () => {
    it('returns true when user follows the author', async () => {
      prismaMock.followedAuthor.count.mockResolvedValue(1);

      const { isFollowingAuthor } = await import('@/lib/services/followed-author.service');
      const result = await isFollowingAuthor('user-1', 'B001H6UJO8');

      expect(result).toBe(true);
    });

    it('returns false when user does not follow the author', async () => {
      prismaMock.followedAuthor.count.mockResolvedValue(0);

      const { isFollowingAuthor } = await import('@/lib/services/followed-author.service');
      const result = await isFollowingAuthor('user-1', 'UNKNOWN');

      expect(result).toBe(false);
    });
  });

  describe('getFollowedAsins', () => {
    it('returns set of followed ASINs from given list', async () => {
      prismaMock.followedAuthor.findMany.mockResolvedValue([
        { asin: 'A1' },
        { asin: 'A3' },
      ]);

      const { getFollowedAsins } = await import('@/lib/services/followed-author.service');
      const result = await getFollowedAsins('user-1', ['A1', 'A2', 'A3']);

      expect(result).toEqual(new Set(['A1', 'A3']));
      expect(prismaMock.followedAuthor.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', asin: { in: ['A1', 'A2', 'A3'] } },
        select: { asin: true },
      });
    });

    it('returns empty set for empty input', async () => {
      const { getFollowedAsins } = await import('@/lib/services/followed-author.service');
      const result = await getFollowedAsins('user-1', []);

      expect(result).toEqual(new Set());
      expect(prismaMock.followedAuthor.findMany).not.toHaveBeenCalled();
    });
  });
});
