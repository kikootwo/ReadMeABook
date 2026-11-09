/**
 * Component: Requester tags, tag format and who can be tagged (#232)
 * Documentation: documentation/features/requester-tags.md
 *
 * requesterTag() format rules; the tag set (non-deleted, registration approved or NULL); shared
 * tags refused; pending/rejected lookalikes, names without a tag and deleted-user overlaps warn;
 * the settings warnings never fail. Real: requester-tag-users. Mocked: prisma.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import type { RMABLogger } from '@/lib/utils/logger';
import type { TagUser } from '@/lib/services/audiobookshelf/requester-tag-users';

const prismaMock = createPrismaMock();
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

const { buildRequesterTagMap, loadRequesterTagWarnings, logRunWarning, requesterTag } =
  await import('@/lib/services/audiobookshelf/requester-tag-users');

const u = (id: string, plexUsername: string, over: Partial<TagUser> = {}): TagUser =>
  ({ id, plexUsername, deletedAt: null, registrationStatus: 'approved', ...over });
const logger = () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) as unknown as RMABLogger & { warn: ReturnType<typeof vi.fn> };

describe('requesterTag format (#232)', () => {
  it.each([
    ['alice', 'req:alice'],
    ['John Smith', 'req:john_smith'],
    ['  John   Smith  ', 'req:john_smith'],
    ['José', 'req:jose'],
    ['Zoë-Ann', 'req:zoe-ann'],
    ['john.smith@example.com', 'req:johnsmithexamplecom'],
    ['johnsmith', 'req:johnsmith'],
    ['user_42', 'req:user_42'],
    ['ＡＢＣ', 'req:abc'],
    ['1234', 'req:1234'],
  ])('%s → %s', (name, tag) => {
    expect(requesterTag(name)).toBe(tag);
  });

  it.each([['李雷'], ['Дочь 1'], ['   '], [''], ['!!!']])('%j gives no tag (never a bare req:)', (name) => {
    expect(requesterTag(name)).toBe('');
  });

  it('null/undefined give no tag', () => {
    expect(requesterTag(null)).toBe('');
    expect(requesterTag(undefined)).toBe('');
  });
});

describe('buildRequesterTagMap (#232)', () => {
  it('tags each approved or NULL-status user with a tag of their own', () => {
    const map = buildRequesterTagMap([u('1', 'alice'), u('2', 'bob', { registrationStatus: null })]);

    expect(map.tagByUser).toEqual(new Map([['1', 'req:alice'], ['2', 'req:bob']]));
    expect(map.warnings).toEqual({ shared: [], lookalikes: [], untaggable: [], deletedOverlaps: [] });
  });

  it('refuses every user of a shared tag', () => {
    const map = buildRequesterTagMap([u('1', 'john.smith'), u('2', 'JohnSmith'), u('3', 'alice')]);

    expect(map.tagByUser.has('1')).toBe(false);
    expect(map.tagByUser.has('2')).toBe(false);
    expect(map.tagByUser.get('3')).toBe('req:alice');
    expect(map.refusedUsers.get('1')).toBe('shared');
    expect(map.warnings.shared).toEqual([{ tag: 'req:johnsmith', usernames: ['john.smith', 'JohnSmith'] }]);
  });

  it.each(['pending_approval', 'rejected'])('a %s lookalike warns; the approved user is still tagged', (status) => {
    const map = buildRequesterTagMap([u('1', 'bob'), u('2', 'bob.', { registrationStatus: status })]);

    expect(map.tagByUser.get('1')).toBe('req:bob');
    expect(map.warnings.shared).toEqual([]);
    expect(map.warnings.lookalikes).toEqual([{ tag: 'req:bob', username: 'bob.', status, matches: ['bob'] }]);
    expect(map.excludedUsers.has('2')).toBe(true);
  });

  it('once the lookalike is approved, both are refused', () => {
    const map = buildRequesterTagMap([u('1', 'bob'), u('2', 'bob.')]);

    expect(map.tagByUser.size).toBe(0);
    expect(map.warnings.shared).toEqual([{ tag: 'req:bob', usernames: ['bob', 'bob.'] }]);
  });

  it('lists a taggable name with no usable characters as untaggable', () => {
    const map = buildRequesterTagMap([u('1', '李雷'), u('2', 'Дочь 1')]);

    expect(map.tagByUser.size).toBe(0);
    expect(map.refusedUsers.get('1')).toBe('no_tag');
    expect(map.warnings.untaggable).toEqual(['李雷', 'Дочь 1']);
  });

  it('a live user sharing a deleted user\'s tag is tagged and warned', () => {
    const map = buildRequesterTagMap([u('1', 'carol'), u('2', 'Carol', { deletedAt: new Date() })]);

    expect(map.tagByUser.get('1')).toBe('req:carol');
    expect(map.excludedUsers.has('2')).toBe(true);
    expect(map.warnings.deletedOverlaps).toEqual([{ tag: 'req:carol', username: 'carol', deletedUsernames: ['Carol'] }]);
  });

  it('deleted, pending and rejected users are excluded from tagging', () => {
    const map = buildRequesterTagMap([
      u('1', 'dee', { deletedAt: new Date() }),
      u('2', 'pat', { registrationStatus: 'pending_approval' }),
      u('3', 'rex', { registrationStatus: 'rejected' }),
    ]);

    expect([...map.excludedUsers].sort()).toEqual(['1', '2', '3']);
    expect(map.tagByUser.size).toBe(0);
    expect(map.warnings.untaggable).toEqual([]);
  });
});

describe('logRunWarning (#232)', () => {
  it('logs a shared tag once per run however many requests hit it', () => {
    const map = buildRequesterTagMap([u('1', 'john.smith'), u('2', 'johnsmith')]);
    const log = logger();
    const seen = new Set<string>();

    logRunWarning(map, map.usersById.get('1'), seen, log);
    logRunWarning(map, map.usersById.get('1'), seen, log);
    logRunWarning(map, map.usersById.get('2'), seen, log);

    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith('Not tagging with req:johnsmith: shared by john.smith, johnsmith');
  });

  it('logs an untaggable name once per user, a lookalike and a deleted overlap once per tag', () => {
    const map = buildRequesterTagMap([
      u('1', '李雷'), u('2', 'bob'), u('3', 'bob.', { registrationStatus: 'pending_approval' }),
      u('4', 'carol'), u('5', 'carol', { deletedAt: new Date() }),
    ]);
    const log = logger();
    const seen = new Set<string>();

    for (const id of ['1', '1', '2', '2', '4', '4']) logRunWarning(map, map.usersById.get(id), seen, log);

    expect(log.warn.mock.calls.map((c) => c[0])).toEqual([
      'Not tagging requests of "李雷": the username has no letters or digits a tag can use',
      'req:bob is also the tag of pending user "bob.": if they are approved, neither is tagged',
      'req:carol is also the tag of deleted user "carol"; books tagged for them still carry it',
    ]);
  });
});

describe('loadRequesterTagWarnings (#232)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads every user once and returns the warnings', async () => {
    prismaMock.user.findMany.mockResolvedValue([u('1', 'john.smith'), u('2', 'johnsmith'), u('3', '李雷')]);

    const warnings = await loadRequesterTagWarnings();

    expect(prismaMock.user.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.user.findMany.mock.calls[0][0]).toEqual({ select: { id: true, plexUsername: true, deletedAt: true, registrationStatus: true } });
    expect(warnings.shared).toEqual([{ tag: 'req:johnsmith', usernames: ['john.smith', 'johnsmith'] }]);
    expect(warnings.untaggable).toEqual(['李雷']);
  });

  it('a users-query error gives empty lists', async () => {
    prismaMock.user.findMany.mockRejectedValue(new Error('db down'));

    expect(await loadRequesterTagWarnings()).toEqual({ shared: [], lookalikes: [], untaggable: [], deletedOverlaps: [] });
  });
});
