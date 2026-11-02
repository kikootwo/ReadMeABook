/**
 * Component: Audiobookshelf Requester Tags Tests
 * Documentation: documentation/features/requester-tags.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

const users = (...names: string[]) => names.map((plexUsername) => ({ plexUsername }));

describe('requester tags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findMany.mockResolvedValue([]);
  });

  describe('formatRequesterTag', () => {
    it('formats requester tags by sanitizing the username', async () => {
      const { formatRequesterTag } = await import('@/lib/services/audiobookshelf/requester-tags');

      expect(formatRequesterTag('John Smith')).toBe('req:john_smith');
      expect(formatRequesterTag('  Jane.Doe!  ')).toBe('req:janedoe');
      expect(formatRequesterTag('user-123_ok')).toBe('req:user-123_ok');
      expect(formatRequesterTag('ALLCAPS')).toBe('req:allcaps');
    });

    it('returns an empty string when the username sanitizes to nothing', async () => {
      const { formatRequesterTag } = await import('@/lib/services/audiobookshelf/requester-tags');

      // All-symbol and non-Latin usernames strip down to nothing — must NOT
      // collapse onto a shared bare `req:` tag.
      expect(formatRequesterTag('!!!')).toBe('');
      expect(formatRequesterTag('   ')).toBe('');
      expect(formatRequesterTag('李雷')).toBe('');
      expect(formatRequesterTag('')).toBe('');
    });
  });

  describe('findRequesterTagCollisions', () => {
    it('reports each tag two or more users would share, with their usernames', async () => {
      prismaMock.user.findMany.mockResolvedValue(users('john.smith', 'johnsmith', 'JohnSmith', 'guggs', 'Jane Doe', 'jane_doe'));
      const { findRequesterTagCollisions } = await import('@/lib/services/audiobookshelf/requester-tags');

      expect(await findRequesterTagCollisions()).toEqual([
        { tag: 'req:johnsmith', usernames: ['john.smith', 'johnsmith', 'JohnSmith'] },
        { tag: 'req:jane_doe', usernames: ['Jane Doe', 'jane_doe'] },
      ]);
    });

    it('ignores deleted users and usernames with no usable tag', async () => {
      prismaMock.user.findMany.mockResolvedValue(users('李雷', '王芳', 'guggs'));
      const { findRequesterTagCollisions } = await import('@/lib/services/audiobookshelf/requester-tags');

      expect(await findRequesterTagCollisions()).toEqual([]);
      expect(prismaMock.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { deletedAt: null } })
      );
    });
  });

  describe('createRequesterTagger', () => {
    it('refuses a shared tag, warns once per run, and still tags everyone else', async () => {
      prismaMock.user.findMany.mockResolvedValue(users('john.smith', 'johnsmith', 'guggs'));
      const { createRequesterTagger } = await import('@/lib/services/audiobookshelf/requester-tags');
      const logger = { warn: vi.fn() };
      const tagFor = createRequesterTagger(logger);

      expect(await tagFor('john.smith')).toBe('');
      expect(await tagFor('johnsmith')).toBe('');
      expect(await tagFor('guggs')).toBe('req:guggs');

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0][0]).toContain('john.smith, johnsmith');
      expect(prismaMock.user.findMany).toHaveBeenCalledTimes(1);
    });

    it('does not load users until the first requester is tagged', async () => {
      const { createRequesterTagger } = await import('@/lib/services/audiobookshelf/requester-tags');

      createRequesterTagger({ warn: vi.fn() });

      expect(prismaMock.user.findMany).not.toHaveBeenCalled();
    });
  });
});
