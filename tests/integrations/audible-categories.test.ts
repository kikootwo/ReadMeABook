/**
 * Component: Audible Category Tree Tests (#309)
 * Documentation: documentation/features/home-sections.md
 *
 * getCategories() on the recorded US catalog answer for
 * /1.0/catalog/categories?categories_num_levels=2 (trimmed to four top-level categories).
 */

import fs from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudibleService } from '@/lib/integrations/audible.service';

const htmlClientMock = vi.hoisted(() => ({ get: vi.fn() }));
const apiClientMock = vi.hoisted(() => ({ get: vi.fn() }));
const axiosMock = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn() }));
const configServiceMock = vi.hoisted(() => ({ getAudibleRegion: vi.fn() }));

vi.mock('axios', () => ({ default: axiosMock, ...axiosMock }));
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configServiceMock,
}));

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'audible-catalog');
const readFixture = (name: string) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));

const LIT_FICTION = '18574426011';
const HORROR = '18574490011';
const COMEDY = '24427740011';

describe('AudibleService.getCategories() category tree (#309)', () => {
  beforeEach(() => {
    axiosMock.create.mockImplementation((cfg: { baseURL: string }) =>
      cfg.baseURL.includes('//api.') ? apiClientMock : htmlClientMock,
    );
    configServiceMock.getAudibleRegion.mockResolvedValue('us');
  });

  it('asks the catalog for two levels in one request and keeps each sub-category under its parent', async () => {
    apiClientMock.get.mockResolvedValue({ data: readFixture('us-categories-two-levels.json') });

    const categories = await new AudibleService().getCategories();

    expect(apiClientMock.get).toHaveBeenCalledTimes(1);
    expect(apiClientMock.get).toHaveBeenCalledWith('/1.0/catalog/categories', {
      params: { categories_num_levels: 2 },
    });
    expect(htmlClientMock.get).not.toHaveBeenCalled();

    expect(categories.map((c) => c.name)).toEqual([
      'Comedy & Humor',
      'Literature & Fiction',
      'Mystery, Thriller & Suspense',
      'Science Fiction & Fantasy',
    ]);

    const lit = categories.find((c) => c.id === LIT_FICTION)!;
    expect(lit.subcategories).toHaveLength(18);
    expect(lit.subcategories).toContainEqual({ id: HORROR, name: 'Horror', parentId: LIT_FICTION });
    expect(lit.subcategories.every((s) => s.parentId === LIT_FICTION)).toBe(true);

    const scifi = categories.find((c) => c.name === 'Science Fiction & Fantasy')!;
    expect(scifi.subcategories.map((s) => s.name)).toEqual(['Fantasy', 'Science Fiction']);
  });

  it('keeps a sub-category Audible lists under two parents under both, with each parent\'s name for it', async () => {
    apiClientMock.get.mockResolvedValue({ data: readFixture('us-categories-two-levels.json') });

    const categories = await new AudibleService().getCategories();
    const shared = '18574496011';

    expect(categories.find((c) => c.id === COMEDY)!.subcategories ?? []).toContainEqual({
      id: shared, name: 'Literature & Fiction', parentId: COMEDY,
    });
    expect(categories.find((c) => c.id === LIT_FICTION)!.subcategories ?? []).toContainEqual({
      id: shared, name: 'Humor & Satire', parentId: LIT_FICTION,
    });
  });

  it('still returns the top level when the answer has no sub-categories', async () => {
    apiClientMock.get.mockResolvedValue({ data: readFixture('us-categories-top-level.json') });

    const categories = await new AudibleService().getCategories();

    expect(categories).toHaveLength(4);
    expect(categories.find((c) => c.id === LIT_FICTION)).toEqual({
      id: LIT_FICTION, name: 'Literature & Fiction', subcategories: [],
    });
    expect(categories.every((c) => Array.isArray(c.subcategories) && c.subcategories.length === 0)).toBe(true);
  });
});
