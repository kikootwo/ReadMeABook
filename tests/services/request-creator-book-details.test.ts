/**
 * Component: Request Creator Book Details Tests (title, author and cover come from the looked-up metadata)
 * Documentation: documentation/backend/services/goodreads-sync.md
 *
 * createRequestForUser and POST /api/requests: a new book takes its title and author from the
 * Audible lookup (Audnexus, then the catalog) and uses the request's values only when the lookup
 * has none; an existing book's saved title and author change only to looked-up values. A user's
 * request takes the looked-up cover, else a sent cover only on an Audible image host.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const state = vi.hoisted(() => ({ body: {} as unknown }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));
vi.mock('@/lib/utils/audiobook-matcher', () => ({ findPlexMatch: vi.fn().mockResolvedValue(null) }));
const audibleServiceMock = vi.hoisted(() => ({ getAudiobookDetails: vi.fn() }));
vi.mock('@/lib/integrations/audible.service', () => ({ getAudibleService: () => audibleServiceMock }));
const jobQueue = vi.hoisted(() => ({ addSearchJob: vi.fn(), addNotificationJob: vi.fn() }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueue }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => ({ get: vi.fn(async () => null) }) }));
const worksMock = vi.hoisted(() => ({ getSiblingAsins: vi.fn(async () => new Map()), seedAsin: vi.fn(async () => undefined) }));
vi.mock('@/lib/services/works.service', () => worksMock);
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (_req: unknown, handler: (r: unknown) => unknown) =>
    handler({ user: { id: 'user-1', role: 'user' }, nextUrl: new URL('http://localhost/api/requests'), json: async () => state.body }),
}));

const { createRequestForUser } = await import('@/lib/services/request-creator.service');

const USER = 'user-1';
const ASIN = 'B0BOOKDT01';
const SAVED = { id: 'book-1', audibleAsin: ASIN, title: 'Book Title', author: 'Book Author', narrator: null, coverArtUrl: null };
const LOOKED_UP = { asin: ASIN, title: 'Book Title', author: 'Book Author', narrator: 'Book Narrator', description: 'About the book.' };
const LOOKED_UP_COVER = 'https://m.media-amazon.com/images/I/lookedup._SL500_.jpg';
const AUDIBLE_COVER = 'https://m.media-amazon.com/images/I/sent._SL500_.jpg';
const CACHED_COVER = '/api/cache/thumbnails/B0BOOKDT01.jpg';
const OTHER_COVER = 'https://example.com/cover.jpg';

beforeEach(() => {
  vi.clearAllMocks();
  audibleServiceMock.getAudiobookDetails.mockResolvedValue(null);
  prismaMock.request.findFirst.mockResolvedValue(null);
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock));
  prismaMock.request.create.mockResolvedValue({ id: 'req-1', audiobook: { id: 'book-1' }, user: { id: USER } });
  prismaMock.ignoredAudiobook.findUnique.mockResolvedValue(null);
  prismaMock.ignoredAudiobook.findFirst.mockResolvedValue(null);
  prismaMock.user.findUnique.mockResolvedValue({ role: 'user', autoApproveRequests: true, plexUsername: 'u' });
  prismaMock.audiobook.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'book-1', ...data }));
  prismaMock.audiobook.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...SAVED, ...data }));
  jobQueue.addSearchJob.mockResolvedValue(undefined);
  jobQueue.addNotificationJob.mockResolvedValue(undefined);
});

describe('createRequestForUser: an existing book', () => {
  it('keeps its saved title and author when the request sends different ones', async () => {
    prismaMock.audiobook.findFirst.mockResolvedValue(SAVED);

    const result = await createRequestForUser(USER, { asin: ASIN, title: 'Book Title (Old Edition)', author: 'Another Author' });

    expect(result.success).toBe(true);
    expect(prismaMock.audiobook.update).not.toHaveBeenCalled();
    for (const [args] of prismaMock.audiobook.update.mock.calls) {
      expect(args.data).not.toHaveProperty('title');
      expect(args.data).not.toHaveProperty('author');
    }
    expect(worksMock.seedAsin).toHaveBeenCalledWith(ASIN, 'Book Title', 'Book Author', undefined, undefined);
    expect(jobQueue.addSearchJob).toHaveBeenCalledWith('req-1', expect.objectContaining({ title: 'Book Title', author: 'Book Author' }));
  });

  it('keeps them when the lookup agrees with the saved values and the request differs', async () => {
    prismaMock.audiobook.findFirst.mockResolvedValue(SAVED);
    audibleServiceMock.getAudiobookDetails.mockResolvedValue(LOOKED_UP);

    await createRequestForUser(USER, { asin: ASIN, title: 'Book Title (Old Edition)', author: 'Another Author' });

    for (const [args] of prismaMock.audiobook.update.mock.calls) {
      expect(args.data).not.toHaveProperty('title');
      expect(args.data).not.toHaveProperty('author');
    }
  });

  it('takes the looked-up title and author in place of weaker saved ones', async () => {
    prismaMock.audiobook.findFirst.mockResolvedValue({ ...SAVED, title: 'Book Title (Old Edition)', author: 'B. Author' });
    audibleServiceMock.getAudiobookDetails.mockResolvedValue(LOOKED_UP);

    const result = await createRequestForUser(USER, { asin: ASIN, title: 'Book Title (Old Edition)', author: 'B. Author' });

    expect(result.success).toBe(true);
    expect(prismaMock.audiobook.update).toHaveBeenCalledWith({
      where: { id: 'book-1' },
      data: expect.objectContaining({ title: 'Book Title', author: 'Book Author' }),
    });
    expect(worksMock.seedAsin).toHaveBeenCalledWith(ASIN, 'Book Title', 'Book Author', undefined, undefined);
  });
});

describe('createRequestForUser: a new book', () => {
  it('is created with the looked-up title, author, narrator and description', async () => {
    prismaMock.audiobook.findFirst.mockResolvedValue(null);
    audibleServiceMock.getAudiobookDetails.mockResolvedValue(LOOKED_UP);

    await createRequestForUser(USER, {
      asin: ASIN, title: 'Book Title (Old Edition)', author: 'Another Author', narrator: 'Other Narrator', description: 'Other text.',
    });

    expect(prismaMock.audiobook.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        audibleAsin: ASIN, title: 'Book Title', author: 'Book Author', narrator: 'Book Narrator', description: 'About the book.',
      }),
    });
    expect(worksMock.seedAsin).toHaveBeenCalledWith(ASIN, 'Book Title', 'Book Author', 'Book Narrator', undefined);
  });

  it('uses the request values when the lookup finds nothing', async () => {
    prismaMock.audiobook.findFirst.mockResolvedValue(null);

    await createRequestForUser(USER, { asin: ASIN, title: 'Book Title', author: 'Book Author', narrator: 'Book Narrator' });

    expect(prismaMock.audiobook.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ audibleAsin: ASIN, title: 'Book Title', author: 'Book Author', narrator: 'Book Narrator' }),
    });
  });

  it('uses the request value for a field the lookup leaves empty', async () => {
    prismaMock.audiobook.findFirst.mockResolvedValue(null);
    audibleServiceMock.getAudiobookDetails.mockResolvedValue({ ...LOOKED_UP, author: '', narrator: '' });

    await createRequestForUser(USER, { asin: ASIN, title: 'Book Title (Old Edition)', author: 'Book Author', narrator: 'Book Narrator' });

    expect(prismaMock.audiobook.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ title: 'Book Title', author: 'Book Author', narrator: 'Book Narrator' }),
    });
  });

  it('a value that is not ASIN-shaped gets no lookup; the request values are used and the request still works', async () => {
    prismaMock.audiobook.findFirst.mockResolvedValue(null);
    audibleServiceMock.getAudiobookDetails.mockResolvedValue(LOOKED_UP);

    const result = await createRequestForUser(USER, { asin: 'B0SHORT', title: 'Book Title (Old Edition)', author: 'Another Author' });

    expect(result.success).toBe(true);
    expect(audibleServiceMock.getAudiobookDetails).not.toHaveBeenCalled();
    expect(prismaMock.audiobook.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ audibleAsin: 'B0SHORT', title: 'Book Title (Old Edition)', author: 'Another Author' }),
    });
  });

  it('a failed lookup never blocks the request', async () => {
    prismaMock.audiobook.findFirst.mockResolvedValue(null);
    audibleServiceMock.getAudiobookDetails.mockRejectedValue(new Error('offline'));

    const result = await createRequestForUser(USER, { asin: ASIN, title: 'Book Title', author: 'Book Author' });

    expect(result.success).toBe(true);
    expect(prismaMock.audiobook.create).toHaveBeenCalledWith({ data: expect.objectContaining({ title: 'Book Title', author: 'Book Author' }) });
  });
});

describe('POST /api/requests', () => {
  it('a request for a saved book leaves its title and author as they are', async () => {
    prismaMock.audiobook.findFirst.mockResolvedValue(SAVED);
    state.body = { audiobook: { asin: ASIN, title: 'Book Title (Old Edition)', author: 'Another Author' } };

    const { POST } = await import('@/app/api/requests/route');
    const response = await POST({} as never);

    expect(response.status).toBe(201);
    expect(prismaMock.audiobook.update).not.toHaveBeenCalled();
    for (const [args] of prismaMock.audiobook.update.mock.calls) {
      expect(args.data).not.toHaveProperty('title');
      expect(args.data).not.toHaveProperty('author');
    }
  });

  it('a new book drops a cover sent from another host', async () => {
    prismaMock.audiobook.findFirst.mockResolvedValue(null);
    state.body = { audiobook: { asin: ASIN, title: 'Book Title', author: 'Book Author', coverArtUrl: OTHER_COVER } };

    const { POST } = await import('@/app/api/requests/route');
    const response = await POST({} as never);

    expect(response.status).toBe(201);
    expect(prismaMock.audiobook.create).toHaveBeenCalledWith({ data: expect.objectContaining({ coverArtUrl: undefined }) });
  });
});

describe('createRequestForUser: the cover of a user request', () => {
  it('a new book takes the looked-up cover over the sent one', async () => {
    prismaMock.audiobook.findFirst.mockResolvedValue(null);
    audibleServiceMock.getAudiobookDetails.mockResolvedValue({ ...LOOKED_UP, coverArtUrl: LOOKED_UP_COVER });

    await createRequestForUser(USER, { asin: ASIN, title: 'Book Title', author: 'Book Author', coverArtUrl: AUDIBLE_COVER });

    expect(prismaMock.audiobook.create).toHaveBeenCalledWith({ data: expect.objectContaining({ coverArtUrl: LOOKED_UP_COVER }) });
  });

  it.each([AUDIBLE_COVER, CACHED_COVER])('a new book keeps a sent cover %s when the lookup has none', async (sent) => {
    prismaMock.audiobook.findFirst.mockResolvedValue(null);
    audibleServiceMock.getAudiobookDetails.mockResolvedValue(LOOKED_UP);

    await createRequestForUser(USER, { asin: ASIN, title: 'Book Title', author: 'Book Author', coverArtUrl: sent });

    expect(prismaMock.audiobook.create).toHaveBeenCalledWith({ data: expect.objectContaining({ coverArtUrl: sent }) });
  });

  it.each([OTHER_COVER, 'http://m.media-amazon.com/images/I/sent._SL500_.jpg'])('a new book drops a sent cover %s', async (sent) => {
    prismaMock.audiobook.findFirst.mockResolvedValue(null);
    audibleServiceMock.getAudiobookDetails.mockResolvedValue(LOOKED_UP);

    await createRequestForUser(USER, { asin: ASIN, title: 'Book Title', author: 'Book Author', coverArtUrl: sent });

    expect(prismaMock.audiobook.create).toHaveBeenCalledWith({ data: expect.objectContaining({ coverArtUrl: undefined }) });
  });

  it('a saved book with no cover is not given one from another host', async () => {
    prismaMock.audiobook.findFirst.mockResolvedValue(SAVED);

    await createRequestForUser(USER, { asin: ASIN, title: 'Book Title', author: 'Book Author', coverArtUrl: OTHER_COVER });

    expect(prismaMock.audiobook.update).not.toHaveBeenCalled();
  });

  it('a saved book with no cover gets the looked-up one', async () => {
    prismaMock.audiobook.findFirst.mockResolvedValue(SAVED);
    audibleServiceMock.getAudiobookDetails.mockResolvedValue({ ...LOOKED_UP, coverArtUrl: LOOKED_UP_COVER });

    await createRequestForUser(USER, { asin: ASIN, title: 'Book Title', author: 'Book Author', coverArtUrl: OTHER_COVER });

    expect(prismaMock.audiobook.update).toHaveBeenCalledWith({ where: { id: 'book-1' }, data: { coverArtUrl: LOOKED_UP_COVER } });
  });

  it('a saved book keeps the cover it has', async () => {
    prismaMock.audiobook.findFirst.mockResolvedValue({ ...SAVED, coverArtUrl: AUDIBLE_COVER });
    audibleServiceMock.getAudiobookDetails.mockResolvedValue({ ...LOOKED_UP, coverArtUrl: LOOKED_UP_COVER });

    await createRequestForUser(USER, { asin: ASIN, title: 'Book Title', author: 'Book Author', coverArtUrl: AUDIBLE_COVER });

    expect(prismaMock.audiobook.update).not.toHaveBeenCalled();
  });
});

describe('createRequestForUser: the cover from shelf sync and watched lists (automatic)', () => {
  it('a new book stores the cover the caller found, as before', async () => {
    prismaMock.audiobook.findFirst.mockResolvedValue(null);
    audibleServiceMock.getAudiobookDetails.mockResolvedValue({ ...LOOKED_UP, coverArtUrl: LOOKED_UP_COVER });

    await createRequestForUser(USER, { asin: ASIN, title: 'Book Title', author: 'Book Author', coverArtUrl: OTHER_COVER }, { automatic: true });

    expect(prismaMock.audiobook.create).toHaveBeenCalledWith({ data: expect.objectContaining({ coverArtUrl: OTHER_COVER }) });
  });

  it('a saved book with a cover the library cannot use still gets the Audible one the caller found', async () => {
    prismaMock.audiobook.findFirst.mockResolvedValue({ ...SAVED, coverArtUrl: OTHER_COVER });

    await createRequestForUser(USER, { asin: ASIN, title: 'Book Title', author: 'Book Author', coverArtUrl: AUDIBLE_COVER }, { automatic: true });

    expect(prismaMock.audiobook.update).toHaveBeenCalledWith({ where: { id: 'book-1' }, data: { coverArtUrl: AUDIBLE_COVER } });
  });
});
