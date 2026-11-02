/**
 * Component: Admin Bulk Import Scan API Route Tests (ASIN read from the folder name)
 * Documentation: documentation/features/bulk-import.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const audibleMock = vi.hoisted(() => ({
  getAudiobookDetails: vi.fn(),
  search: vi.fn(),
}));
const scannerMock = vi.hoisted(() => ({ discoverAudiobooks: vi.fn() }));
const fsMock = vi.hoisted(() => ({ stat: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

type Handler = (req?: unknown) => unknown;
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (req: { user?: unknown }, handler: Handler) => {
    req.user = { id: 'admin-1', role: 'admin' };
    return handler(req);
  },
  requireAdmin: (_req: unknown, handler: Handler) => handler(),
}));

vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => audibleMock,
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({ getAudibleRegion: async () => 'us' }),
}));

vi.mock('@/lib/utils/audiobook-matcher', () => ({
  findPlexMatch: async () => null,
}));

vi.mock('@/lib/utils/bulk-import-scanner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils/bulk-import-scanner')>();
  return { ...actual, discoverAudiobooks: scannerMock.discoverAudiobooks };
});

vi.mock('fs/promises', () => ({ default: fsMock, ...fsMock }));

const TAG_SEARCH_TERM = 'tag title tag author';
const TEXT_MATCH = { asin: 'B0TEXTMATCH', title: 'Text Search Pick', author: 'Someone' };

/** One discovered book, with the B ASIN the scanner itself reads from the folder name. */
async function discovered(folderName: string) {
  const { extractAsinFromString } = await vi.importActual<typeof import('@/lib/utils/bulk-import-scanner')>(
    '@/lib/utils/bulk-import-scanner',
  );
  return {
    folderPath: `/media/Author/${folderName}`,
    folderName,
    relativePath: `Author/${folderName}`,
    audioFileCount: 1,
    totalSizeBytes: 1000,
    metadata: {},
    searchTerm: TAG_SEARCH_TERM,
    metadataSource: 'tags',
    extractedAsin: extractAsinFromString(folderName) ?? undefined,
    audioFiles: ['01.mp3'],
    groupingKey: folderName.toLowerCase(),
  };
}

/** Run one scan of a single folder and return the book_matched event payload. */
async function scanOne(folderName: string) {
  scannerMock.discoverAudiobooks.mockResolvedValue([await discovered(folderName)]);
  const { POST } = await import('@/app/api/admin/bulk-import/scan/route');
  const response = await POST(
    new NextRequest('http://localhost/api/admin/bulk-import/scan', {
      method: 'POST',
      body: JSON.stringify({ rootPath: '/media' }),
      headers: { 'content-type': 'application/json' },
    }),
  );
  expect(response.status).toBe(200);
  const text = await response.text();
  const event = text.split('\n\n').find((chunk) => chunk.startsWith('event: book_matched'));
  expect(event, text).toBeDefined();
  return JSON.parse(event!.split('\ndata: ')[1]);
}

function catalogBook(asin: string, title: string) {
  return { asin, title, author: 'Catalog Author', narrator: 'Catalog Narrator' };
}

describe('Admin bulk-import scan route: ASIN in the folder name', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.configuration.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
      where.key === 'media_dir' ? { key: 'media_dir', value: '/media' } : null,
    );
    prismaMock.request.findFirst.mockResolvedValue(null);
    fsMock.stat.mockImplementation(async (target: string) => {
      if (String(target).replace(/\\/g, '/').endsWith('/media')) return { isDirectory: () => true };
      throw new Error('ENOENT');
    });
    audibleMock.search.mockResolvedValue({ results: [TEXT_MATCH] });
  });

  it.each([
    ['bare, as the default {title} {asin} template writes it', 'A Quiet Harbor 0062976583', '0062976583'],
    ['bracketed', 'A Quiet Harbor [0062976583]', '0062976583'],
    ['parenthesized', 'A Quiet Harbor (0062976583)', '0062976583'],
    ['ending in X', 'A Quiet Harbor [177424855X]', '177424855X'],
    ['ending in lowercase x', 'A Quiet Harbor 177424855x', '177424855X'],
  ])('reads an all-digit ASIN (%s) as a direct match when the catalog title fits', async (_label, folderName, asin) => {
    audibleMock.getAudiobookDetails.mockResolvedValue(catalogBook(asin, 'A Quiet Harbor'));

    const result = await scanOne(folderName);

    expect(audibleMock.getAudiobookDetails).toHaveBeenCalledWith(asin, { fillSeries: false });
    expect(audibleMock.search).not.toHaveBeenCalled();
    expect(result.match.asin).toBe(asin);
    expect(result.extractedAsin).toBe(asin);
  });

  it('confirms a candidate when the catalog title adds a subtitle the folder name leaves out', async () => {
    audibleMock.getAudiobookDetails.mockResolvedValue(catalogBook('0062976583', 'A Quiet Harbor: A Novel'));

    const result = await scanOne('Jane Writer - A Quiet Harbor 0062976583');

    expect(audibleMock.search).not.toHaveBeenCalled();
    expect(result.match.asin).toBe('0062976583');
  });

  it('looks up the last 10-digit run when a folder name holds two', async () => {
    audibleMock.getAudiobookDetails.mockResolvedValue(catalogBook('0062976583', 'A Quiet Harbor'));

    const result = await scanOne('1234567890 - A Quiet Harbor 0062976583');

    expect(audibleMock.getAudiobookDetails).toHaveBeenCalledWith('0062976583', { fillSeries: false });
    expect(result.match.asin).toBe('0062976583');
  });

  it('falls back to the text search when the candidate resolves to a different-looking title', async () => {
    audibleMock.getAudiobookDetails.mockResolvedValue(catalogBook('0062976583', 'Gardening for Beginners'));

    const result = await scanOne('A Quiet Harbor [0062976583]');

    expect(audibleMock.getAudiobookDetails).toHaveBeenCalledWith('0062976583', { fillSeries: false });
    expect(audibleMock.search).toHaveBeenCalledWith(TAG_SEARCH_TERM);
    expect(result.match.asin).toBe(TEXT_MATCH.asin);
    expect(result.extractedAsin).toBeUndefined();
  });

  it.each([
    ['resolves to nothing', () => audibleMock.getAudiobookDetails.mockResolvedValue(null)],
    ['throws', () => audibleMock.getAudiobookDetails.mockRejectedValue(new Error('lookup failed'))],
  ])('falls back to the text search when the candidate lookup %s', async (_label, arrange) => {
    arrange();

    const result = await scanOne('A Quiet Harbor 0062976583');

    expect(audibleMock.getAudiobookDetails).toHaveBeenCalledWith('0062976583', { fillSeries: false });
    expect(audibleMock.search).toHaveBeenCalledWith(TAG_SEARCH_TERM);
    expect(result.match.asin).toBe(TEXT_MATCH.asin);
    expect(result.extractedAsin).toBeUndefined();
  });

  // Guards (pass on main too): these never become candidates
  it.each([
    ['an ISBN-13', 'A Quiet Harbor 9780062976581'],
    ['a hyphenated ISBN-13', 'A Quiet Harbor 978-0-06-297658-1'],
    ['a 10-digit run joined to an ISBN-13 prefix', 'A Quiet Harbor 978-0062976583'],
    ['an 11-digit number', 'A Quiet Harbor 00629765831'],
    ['a 12-digit number', 'A Quiet Harbor 006297658312'],
    ['a date and time stamp', 'A Quiet Harbor 2023-10-27_1698412345'],
    ['a dotted date stamp', 'A Quiet Harbor 2023.10.27.1698412345'],
    ['a compact timestamp', 'A Quiet Harbor 20231027153012'],
    ['digits inside a word', 'A Quiet Harbor v0062976583'],
  ])('ignores %s', async (_label, folderName) => {
    const result = await scanOne(folderName);

    expect(audibleMock.getAudiobookDetails).not.toHaveBeenCalled();
    expect(audibleMock.search).toHaveBeenCalledWith(TAG_SEARCH_TERM);
    expect(result.extractedAsin).toBeUndefined();
  });

  // Guards (pass on main too): B ASINs keep the direct lookup with no title check
  it('keeps a B ASIN as a direct match even when the catalog title differs', async () => {
    audibleMock.getAudiobookDetails.mockResolvedValue(catalogBook('B019NOKST6', 'Gardening for Beginners'));

    const result = await scanOne('A Quiet Harbor [B019NOKST6]');

    expect(audibleMock.getAudiobookDetails).toHaveBeenCalledWith('B019NOKST6', { fillSeries: false });
    expect(audibleMock.search).not.toHaveBeenCalled();
    expect(result.match.asin).toBe('B019NOKST6');
    expect(result.extractedAsin).toBe('B019NOKST6');
  });

  it('prefers the B ASIN when a folder name holds both kinds', async () => {
    audibleMock.getAudiobookDetails.mockResolvedValue(catalogBook('B019NOKST6', 'A Quiet Harbor'));

    const result = await scanOne('A Quiet Harbor 0062976583 [B019NOKST6]');

    expect(audibleMock.getAudiobookDetails).toHaveBeenCalledTimes(1);
    expect(audibleMock.getAudiobookDetails).toHaveBeenCalledWith('B019NOKST6', { fillSeries: false });
    expect(result.match.asin).toBe('B019NOKST6');
  });

  it('keeps searching the folder name when a B ASIN lookup fails', async () => {
    audibleMock.getAudiobookDetails.mockResolvedValue(null);

    const result = await scanOne('A Quiet Harbor [B019NOKST6]');

    expect(audibleMock.search).toHaveBeenCalledWith('A Quiet Harbor');
    expect(result.extractedAsin).toBe('B019NOKST6');
  });
});
