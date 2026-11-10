/**
 * Component: Admin settings routes, requester tags (#232)
 * Documentation: documentation/features/requester-tags.md
 *
 * GET returns `audiobookshelf.tagRequester` and the warnings (computed whatever the saved value;
 * a users-query error still returns the settings). The ABS PUT writes the key only for a boolean
 * and queues the backfill once, on a saved off → on change; a failed enqueue still saves.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const configServiceMock = vi.hoisted(() => ({ get: vi.fn(), setMany: vi.fn(), clearCache: vi.fn() }));
const jobQueueMock = vi.hoisted(() => ({ addBackfillRequesterTagsJob: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (_req: unknown, handler: (r: unknown) => unknown) => handler({ user: { id: 'admin-1', role: 'admin' } }),
  requireAdmin: (_req: unknown, handler: () => unknown) => handler(),
}));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configServiceMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/services/encryption.service', () => ({
  getEncryptionService: () => ({ encrypt: (v: string) => `enc-${v}`, decrypt: (v: string) => v.replace('enc-', ''), isEncryptedFormat: () => false }),
}));

const user = (id: string, plexUsername: string, over: Record<string, unknown> = {}) =>
  ({ id, plexUsername, deletedAt: null, registrationStatus: 'approved', ...over });

async function getSettings() {
  const { GET } = await import('@/app/api/admin/settings/route');
  return (await GET({} as never)).json();
}

async function putAbs(body: Record<string, unknown>) {
  const { PUT } = await import('@/app/api/admin/settings/audiobookshelf/route');
  const request = { json: vi.fn().mockResolvedValue({ serverUrl: 'http://abs', apiToken: 'token', libraryId: 'lib', triggerScanAfterImport: false, ...body }) };
  const response = await PUT(request as never);
  return { status: response.status, body: await response.json() };
}

const savedTagKey = () => configServiceMock.setMany.mock.calls[0][0].find((u: { key: string }) => u.key === 'audiobookshelf.tag_requester');

describe('settings GET: requester tags (#232)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.count.mockResolvedValue(0);
  });

  it('returns tagRequester and every kind of warning, with tagging off', async () => {
    prismaMock.configuration.findMany.mockResolvedValue([{ key: 'system.backend_mode', value: 'audiobookshelf' }]);
    prismaMock.user.findMany.mockResolvedValue([
      user('1', 'john.smith'), user('2', 'johnsmith'),
      user('3', 'bob'), user('4', 'bob.', { registrationStatus: 'pending_approval' }),
      user('5', '李雷'),
      user('6', 'carol'), user('7', 'carol', { deletedAt: new Date() }),
    ]);

    const payload = await getSettings();

    expect(payload.audiobookshelf.tagRequester).toBe(false);
    expect(payload.audiobookshelf.requesterTagWarnings).toEqual({
      shared: [{ tag: 'req:johnsmith', usernames: ['john.smith', 'johnsmith'] }],
      lookalikes: [{ tag: 'req:bob', username: 'bob.', status: 'pending_approval', matches: ['bob'] }],
      untaggable: ['李雷'],
      deletedOverlaps: [{ tag: 'req:carol', username: 'carol', deletedUsernames: ['carol'] }],
    });
  });

  it('reads tagRequester from audiobookshelf.tag_requester', async () => {
    prismaMock.configuration.findMany.mockResolvedValue([{ key: 'audiobookshelf.tag_requester', value: 'true' }]);
    prismaMock.user.findMany.mockResolvedValue([]);

    expect((await getSettings()).audiobookshelf.tagRequester).toBe(true);
  });

  it('a users-query error still returns the settings, with empty warnings', async () => {
    prismaMock.configuration.findMany.mockResolvedValue([{ key: 'audiobookshelf.server_url', value: 'http://abs' }]);
    prismaMock.user.findMany.mockRejectedValue(new Error('db down'));

    const payload = await getSettings();

    expect(payload.audiobookshelf.serverUrl).toBe('http://abs');
    expect(payload.audiobookshelf.requesterTagWarnings).toEqual({ shared: [], lookalikes: [], untaggable: [], deletedOverlaps: [] });
  });
});

describe('ABS settings PUT: requester tags (#232)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configServiceMock.setMany.mockResolvedValue(undefined);
    jobQueueMock.addBackfillRequesterTagsJob.mockResolvedValue('job-1');
  });

  it('off → on saves the key and queues the backfill once, after the save', async () => {
    configServiceMock.get.mockImplementation(async (key: string) => (key === 'audiobookshelf.tag_requester' ? 'false' : null));

    const res = await putAbs({ tagRequester: true });

    expect(res.status).toBe(200);
    expect(savedTagKey()).toEqual({ key: 'audiobookshelf.tag_requester', value: 'true' });
    expect(jobQueueMock.addBackfillRequesterTagsJob).toHaveBeenCalledTimes(1);
    expect(configServiceMock.setMany.mock.invocationCallOrder[0]).toBeLessThan(jobQueueMock.addBackfillRequesterTagsJob.mock.invocationCallOrder[0]);
  });

  it('absent key counts as off: on queues the backfill', async () => {
    configServiceMock.get.mockResolvedValue(null);

    await putAbs({ tagRequester: true });

    expect(jobQueueMock.addBackfillRequesterTagsJob).toHaveBeenCalledTimes(1);
  });

  it('on → on saves without queuing', async () => {
    configServiceMock.get.mockImplementation(async (key: string) => (key === 'audiobookshelf.tag_requester' ? 'true' : null));

    await putAbs({ tagRequester: true });

    expect(savedTagKey()).toEqual({ key: 'audiobookshelf.tag_requester', value: 'true' });
    expect(jobQueueMock.addBackfillRequesterTagsJob).not.toHaveBeenCalled();
  });

  it('on → off saves false without queuing', async () => {
    configServiceMock.get.mockImplementation(async (key: string) => (key === 'audiobookshelf.tag_requester' ? 'true' : null));

    await putAbs({ tagRequester: false });

    expect(savedTagKey()).toEqual({ key: 'audiobookshelf.tag_requester', value: 'false' });
    expect(jobQueueMock.addBackfillRequesterTagsJob).not.toHaveBeenCalled();
  });

  it.each([[undefined], ['true'], [1]])('tagRequester %j leaves the key alone', async (value) => {
    configServiceMock.get.mockResolvedValue(null);

    await putAbs(value === undefined ? {} : { tagRequester: value });

    expect(savedTagKey()).toBeUndefined();
    expect(jobQueueMock.addBackfillRequesterTagsJob).not.toHaveBeenCalled();
  });

  it('a failed enqueue is logged and the save still succeeds', async () => {
    configServiceMock.get.mockResolvedValue(null);
    jobQueueMock.addBackfillRequesterTagsJob.mockRejectedValue(new Error('redis down'));

    const res = await putAbs({ tagRequester: true });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(savedTagKey()).toEqual({ key: 'audiobookshelf.tag_requester', value: 'true' });
  });
});
