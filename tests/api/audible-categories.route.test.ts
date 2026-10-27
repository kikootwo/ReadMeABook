/**
 * Component: Audible Categories API Route Tests (#309)
 * Documentation: documentation/features/home-sections.md
 *
 * GET /api/audible/categories through the real AudibleService, with only the
 * catalog HTTP client faked (recorded US answer, trimmed).
 */

import fs from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const htmlClientMock = vi.hoisted(() => ({ get: vi.fn() }));
const apiClientMock = vi.hoisted(() => ({ get: vi.fn() }));
const axiosMock = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn() }));
const configServiceMock = vi.hoisted(() => ({ getAudibleRegion: vi.fn() }));

vi.mock('axios', () => ({ default: axiosMock, ...axiosMock }));
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configServiceMock,
}));
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: vi.fn((_req: unknown, handler: (req: unknown) => unknown) =>
    handler({ user: { id: 'user-1', sub: 'user-1', role: 'user' } }),
  ),
}));

const FIXTURE = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'audible-catalog', 'us-categories-two-levels.json'),
    'utf8',
  ),
);

describe('GET /api/audible/categories (#309)', () => {
  beforeEach(() => {
    axiosMock.create.mockImplementation((cfg: { baseURL: string }) =>
      cfg.baseURL.includes('//api.') ? apiClientMock : htmlClientMock,
    );
    configServiceMock.getAudibleRegion.mockResolvedValue('us');
  });

  it('returns each top-level category with its sub-categories (id, name, parentId)', async () => {
    apiClientMock.get.mockResolvedValue({ data: FIXTURE });
    const { GET } = await import('@/app/api/audible/categories/route');

    const res = await GET({} as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(apiClientMock.get).toHaveBeenCalledTimes(1);

    const lit = body.categories.find((c: { name: string }) => c.name === 'Literature & Fiction');
    expect(Object.keys(lit).sort()).toEqual(['id', 'name', 'subcategories']);
    expect(lit.subcategories).toContainEqual({ id: '18574490011', name: 'Horror', parentId: '18574426011' });
    for (const cat of body.categories) {
      expect(Array.isArray(cat.subcategories)).toBe(true);
      for (const sub of cat.subcategories) {
        expect(Object.keys(sub).sort()).toEqual(['id', 'name', 'parentId']);
        expect(sub.parentId).toBe(cat.id);
      }
    }
  });
});
