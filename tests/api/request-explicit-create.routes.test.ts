/**
 * Component: POST /api/requests and the owner detail shape, the Explicit mark (#542)
 * Documentation: documentation/features/explicit-flag.md
 *
 * The create route passes a boolean `explicit` to the request creator (API tokens included: the
 * route is on the allowlist and the field only restricts) while the admin setting is on; while it is
 * off or absent the request is created unmarked. Anything but a boolean is a validation error.
 * The requester's detail view carries the mark.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ body: {} as unknown, setting: 'true' as string | null, mode: 'audiobookshelf' }));
const createRequestForUserMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (_req: unknown, handler: (r: unknown) => unknown) =>
    handler({ user: { id: 'user-1', role: 'user' }, nextUrl: new URL('http://localhost/api/requests'), json: async () => state.body }),
}));
vi.mock('@/lib/services/request-creator.service', () => ({ createRequestForUser: createRequestForUserMock }));
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({
    get: async (key: string) => (key === 'audiobookshelf.explicit_mark_enabled' ? state.setting : null),
    getBackendMode: async () => state.mode,
  }),
}));

const BOOK = { asin: 'B000000001', title: 'Title', author: 'Author' };

async function post(body: unknown) {
  state.body = body;
  const { POST } = await import('@/app/api/requests/route');
  const response = await POST({} as never);
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.setting = 'true';
  state.mode = 'audiobookshelf';
  createRequestForUserMock.mockResolvedValue({ success: true, request: { id: 'req-1', explicit: true } });
});

describe('POST /api/requests: explicit (#542)', () => {
  it.each([
    [true, true],
    [false, false],
    [undefined, false],
  ])('setting on: explicit %s reaches the creator as %s', async (value, expected) => {
    const res = await post({ audiobook: BOOK, ...(value !== undefined ? { explicit: value } : {}) });

    expect(res.status).toBe(201);
    expect(createRequestForUserMock).toHaveBeenCalledWith('user-1', expect.objectContaining({ asin: BOOK.asin }), expect.objectContaining({ explicit: expected }));
  });

  it.each([['off', 'false', 'audiobookshelf'], ['absent (an upgrade)', null, 'audiobookshelf'], ["'true' left over in Plex mode", 'true', 'plex']])('setting %s: explicit true is ignored, the request is created unmarked', async (_label, setting, mode) => {
    state.setting = setting;
    state.mode = mode;

    const res = await post({ audiobook: BOOK, explicit: true });

    expect(res.status).toBe(201);
    expect(createRequestForUserMock).toHaveBeenCalledWith('user-1', expect.objectContaining({ asin: BOOK.asin }), expect.objectContaining({ explicit: false }));
  });

  it.each([['a string', 'true'], ['a number', 1], ['null', null]])('explicit as %s → 400, nothing created', async (_label, value) => {
    const res = await post({ audiobook: BOOK, explicit: value });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
    expect(createRequestForUserMock).not.toHaveBeenCalled();
  });

  it('the response carries the stored mark', async () => {
    const res = await post({ audiobook: BOOK, explicit: true });

    expect(res.body.request.explicit).toBe(true);
  });
});

describe('owner detail shape (#542)', () => {
  it('selects explicit for the requester and API tokens', async () => {
    const { OWNER_REQUEST_DETAIL_SELECT } = await import('@/lib/services/request-detail-query');

    expect(OWNER_REQUEST_DETAIL_SELECT.explicit).toBe(true);
  });
});
