/**
 * Component: Request Schema Behaviour Route Tests (zod 4)
 * Documentation: documentation/backend/validation.md
 *
 * Route-level checks of the request schemas whose accepted values depend on zod's string,
 * record and default handling: token expiry datetimes, target user ids, string lengths,
 * cover URLs, notification config records and defaulted booleans.
 */

import { randomUUID } from 'crypto';
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const notificationCreate = vi.fn();
Object.assign(prismaMock, { notificationBackend: { create: notificationCreate } });

// Plain functions and holders: the config's mockReset clears vi.fn implementations per test
const state = vi.hoisted(() => ({ body: undefined as unknown }));
const request = vi.hoisted(() => ({
  user: { id: 'user-1', sub: 'user-1', username: 'admin', role: 'admin' },
  json: async () => state.body,
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (_req: unknown, handler: (req: unknown) => unknown) => handler(request),
  requireAdmin: (_req: unknown, handler: () => unknown) => handler(),
}));
vi.mock('@/lib/utils/rateLimit', () => ({ checkApiTokenCreateRateLimit: () => ({ allowed: true }) }));
vi.mock('@/lib/utils/api-token', () => ({
  generateApiToken: () => ({ fullToken: 'rmab_full', tokenHash: 'hash', tokenPrefix: 'rmab_' }),
}));
vi.mock('@/lib/services/job-queue.service', () => ({
  getJobQueueService: () => ({ addCheckWatchedItemJob: async () => {}, addSyncShelvesJob: async () => {} }),
}));
vi.mock('@/lib/services/notification', () => ({
  getNotificationService: () => ({
    prepareSubmittedConfig: (_type: string, config: unknown) => ({ ok: true, config }),
    maskConfig: (_type: string, config: unknown) => config,
  }),
  getRegisteredProviderTypes: () => ['discord'],
}));
vi.mock('@/lib/services/goodreads-sync.service', () => ({
  fetchAndValidateRss: async () => ({ shelfName: 'to-read', books: [] }),
}));
vi.mock('@/lib/services/hardcover-api.service', () => ({
  fetchHardcoverList: async () => ({ listName: 'Want to Read', books: [] }),
}));
vi.mock('@/lib/services/encryption.service', () => ({
  getEncryptionService: () => ({ encrypt: (s: string) => `enc:${s}`, decrypt: (s: string) => s }),
}));

const echoCreate = async ({ data }: { data: Record<string, unknown> }) => ({ id: 'new-1', createdAt: new Date(), ...data });

const routeRequest = request as unknown as NextRequest;

async function send(load: () => Promise<{ POST: (req: NextRequest) => Promise<Response> }>, body: unknown) {
  state.body = body;
  const { POST } = await load();
  const response = await POST(routeRequest);
  return { status: response.status, payload: await response.json() };
}

const userTokens = () => import('@/app/api/user/api-tokens/route');
const adminTokens = () => import('@/app/api/admin/api-tokens/route');

beforeEach(() => {
  state.body = undefined;
  prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'user', plexUsername: 'someone' });
  prismaMock.apiToken.count.mockResolvedValue(0);
  prismaMock.apiToken.create.mockImplementation(echoCreate);
  prismaMock.watchedAuthor.findUnique.mockResolvedValue(null);
  prismaMock.watchedAuthor.create.mockImplementation(echoCreate);
  prismaMock.watchedSeries.findUnique.mockResolvedValue(null);
  prismaMock.watchedSeries.create.mockImplementation(echoCreate);
  notificationCreate.mockImplementation(echoCreate);
  prismaMock.goodreadsShelf.findMany.mockResolvedValue([]);
  prismaMock.goodreadsShelf.create.mockImplementation(echoCreate);
  prismaMock.hardcoverShelf.findUnique.mockResolvedValue(null);
  prismaMock.hardcoverShelf.create.mockImplementation(echoCreate);
});

describe('POST /api/user/api-tokens expiresAt', () => {
  it('accepts the expiry the UI sends (toISOString)', async () => {
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const { status } = await send(userTokens, { name: 'CLI', expiresAt });
    expect(status).toBe(201);
    expect(prismaMock.apiToken.create.mock.calls[0][0].data.expiresAt).toEqual(new Date(expiresAt));
  });

  it.each(['2026-11-25T10:20Z', '2026-11-25T10:20:00+00:00', '2026-11-25'])('rejects %s', async (expiresAt) => {
    const { status, payload } = await send(userTokens, { name: 'CLI', expiresAt });
    expect(status).toBe(400);
    expect(payload.details[0]).toMatchObject({ code: 'invalid_format', format: 'datetime', path: ['expiresAt'] });
    expect(prismaMock.apiToken.create).not.toHaveBeenCalled();
  });

  it('counts the 100-character name limit in code points', async () => {
    expect((await send(userTokens, { name: '\u{1F511}'.repeat(60) })).status).toBe(201);
    const { status, payload } = await send(userTokens, { name: '\u{1F511}'.repeat(101) });
    expect(status).toBe(400);
    expect(payload.details[0]).toMatchObject({ code: 'too_big', origin: 'string', maximum: 100, path: ['name'] });
  });
});

describe('POST /api/admin/api-tokens userId', () => {
  it.each([
    ['a database (v4) uuid', randomUUID()],
    ['an id with any version digit', '11111111-1111-1111-1111-111111111111'],
  ])('looks up the target user for %s', async (_label, userId) => {
    const { status } = await send(adminTokens, { name: 'For someone', userId });
    expect(status).toBe(201);
    expect(prismaMock.user.findUnique.mock.calls[0][0].where).toEqual({ id: userId });
  });

  it('rejects an id that is not 8-4-4-4-12 hex', async () => {
    const { status, payload } = await send(adminTokens, { name: 'For someone', userId: 'user-1' });
    expect(status).toBe(400);
    expect(payload.details[0]).toMatchObject({ code: 'invalid_format', format: 'guid', path: ['userId'] });
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });
});

describe.each([
  ['watched-authors', () => import('@/app/api/user/watched-authors/route'), { authorAsin: 'B000APZOQA', authorName: 'Author' }, 'author', () => prismaMock.watchedAuthor.create],
  ['watched-series', () => import('@/app/api/user/watched-series/route'), { seriesAsin: 'B0BXN9QJ9T', seriesTitle: 'Series' }, 'series', () => prismaMock.watchedSeries.create],
] as const)('POST /api/user/%s coverArtUrl', (_name, load, base, key, create) => {
  it.each([
    'https://m.media-amazon.com/images/I/51abc._SL500_.jpg',
    'http://192.168.1.5:13378/api/items/abc/cover',
  ])('accepts %s', async (coverArtUrl) => {
    const { status, payload } = await send(load, { ...base, coverArtUrl });
    expect(status).toBe(201);
    expect(payload[key].coverArtUrl).toBe(coverArtUrl);
  });

  it('stores a padded URL trimmed', async () => {
    const { status } = await send(load, { ...base, coverArtUrl: '  https://example.com/cover.jpg\n' });
    expect(status).toBe(201);
    expect(create().mock.calls[0][0].data.coverArtUrl).toBe('https://example.com/cover.jpg');
  });

  it('rejects a value that is not a URL', async () => {
    const { status, payload } = await send(load, { ...base, coverArtUrl: 'not a url' });
    expect(status).toBe(400);
    expect(payload.details[0]).toMatchObject({ code: 'invalid_format', format: 'url', path: ['coverArtUrl'] });
  });
});

describe('POST /api/admin/notifications config and defaults', () => {
  const load = () => import('@/app/api/admin/notifications/route');
  const base = { type: 'discord', name: 'Discord', events: ['request_available'] };

  it('accepts a config object and defaults enabled to true', async () => {
    const { status } = await send(load, { ...base, config: { webhookUrl: 'https://discord.example/x' } });
    expect(status).toBe(201);
    const data = notificationCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ config: { webhookUrl: 'https://discord.example/x' }, enabled: true });
  });

  it.each([[[]], [null], ['text']])('rejects config %j', async (config) => {
    const { status, payload } = await send(load, { ...base, config });
    expect(status).toBe(400);
    expect(payload.details[0]).toMatchObject({ code: 'invalid_type', expected: 'record', path: ['config'] });
  });
});

describe('shelf adds default autoRequest to true', () => {
  it('goodreads', async () => {
    const { status } = await send(() => import('@/app/api/user/goodreads-shelves/route'), {
      rssUrl: 'https://www.goodreads.com/review/list_rss/12345?shelf=to-read',
    });
    expect(status).toBe(201);
    expect(prismaMock.goodreadsShelf.create.mock.calls[0][0].data.autoRequest).toBe(true);
  });

  it('hardcover', async () => {
    const { status } = await send(() => import('@/app/api/user/hardcover-shelves/route'), { listId: 'status-1', apiToken: 'token' });
    expect(status).toBe(201);
    expect(prismaMock.hardcoverShelf.create.mock.calls[0][0].data.autoRequest).toBe(true);
  });

  it('goodreads keeps an explicit false', async () => {
    await send(() => import('@/app/api/user/goodreads-shelves/route'), {
      rssUrl: 'https://www.goodreads.com/review/list_rss/12345?shelf=read',
      autoRequest: false,
    });
    expect(prismaMock.goodreadsShelf.create.mock.calls[0][0].data.autoRequest).toBe(false);
  });
});

describe('validation error details', () => {
  it('home-sections returns code, path and message, and no input', async () => {
    state.body = { sections: [{ sectionType: 'Q'.repeat(5000), sortOrder: -1 }] };
    const { PUT } = await import('@/app/api/user/home-sections/route');
    const response = await PUT(routeRequest);
    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload.details.map((d: { path: unknown[] }) => d.path)).toEqual([
      ['sections', 0, 'sectionType'],
      ['sections', 0, 'sortOrder'],
    ]);
    for (const detail of payload.details) expect(Object.keys(detail)).toEqual(expect.arrayContaining(['code', 'path', 'message']));
    expect(JSON.stringify(payload)).not.toContain('QQQQQQQQ');
  });
});
