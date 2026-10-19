/**
 * Component: Shelf Sync Core Service Tests
 * Documentation: documentation/backend/services/goodreads-sync.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const audibleServiceMock = vi.hoisted(() => ({ search: vi.fn() }));
const createRequestMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => audibleServiceMock,
}));

vi.mock('@/lib/services/request-creator.service', () => ({
  createRequestForUser: createRequestMock,
}));

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;

describe('processShelfBooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.bookMapping.findUnique.mockResolvedValue(null);
    prismaMock.bookMapping.findMany.mockResolvedValue([]);
    prismaMock.audibleCache.findMany.mockResolvedValue([]);
  });

  it('applies the Audible language filter to lookups and records a miss as noMatch', async () => {
    audibleServiceMock.search.mockResolvedValue({ results: [] });

    const { processShelfBooks, createEmptyStats } = await import('@/lib/services/shelf-sync-core.service');
    await processShelfBooks(
      'goodreads',
      [{ bookId: 'gr-1', title: 'Six of Crows', author: 'Leigh Bardugo' }],
      'user-1',
      'shelf-1',
      createEmptyStats(),
      log,
      10,
    );

    expect(audibleServiceMock.search).toHaveBeenCalledWith('Six of Crows Leigh Bardugo', 1, {
      respectLanguageFilter: true,
    });
    expect(prismaMock.bookMapping.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ externalBookId: 'gr-1', noMatch: true, audibleAsin: null }),
    });
    expect(createRequestMock).not.toHaveBeenCalled();
  });
});
