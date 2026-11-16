/**
 * Component: Plex scan warning for items without an Audible ID (#298)
 * Documentation: documentation/integrations/plex.md
 *
 * A full Plex scan logs one warn line when items carry no Audible ID in their guid
 * (another metadata agent than Audnexus), and nothing when every item has one.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const libraryServiceMock = vi.hoisted(() => ({
  getLibraryItems: vi.fn(),
  getCoverCachingParams: vi.fn(),
}));
const configMock = vi.hoisted(() => ({
  getBackendMode: vi.fn(),
  getPlexConfig: vi.fn(),
  get: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/library', () => ({ getLibraryService: async () => libraryServiceMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/thumbnail-cache.service', () => ({ getThumbnailCacheService: () => ({}) }));
vi.mock('@/lib/services/library/library-cover', () => ({ cacheLibraryCover: vi.fn(async () => undefined) }));
vi.mock('@/lib/services/library/match-requests', () => ({
  matchRequestsToLibrary: vi.fn(async () => ({ matched: 0, total: 0 })),
}));
vi.mock('@/lib/services/library/follow-library-asin', () => ({ followLibraryAsins: vi.fn(async () => undefined) }));

const item = (n: number, guid: string) => ({
  id: `rating-${n}`,
  externalId: guid,
  title: `Book ${n}`,
  author: 'Author',
  addedAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
});

const AUDNEXUS = (asin: string) => `com.plexapp.agents.audnexus://${asin}_us?lang=en`;

let warnSpy: ReturnType<typeof vi.spyOn>;
const audibleIdWarnings = () =>
  warnSpy.mock.calls.map(c => String(c[0])).filter(line => line.includes('Audible ID'));

describe('processScanPlex: items without an Audible ID', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    configMock.getBackendMode.mockResolvedValue('plex');
    configMock.getPlexConfig.mockResolvedValue({ serverUrl: 'http://plex', authToken: 't', libraryId: 'lib-1' });
    libraryServiceMock.getCoverCachingParams.mockResolvedValue({});
    prismaMock.plexLibrary.findFirst.mockResolvedValue({ id: 'existing', plexGuid: 'x' });
    prismaMock.plexLibrary.update.mockResolvedValue({});
    prismaMock.plexLibrary.findMany.mockResolvedValue([]);
    prismaMock.audiobook.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('logs one line with the counts when some items have another agent', async () => {
    libraryServiceMock.getLibraryItems.mockResolvedValue([
      item(1, AUDNEXUS('B08G9PRS1K')),
      item(2, 'com.plexapp.agents.none://354583/-1/-1?lang=xn'),
      item(3, 'plex://album/5d07bcfe403c64002036d1af'),
      item(4, 'com.plexapp.agents.audible://B00ABC1234?lang=en'),
      item(5, AUDNEXUS('1774247658')),
    ]);

    const { processScanPlex } = await import('@/lib/processors/scan-plex.processor');
    await processScanPlex({});

    expect(audibleIdWarnings()).toEqual([
      expect.stringContaining(
        "2 of 5 Plex items have no Audible ID in their metadata, so requests can't be marked available for them. Plex libraries need the Audnexus agent."
      ),
    ]);
  });

  it('logs nothing when every item comes from Audnexus', async () => {
    libraryServiceMock.getLibraryItems.mockResolvedValue([
      item(1, AUDNEXUS('B08G9PRS1K')),
      item(2, 'com.plexapp.agents.audnexus://B0FL4BYY2H?lang=en'),
    ]);

    const { processScanPlex } = await import('@/lib/processors/scan-plex.processor');
    await processScanPlex({});

    expect(audibleIdWarnings()).toEqual([]);
  });

  it('does not run for an Audiobookshelf library', async () => {
    configMock.getBackendMode.mockResolvedValue('audiobookshelf');
    configMock.get.mockResolvedValue('abs-lib');
    libraryServiceMock.getLibraryItems.mockResolvedValue([item(1, 'abs-item-1')]);
    vi.doMock('@/lib/services/audiobookshelf/match-missing-asins', () => ({
      matchItemsWithoutAsin: vi.fn(async () => ({ considered: 0 })),
    }));

    const { processScanPlex } = await import('@/lib/processors/scan-plex.processor');
    await processScanPlex({});

    expect(audibleIdWarnings()).toEqual([]);
  });
});
