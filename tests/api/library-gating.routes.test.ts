/**
 * Component: Library API gating tests (viewer matrix, canaries, covers, admin path rule)
 * Documentation: documentation/features/library-view.md
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { CANARY, VIEWERS, get, installStack, seedStack } from '../lib/library-view/route-seed';

const prismaMock = createPrismaMock();
const requireAuthMock = vi.hoisted(() => vi.fn());
const configMock = vi.hoisted(() => ({ getBackendMode: vi.fn(), get: vi.fn(), getPlexConfig: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/middleware/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));

const mocks = { prisma: prismaMock, config: configMock };
const UNIVERSAL_CANARIES = [CANARY.absFolder, CANARY.placedEbook, CANARY.bypass, CANARY.rawLibraryAsin, CANARY.requestedCover, 'X-Plex-Token', 'CANARY terms'];

async function call(qs: string, viewer: { id: string; role: string }) {
  const { GET } = await import('@/app/api/library/route');
  const response = await GET(get(qs, viewer, requireAuthMock));
  return { status: response.status, body: await response.json(), raw: '' };
}

async function raw(qs: string, viewer: { id: string; role: string }) {
  const { body } = await call(qs, viewer);
  return { body, text: JSON.stringify(body) };
}

const byTitle = (body: any, title: string) => body.items.find((i: any) => i.title === title);

describe('GET /api/library gating', () => {
  let stack: ReturnType<typeof seedStack>;

  beforeEach(() => {
    vi.clearAllMocks();
    stack = installStack(mocks);
  });

  it.each(Object.entries(VIEWERS))('no universal canary and no "epub" reaches %s', async (_name, viewer) => {
    const { text } = await raw('limit=120', viewer);
    for (const canary of UNIVERSAL_CANARIES) expect(text).not.toContain(canary);
    expect(text.toLowerCase()).not.toContain('epub');
  });

  it('other user: public fields only; gated keys omitted, not nulled', async () => {
    const { body, text } = await raw('limit=120', VIEWERS.other);
    expect(body.viewer).toEqual({ isAdmin: false });
    for (const item of body.items) {
      expect(item).not.toHaveProperty('path');
      expect(item.canSeeRequestDetails).toBe(false);
      if (!item.request) continue;
      expect(Object.keys(item.request).sort()).toEqual(['createdAt', 'id', 'isMine', 'requestedBy']);
      expect(item.request.isMine).toBe(false);
    }
    expect(text).not.toContain(CANARY.error);
    expect(text).not.toContain(CANARY.adminPath);
    // everyone sees everyone's request status and requester (LV-6)
    expect(byTitle(body, 'Failed Book')).toMatchObject({ statusGroup: 'problem', request: { requestedBy: { username: 'bob' } } });
  });

  it("requester: own items carry completedAt/errorMessage/size; others' do not; never path", async () => {
    const { body, text } = await raw('limit=120', VIEWERS.bob);
    const failed = byTitle(body, 'Failed Book');
    expect(failed.request).toEqual(expect.objectContaining({ isMine: true, errorMessage: CANARY.error, completedAt: null, downloadSizeBytes: '123' }));
    expect(failed.canSeeRequestDetails).toBe(true);
    const alices = byTitle(body, 'Library Edition');
    expect(alices.request).not.toHaveProperty('errorMessage');
    expect(alices.request).not.toHaveProperty('completedAt');
    expect(alices.request).not.toHaveProperty('downloadSizeBytes');
    expect(body.items.some((i: any) => 'path' in i)).toBe(false);
    expect(body.viewer).toEqual({ isAdmin: false });
    expect(text).not.toContain(CANARY.adminPath);
  });

  it('admin: every gated field, path on every item, canFetchEbook', async () => {
    const { body } = await raw('limit=120', VIEWERS.admin);
    expect(body.viewer).toEqual({ isAdmin: true, canFetchEbook: true });
    expect(body.items.every((i: any) => 'path' in i)).toBe(true);
    expect(byTitle(body, 'Failed Book').request).toMatchObject({ errorMessage: CANARY.error, downloadSizeBytes: '123' });
    expect(byTitle(body, 'Library Edition')).toMatchObject({ path: CANARY.adminPath, request: { completedAt: '2026-03-01T00:00:00.000Z' } });
    expect(byTitle(body, 'Scan Only Book')).toMatchObject({ path: null, request: null, canSeeRequestDetails: false });
  });

  it('admin canFetchEbook is false when no ebook source is on', async () => {
    installStack(mocks, stack, { ebookSources: false });
    expect((await call('', VIEWERS.admin)).body.viewer).toEqual({ isAdmin: true, canFetchEbook: false });
  });

  it('admin path is null once an ebook request on that book reached organize', async () => {
    prismaMock.request.findMany.mockImplementation(async (args: any) => {
      if (args?.where?.type === 'ebook') return [{ audiobookId: stack.ids.aliceFollowed.audiobookId }];
      return stack.requests;
    });
    const { body } = await call('limit=120', VIEWERS.admin);
    expect(byTitle(body, 'Library Edition').path).toBeNull();
    expect(byTitle(body, 'Failed Book').path).toBe(CANARY.adminPath);
    const ebookQuery = prismaMock.request.findMany.mock.calls.map((c) => c[0]).find((a) => a.where.type === 'ebook');
    expect(ebookQuery.where.status).toEqual({ in: ['processing', 'downloaded', 'available', 'awaiting_import', 'warn'] });
    expect(ebookQuery.where).not.toHaveProperty('deletedAt'); // deleted ebook requests count too
  });

  it('a q equal to a canary path or error matches nothing for every viewer', async () => {
    for (const viewer of Object.values(VIEWERS)) {
      for (const q of [CANARY.absFolder, CANARY.placedEbook, CANARY.error, CANARY.adminPath, CANARY.bypass]) {
        const { body } = await call(`q=${encodeURIComponent(q)}`, viewer);
        expect(body.matched).toBe(0);
      }
    }
  });

  describe('covers', () => {
    it('followed book: the library cover named for its library ASIN', async () => {
      const { body } = await call('limit=120', VIEWERS.other);
      expect(byTitle(body, 'Library Edition').coverUrl).toBe('/api/cache/library/0123456789abcdef-B0LIBRARY1.jpg');
    });

    it('followed book with a legacy <hash>.jpg cover gets null, never the requested edition', async () => {
      const { body } = await call('limit=120', VIEWERS.other);
      expect(byTitle(body, 'Legacy Cover Book').coverUrl).toBeNull();
    });

    it('followed book with no library cover never falls back to the requested edition (by its ASIN)', async () => {
      const { body } = await call('limit=120', VIEWERS.other);
      expect(byTitle(body, 'No Cover Book').coverUrl).toBeNull();
      const lookedUp = prismaMock.audibleCache.findMany.mock.calls.flatMap((c) => c[0].where.asin.in);
      expect(lookedUp).not.toContain('B0REQUEST3');
    });

    it('scan book: its library cover; request-only: audible_cache by ASIN', async () => {
      const { body } = await call('limit=120', VIEWERS.other);
      expect(byTitle(body, 'Scan Only Book').coverUrl).toBe('/api/cache/library/fedcba9876543210-B0SCANONLY.jpg');
      expect(byTitle(body, 'Failed Book').coverUrl).toBe('https://img.example/failed.jpg');
    });
  });

  it("a deleted account's request stays, with the stored name; the facet flags it", async () => {
    const { body } = await call('', VIEWERS.other);
    expect(byTitle(body, 'Gone Carol Book').request.requestedBy).toEqual({ id: expect.any(String), username: 'carol' });
    expect(body.facets.requestedBy.find((f: any) => f.username === 'carol')).toMatchObject({ deleted: true, count: 1 });
  });
});
