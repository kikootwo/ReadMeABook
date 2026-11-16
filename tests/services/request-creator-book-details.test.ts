/**
 * Component: Request Creator Book Details Tests (title and author come from the looked-up metadata)
 * Documentation: documentation/backend/services/goodreads-sync.md
 *
 * createRequestForUser and POST /api/requests: a new book takes its title and author from the
 * Audible lookup (Audnexus, then the catalog) and uses the request's values only when the lookup
 * has none; an existing book's saved title and author change only to looked-up values.
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
    for (const [args] of prismaMock.audiobook.update.mock.calls) {
      expect(args.data).not.toHaveProperty('title');
      expect(args.data).not.toHaveProperty('author');
    }
  });
});
