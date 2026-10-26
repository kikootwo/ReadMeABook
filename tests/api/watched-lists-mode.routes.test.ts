/**
 * Component: Watched Lists Mode Route Tests (Entire catalog / New releases only)
 * Documentation: documentation/features/watched-lists.md
 */

import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();

// Plain holders: the config's mockReset clears vi.fn implementations per test
const state = vi.hoisted(() => ({ body: undefined as unknown, jobs: [] as unknown[][] }));
const request = vi.hoisted(() => ({
  user: { id: 'user-1', sub: 'user-1', username: 'someone', role: 'user' },
  json: async () => state.body,
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (_req: unknown, handler: (req: unknown) => unknown) => handler(request),
}));
vi.mock('@/lib/services/job-queue.service', () => ({
  getJobQueueService: () => ({ addCheckWatchedItemJob: async (...args: unknown[]) => { state.jobs.push(args); return 'job-1'; } }),
}));

const routeRequest = request as unknown as NextRequest;
const EARLIER = new Date('2026-01-15T12:00:00Z');

type Handler = (req: NextRequest, ctx?: { params: Promise<{ id: string }> }) => Promise<Response>;

const kinds = [
  {
    name: 'watched-authors',
    key: 'author',
    model: () => prismaMock.watchedAuthor,
    list: () => import('@/app/api/user/watched-authors/route'),
    item: () => import('@/app/api/user/watched-authors/[id]/route'),
    base: { authorAsin: 'B000APZOQA', authorName: 'Author' },
    row: { authorAsin: 'B000APZOQA', authorName: 'Author' },
    listKey: 'authors',
  },
  {
    name: 'watched-series',
    key: 'series',
    model: () => prismaMock.watchedSeries,
    list: () => import('@/app/api/user/watched-series/route'),
    item: () => import('@/app/api/user/watched-series/[id]/route'),
    base: { seriesAsin: 'B0BXN9QJ9T', seriesTitle: 'Series' },
    row: { seriesAsin: 'B0BXN9QJ9T', seriesTitle: 'Series' },
    listKey: 'series',
  },
] as const;

async function call(handler: Handler, body?: unknown, id?: string) {
  state.body = body;
  const response = await handler(routeRequest, id ? { params: Promise.resolve({ id }) } : undefined);
  return { status: response.status, payload: await response.json() };
}

describe.each(kinds)('/api/user/$name mode', (kind) => {
  const watch = (overrides: Record<string, unknown> = {}) => ({
    id: 'w-1', userId: 'user-1', coverArtUrl: null, lastCheckedAt: null, newReleasesSince: null,
    createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date(), ...kind.row, ...overrides,
  });

  beforeEach(() => {
    state.body = undefined;
    state.jobs = [];
    kind.model().findUnique.mockResolvedValue(null);
    kind.model().create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => watch(data));
    kind.model().update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => watch(data));
  });

  it('POST newReleasesOnly:true stores a cutoff of now and still queues the immediate check', async () => {
    const before = Date.now();
    const { POST } = await kind.list();
    const { status, payload } = await call(POST, { ...kind.base, newReleasesOnly: true });

    expect(status).toBe(201);
    const since = kind.model().create.mock.calls[0][0].data.newReleasesSince as Date;
    expect(since).toBeInstanceOf(Date);
    expect(since.getTime()).toBeGreaterThanOrEqual(before);
    expect(since.getTime()).toBeLessThanOrEqual(Date.now());
    expect(payload[kind.key]).toMatchObject({ newReleasesOnly: true });
    expect(state.jobs).toHaveLength(1);
  });

  it('POST without the flag stores the entire catalog (null cutoff)', async () => {
    const { POST } = await kind.list();
    const { status, payload } = await call(POST, kind.base);

    expect(status).toBe(201);
    expect(kind.model().create.mock.calls[0][0].data.newReleasesSince).toBeNull();
    expect(payload[kind.key]).toMatchObject({ newReleasesOnly: false, newReleasesSince: null });
  });

  it('POST rejects a non-boolean flag', async () => {
    const { POST } = await kind.list();
    const { status, payload } = await call(POST, { ...kind.base, newReleasesOnly: 'yes' });

    expect(status).toBe(400);
    expect(payload.details[0]).toMatchObject({ code: 'invalid_type', path: ['newReleasesOnly'] });
    expect(kind.model().create).not.toHaveBeenCalled();
  });

  it('GET lists each watch with its mode', async () => {
    kind.model().findMany.mockResolvedValue([watch({ id: 'a' }), watch({ id: 'b', newReleasesSince: EARLIER })]);
    const { GET } = await kind.list();
    const { payload } = await call(GET);

    expect(payload[kind.listKey].map((w: { id: string; newReleasesOnly: boolean }) => [w.id, w.newReleasesOnly])).toEqual([['a', false], ['b', true]]);
    expect(payload[kind.listKey][1].newReleasesSince).toBe(EARLIER.toISOString());
  });

  it('PATCH to new-only starts a cutoff now, and queues no job', async () => {
    kind.model().findUnique.mockResolvedValue(watch());
    const { PATCH } = await kind.item();
    const { status, payload } = await call(PATCH, { newReleasesOnly: true }, 'w-1');

    expect(status).toBe(200);
    expect(kind.model().update.mock.calls[0][0]).toMatchObject({ where: { id: 'w-1' }, data: { newReleasesSince: expect.any(Date) } });
    expect(payload[kind.key]).toMatchObject({ id: 'w-1', newReleasesOnly: true });
    expect(state.jobs).toHaveLength(0);
  });

  it('PATCH to new-only on a new-only watch keeps its cutoff', async () => {
    kind.model().findUnique.mockResolvedValue(watch({ newReleasesSince: EARLIER }));
    const { PATCH } = await kind.item();
    await call(PATCH, { newReleasesOnly: true }, 'w-1');

    expect(kind.model().update.mock.calls[0][0].data.newReleasesSince).toEqual(EARLIER);
  });

  it('PATCH to the entire catalog clears the cutoff, and queues no job', async () => {
    kind.model().findUnique.mockResolvedValue(watch({ newReleasesSince: EARLIER }));
    const { PATCH } = await kind.item();
    const { status, payload } = await call(PATCH, { newReleasesOnly: false }, 'w-1');

    expect(status).toBe(200);
    expect(kind.model().update.mock.calls[0][0].data.newReleasesSince).toBeNull();
    expect(payload[kind.key]).toMatchObject({ newReleasesOnly: false, newReleasesSince: null });
    expect(state.jobs).toHaveLength(0);
  });

  it.each([
    ['a missing flag', {}],
    ['an extra key', { newReleasesOnly: true, newReleasesSince: '2020-01-01T00:00:00Z' }],
    ['a non-boolean flag', { newReleasesOnly: 1 }],
  ])('PATCH rejects %s', async (_label, body) => {
    kind.model().findUnique.mockResolvedValue(watch());
    const { PATCH } = await kind.item();
    const { status, payload } = await call(PATCH, body, 'w-1');

    expect(status).toBe(400);
    expect(payload.error).toBe('ValidationError');
    expect(kind.model().update).not.toHaveBeenCalled();
  });

  it('PATCH returns 404 for an unknown watch', async () => {
    const { PATCH } = await kind.item();
    const { status } = await call(PATCH, { newReleasesOnly: true }, 'missing');

    expect(status).toBe(404);
    expect(kind.model().update).not.toHaveBeenCalled();
  });

  it("PATCH returns 403 for another user's watch and changes nothing", async () => {
    kind.model().findUnique.mockResolvedValue(watch({ userId: 'user-2' }));
    const { PATCH } = await kind.item();
    const { status } = await call(PATCH, { newReleasesOnly: false }, 'w-1');

    expect(status).toBe(403);
    expect(kind.model().update).not.toHaveBeenCalled();
  });
});
