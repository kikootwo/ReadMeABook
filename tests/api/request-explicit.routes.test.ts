/**
 * Component: PUT /api/requests/[id]/explicit (#542)
 * Documentation: documentation/features/explicit-flag.md
 *
 * The requester or an admin sets the mark; only an admin clears it. A mark on a book already in
 * the library (Audiobookshelf mode) writes the flag at once after the key-user check; an admin's
 * repeat mark retries it, a requester's is a plain 200. A failure says ABS wasn't updated in a short
 * line by viewer. No row updated is a 404. Clearing writes nothing to ABS and says what is left to do. Real: the route, explicit-flag. Mocked: prisma, auth,
 * config, writeABSItem, canKeyUserSeeExplicit.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const state = vi.hoisted(() => ({
  auth: { user: { id: 'user-1', sub: 'user-1', username: 'reader', role: 'user' }, json: async (): Promise<unknown> => ({}) },
  mode: 'audiobookshelf' as string,
  canSee: true,
  writeResult: { tags: 'none', addedTags: [], explicit: 'set' } as Record<string, unknown>,
}));
const writeMock = vi.hoisted(() => vi.fn());
const canSeeMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (_req: unknown, handler: (r: unknown) => unknown) => handler(state.auth),
}));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => ({ getBackendMode: async () => state.mode }) }));
vi.mock('@/lib/services/audiobookshelf/api', () => ({ writeABSItem: writeMock, canKeyUserSeeExplicit: canSeeMock }));

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'req-1', userId: 'user-1', type: 'audiobook', status: 'available', explicit: false, audiobookId: 'ab-1',
    audiobook: { title: 'Book', absItemId: 'li-1' },
    ...over,
  };
}

function as(role: 'user' | 'admin' | 'other') {
  const id = role === 'admin' ? 'admin-1' : role === 'other' ? 'user-2' : 'user-1';
  state.auth = { ...state.auth, user: { id, sub: id, username: id, role: role === 'admin' ? 'admin' : 'user' } };
}

async function put(body: unknown) {
  state.auth.json = async () => body;
  const { PUT } = await import('@/app/api/requests/[id]/explicit/route');
  const response = await PUT({} as never, { params: Promise.resolve({ id: 'req-1' }) });
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  as('user');
  state.mode = 'audiobookshelf';
  canSeeMock.mockResolvedValue(true);
  writeMock.mockResolvedValue({ tags: 'none', addedTags: [], explicit: 'set' });
  prismaMock.request.findFirst.mockResolvedValue(row());
  prismaMock.request.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.request.count.mockResolvedValue(0);
});

describe('PUT /api/requests/[id]/explicit', () => {
  it('the requester marks an available book: saved, then the flag alone is written at once', async () => {
    const res = await put({ explicit: true });

    expect(res).toEqual({ status: 200, body: { success: true, request: { id: 'req-1', explicit: true }, absUpdated: true } });
    expect(prismaMock.request.updateMany).toHaveBeenCalledWith({ where: { id: 'req-1', deletedAt: null }, data: { explicit: true } });
    expect(canSeeMock).toHaveBeenCalledTimes(1);
    expect(writeMock).toHaveBeenCalledWith('li-1', { explicit: true });
    expect(prismaMock.request.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'req-1', deletedAt: null } }));
  });

  it('not yet available: saved, no ABS call', async () => {
    prismaMock.request.findFirst.mockResolvedValue(row({ status: 'downloading', audiobook: { title: 'Book', absItemId: null } }));

    const res = await put({ explicit: true });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('absUpdated');
    expect(prismaMock.request.updateMany).toHaveBeenCalled();
    expect(writeMock).not.toHaveBeenCalled();
    expect(canSeeMock).not.toHaveBeenCalled();
  });

  it("a requester's repeat mark on an already marked request: a plain 200, no Audiobookshelf call (the scan repair retries)", async () => {
    prismaMock.request.findFirst.mockResolvedValue(row({ explicit: true }));

    const res = await put({ explicit: true });

    expect(res).toEqual({ status: 200, body: { success: true, request: { id: 'req-1', explicit: true } } });
    expect(prismaMock.request.updateMany).not.toHaveBeenCalled();
    expect(canSeeMock).not.toHaveBeenCalled();
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("an admin's repeat mark on an available book retries the write without a DB write", async () => {
    as('admin');
    prismaMock.request.findFirst.mockResolvedValue(row({ explicit: true }));

    const res = await put({ explicit: true });

    expect(res.body).toMatchObject({ absUpdated: true });
    expect(prismaMock.request.updateMany).not.toHaveBeenCalled();
    expect(writeMock).toHaveBeenCalledWith('li-1', { explicit: true });
  });

  const guardFails = () => canSeeMock.mockResolvedValue(false);
  const write403 = () => writeMock.mockResolvedValue({ tags: 'none', addedTags: [], explicit: 'failed', error: 'ABS API error: 403 Forbidden', httpStatus: 403 });
  const writeTimeout = () => writeMock.mockResolvedValue({ tags: 'none', addedTags: [], explicit: 'failed', error: 'aborted due to timeout' });
  const REQUESTER_MSG = "Saved. Audiobookshelf wasn't updated; an admin needs to check it.";
  const GUARD_MSG = "Saved. Audiobookshelf wasn't updated: its API user can't see explicit content.";
  const PERMISSION_MSG = "Saved. Audiobookshelf wasn't updated: its API user can't edit items.";
  const WRITE_MSG = "Saved. Audiobookshelf wasn't updated; a full library scan retries it, or remove and re-add the mark.";

  it.each([
    ['requester', "the key user can't see explicit books", guardFails, REQUESTER_MSG],
    ['requester', 'a 403 on the write', write403, REQUESTER_MSG],
    ['requester', 'a timeout', writeTimeout, REQUESTER_MSG],
    ['admin', "the key user can't see explicit books", guardFails, GUARD_MSG],
    ['admin', 'a 403 on the write', write403, PERMISSION_MSG],
    ['admin', 'a timeout', writeTimeout, WRITE_MSG],
  ] as const)('%s, %s: saved; a short message by viewer, no raw error text', async (viewer, _label, arrange, message) => {
    if (viewer === 'admin') as('admin');
    arrange();

    const res = await put({ explicit: true });

    expect(res.status).toBe(200);
    expect(res.body.absUpdated).toBe(false);
    expect(res.body.message).toBe(message);
    expect(res.body.message).not.toMatch(/403|timeout|Forbidden|API key/i);
    if (arrange === guardFails) expect(writeMock).not.toHaveBeenCalled();
  });

  it('no row updated (replaced or deleted since the read): 404, nothing written to Audiobookshelf', async () => {
    prismaMock.request.updateMany.mockResolvedValue({ count: 0 });

    const res = await put({ explicit: true });

    expect(res).toEqual({ status: 404, body: { error: 'NotFound', message: 'Request not found' } });
    expect(writeMock).not.toHaveBeenCalled();
  });

  it('the requester cannot clear: 403, nothing written', async () => {
    prismaMock.request.findFirst.mockResolvedValue(row({ explicit: true }));

    const res = await put({ explicit: false });

    expect(res).toEqual({ status: 403, body: { error: 'Forbidden', message: 'Only an admin can remove the explicit mark' } });
    expect(prismaMock.request.updateMany).not.toHaveBeenCalled();
  });

  it('an admin clears an available book: stored false, no ABS call, says it is still flagged there', async () => {
    as('admin');
    prismaMock.request.findFirst.mockResolvedValue(row({ explicit: true }));

    const res = await put({ explicit: false });

    expect(res.status).toBe(200);
    expect(prismaMock.request.updateMany).toHaveBeenCalledWith({ where: { id: 'req-1', deletedAt: null }, data: { explicit: false } });
    expect(writeMock).not.toHaveBeenCalled();
    expect(canSeeMock).not.toHaveBeenCalled();
    expect(res.body.message).toBe('Mark removed. If the book is marked explicit in Audiobookshelf, change it there.');
  });

  it.each([
    [1, '1 other request for this book is still marked; remove that mark too, or ReadMeABook marks the book explicit again once delivered.'],
    [2, '2 other requests for this book are still marked; remove those marks too, or ReadMeABook marks the book explicit again once delivered.'],
  ])('an admin clear counts %i other marked request(s) that can still flag the book', async (others, line) => {
    as('admin');
    prismaMock.request.findFirst.mockResolvedValue(row({ explicit: true, status: 'failed' }));
    prismaMock.request.count.mockResolvedValue(others);

    const res = await put({ explicit: false });

    expect(res.body.message).toBe(line);
    expect(prismaMock.request.count).toHaveBeenCalledWith({
      where: {
        audiobookId: 'ab-1', id: { not: 'req-1' }, type: 'audiobook', deletedAt: null, explicit: true,
        status: { notIn: ['cancelled', 'denied'] },
      },
    });
  });

  it("an admin marks another user's request", async () => {
    as('admin');

    expect((await put({ explicit: true })).status).toBe(200);
    expect(writeMock).toHaveBeenCalled();
  });

  it("another user: 403", async () => {
    as('other');

    expect((await put({ explicit: true })).status).toBe(403);
    expect(prismaMock.request.updateMany).not.toHaveBeenCalled();
  });

  it('an ebook request: 400', async () => {
    prismaMock.request.findFirst.mockResolvedValue(row({ type: 'ebook' }));

    expect((await put({ explicit: true })).status).toBe(400);
  });

  it('deleted or missing: 404', async () => {
    prismaMock.request.findFirst.mockResolvedValue(null);

    expect((await put({ explicit: true })).status).toBe(404);
  });

  it.each([
    ['a missing field', {}],
    ['a non-boolean', { explicit: 'yes' }],
    ['an extra key (strict)', { explicit: true, userId: 'x' }],
    ['no body', null],
  ])('%s: 400', async (_label, body) => {
    const res = await put(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
    expect(prismaMock.request.findFirst).not.toHaveBeenCalled();
  });

  it('Plex mode: stored, no ABS call, no message', async () => {
    state.mode = 'plex';

    const res = await put({ explicit: true });

    expect(res.body).toEqual({ success: true, request: { id: 'req-1', explicit: true } });
    expect(writeMock).not.toHaveBeenCalled();
    expect(canSeeMock).not.toHaveBeenCalled();
  });
});
