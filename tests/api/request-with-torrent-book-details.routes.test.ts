/**
 * Component: Request With Torrent Book Details Tests
 * Documentation: documentation/phase3/prowlarr.md
 *
 * POST /api/audiobooks/request-with-torrent: a new book takes its title and author from the
 * Audible lookup, the sent values only when the lookup has none; a saved book's title and author
 * are not changed by the request. A new book takes the looked-up cover, else a sent cover only on
 * an Audible image host.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const state = vi.hoisted(() => ({ body: {} as unknown }));
const jobQueueMock = vi.hoisted(() => ({ addDownloadJob: vi.fn(), addNotificationJob: vi.fn(() => Promise.resolve()) }));
const audibleServiceMock = vi.hoisted(() => ({ getAudiobookDetails: vi.fn() }));

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (_req: unknown, handler: (r: unknown) => unknown) => handler({ user: { id: 'user-1', role: 'admin' }, json: async () => state.body }),
}));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/utils/audiobook-matcher', () => ({ findPlexMatch: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/integrations/audible.service', () => ({ getAudibleService: () => audibleServiceMock }));
vi.mock('@/lib/integrations/prowlarr-connection', () => ({
  getProwlarrConnection: async () => ({
    baseUrl: 'http://prowlarr:9696',
    apiKey: 'test-prowlarr-key',
    base: { origin: 'http://prowlarr:9696', protocol: 'http:', hostname: 'prowlarr', host: 'prowlarr:9696', port: '9696', defaultPort: false, userinfo: '', basePath: '' },
  }),
}));
vi.mock('@/lib/middleware/interactive-search-access', () => ({ denyWithoutInteractiveSearchAccess: async () => null }));

const ASIN = 'B0TORRDT01';
const LOOKED_UP_COVER = 'https://m.media-amazon.com/images/I/lookedup._SL500_.jpg';
const AUDIBLE_COVER = 'https://m.media-amazon.com/images/I/sent._SL500_.jpg';
const OTHER_COVER = 'https://example.com/cover.jpg';
const TORRENT = { guid: 'guid', title: 'Torrent', size: 100, indexer: 'Indexer', downloadUrl: 'http://prowlarr:9696/1/download', publishDate: '2024-01-01' };

async function post(audiobook: Record<string, unknown>) {
  state.body = { audiobook, torrent: TORRENT };
  const { POST } = await import('@/app/api/audiobooks/request-with-torrent/route');
  return POST({} as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  audibleServiceMock.getAudiobookDetails.mockResolvedValue(null);
  prismaMock.request.findFirst.mockResolvedValue(null);
  prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'admin', autoApproveRequests: null, plexUsername: 'user' });
  prismaMock.audiobook.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'ab-1', ...data }));
  prismaMock.audiobook.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'ab-1', title: 'Book Title', author: 'Book Author', ...data }));
  prismaMock.request.create.mockResolvedValue({ id: 'req-1', audiobook: { id: 'ab-1' }, user: { id: 'user-1', plexUsername: 'user' } });
});

describe('request-with-torrent: book details', () => {
  it('a new book is saved with the looked-up title, author and narrator', async () => {
    prismaMock.audiobook.findFirst.mockResolvedValue(null);
    audibleServiceMock.getAudiobookDetails.mockResolvedValue({ asin: ASIN, title: 'Book Title', author: 'Book Author', narrator: 'Book Narrator' });

    const response = await post({ asin: ASIN, title: 'Book Title (Old Edition)', author: 'Another Author', narrator: 'Other Narrator' });

    expect(response.status).toBe(201);
    expect(prismaMock.audiobook.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ audibleAsin: ASIN, title: 'Book Title', author: 'Book Author', narrator: 'Book Narrator' }),
    });
    expect(jobQueueMock.addDownloadJob).toHaveBeenCalledWith('req-1', expect.objectContaining({ title: 'Book Title', author: 'Book Author' }), expect.anything());
  });

  it('a new book uses the sent title and author when the lookup finds nothing', async () => {
    prismaMock.audiobook.findFirst.mockResolvedValue(null);

    const response = await post({ asin: ASIN, title: 'Book Title', author: 'Book Author' });

    expect(response.status).toBe(201);
    expect(prismaMock.audiobook.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ audibleAsin: ASIN, title: 'Book Title', author: 'Book Author' }),
    });
  });

  it('a saved book keeps its title and author', async () => {
    prismaMock.audiobook.findFirst.mockResolvedValue({ id: 'ab-1', audibleAsin: ASIN, title: 'Book Title', author: 'Book Author' });
    audibleServiceMock.getAudiobookDetails.mockResolvedValue({ asin: ASIN, title: 'Book Title', author: 'Book Author', releaseDate: '2020-01-02' });

    const response = await post({ asin: ASIN, title: 'Book Title (Old Edition)', author: 'Another Author' });

    expect(response.status).toBe(201);
    expect(prismaMock.audiobook.create).not.toHaveBeenCalled();
    for (const [args] of prismaMock.audiobook.update.mock.calls) {
      expect(args.data).not.toHaveProperty('title');
      expect(args.data).not.toHaveProperty('author');
    }
  });
});

describe('request-with-torrent: the cover of a new book', () => {
  beforeEach(() => {
    prismaMock.audiobook.findFirst.mockResolvedValue(null);
  });

  it('takes the looked-up cover over the sent one', async () => {
    audibleServiceMock.getAudiobookDetails.mockResolvedValue({ asin: ASIN, title: 'Book Title', author: 'Book Author', coverArtUrl: LOOKED_UP_COVER });

    const response = await post({ asin: ASIN, title: 'Book Title', author: 'Book Author', coverArtUrl: AUDIBLE_COVER });

    expect(response.status).toBe(201);
    expect(prismaMock.audiobook.create).toHaveBeenCalledWith({ data: expect.objectContaining({ coverArtUrl: LOOKED_UP_COVER }) });
  });

  it('keeps a sent Audible cover when the lookup has none', async () => {
    const response = await post({ asin: ASIN, title: 'Book Title', author: 'Book Author', coverArtUrl: AUDIBLE_COVER });

    expect(response.status).toBe(201);
    expect(prismaMock.audiobook.create).toHaveBeenCalledWith({ data: expect.objectContaining({ coverArtUrl: AUDIBLE_COVER }) });
  });

  it('drops a cover sent from another host', async () => {
    const response = await post({ asin: ASIN, title: 'Book Title', author: 'Book Author', coverArtUrl: OTHER_COVER });

    expect(response.status).toBe(201);
    expect(prismaMock.audiobook.create).toHaveBeenCalledWith({ data: expect.objectContaining({ coverArtUrl: undefined }) });
  });
});
