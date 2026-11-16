/**
 * Component: Reported Issue Report Tests (book details of a new book record)
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * Reporting a library book RMAB has no record of creates one: its title and author come from
 * the Audible lookup, and the sent values are used only when the lookup has none (a sent cover
 * only on an Audible image host). A saved book keeps its title and author.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = { ...createPrismaMock(), reportedIssue: { findFirst: vi.fn(), create: vi.fn() } };
const audibleServiceMock = vi.hoisted(() => ({ getAudiobookDetails: vi.fn() }));
const jobQueueMock = vi.hoisted(() => ({ addNotificationJob: vi.fn() }));
const findPlexMatchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));
vi.mock('@/lib/utils/audiobook-matcher', () => ({ findPlexMatch: findPlexMatchMock }));
vi.mock('@/lib/integrations/audible.service', () => ({ getAudibleService: () => audibleServiceMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));

const { reportIssue } = await import('@/lib/services/reported-issue.service');

const ASIN = 'B0REPORT01';
const LOOKED_UP_COVER = 'https://m.media-amazon.com/images/I/lookedup._SL500_.jpg';
const AUDIBLE_COVER = 'https://m.media-amazon.com/images/I/sent._SL500_.jpg';
const OTHER_COVER = 'https://example.com/cover.jpg';

beforeEach(() => {
  vi.clearAllMocks();
  findPlexMatchMock.mockResolvedValue({ plexGuid: 'item-1' });
  audibleServiceMock.getAudiobookDetails.mockResolvedValue(null);
  prismaMock.audiobook.findFirst.mockResolvedValue(null);
  prismaMock.audiobook.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'book-1', ...data }));
  prismaMock.reportedIssue.findFirst.mockResolvedValue(null);
  prismaMock.reportedIssue.create.mockResolvedValue({ id: 'issue-1', reporter: { plexUsername: 'u' } });
  jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
});

describe('reportIssue: a book without a record', () => {
  it('is saved with the looked-up title and author', async () => {
    audibleServiceMock.getAudiobookDetails.mockResolvedValue({ asin: ASIN, title: 'Book Title', author: 'Book Author' });

    await reportIssue(ASIN, 'user-1', 'Audio skips', { title: 'Book Title (Old Edition)', author: 'Another Author' });

    expect(audibleServiceMock.getAudiobookDetails).toHaveBeenCalledWith(ASIN, { fillSeries: false });
    expect(prismaMock.audiobook.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ audibleAsin: ASIN, title: 'Book Title', author: 'Book Author' }),
    });
  });

  it('uses the sent title and author when the lookup finds nothing or fails', async () => {
    audibleServiceMock.getAudiobookDetails.mockRejectedValue(new Error('offline'));

    await reportIssue(ASIN, 'user-1', 'Audio skips', { title: 'Book Title', author: 'Book Author' });

    expect(prismaMock.audiobook.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ title: 'Book Title', author: 'Book Author' }),
    });
  });

  it('keeps the placeholders when neither has a value', async () => {
    await reportIssue(ASIN, 'user-1', 'Audio skips');

    expect(prismaMock.audiobook.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ title: 'Unknown Title', author: 'Unknown Author' }),
    });
  });
});

describe('reportIssue: a saved book', () => {
  it('is linked as it is, with no lookup and no write to its details', async () => {
    prismaMock.audiobook.findFirst.mockResolvedValue({ id: 'book-1', audibleAsin: ASIN, title: 'Book Title', author: 'Book Author' });

    await reportIssue(ASIN, 'user-1', 'Audio skips', { title: 'Book Title (Old Edition)', author: 'Another Author' });

    expect(audibleServiceMock.getAudiobookDetails).not.toHaveBeenCalled();
    expect(prismaMock.audiobook.create).not.toHaveBeenCalled();
    expect(prismaMock.audiobook.update).not.toHaveBeenCalled();
    expect(prismaMock.reportedIssue.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ audiobookId: 'book-1' }) }));
  });
});

describe('reportIssue: the cover of a new book record', () => {
  it('takes the looked-up cover over the sent one', async () => {
    audibleServiceMock.getAudiobookDetails.mockResolvedValue({ asin: ASIN, title: 'Book Title', author: 'Book Author', coverArtUrl: LOOKED_UP_COVER });

    await reportIssue(ASIN, 'user-1', 'Audio skips', { title: 'Book Title', author: 'Book Author', coverArtUrl: AUDIBLE_COVER });

    expect(prismaMock.audiobook.create).toHaveBeenCalledWith({ data: expect.objectContaining({ coverArtUrl: LOOKED_UP_COVER }) });
  });

  it('keeps a sent Audible cover when the lookup has none', async () => {
    await reportIssue(ASIN, 'user-1', 'Audio skips', { title: 'Book Title', author: 'Book Author', coverArtUrl: AUDIBLE_COVER });

    expect(prismaMock.audiobook.create).toHaveBeenCalledWith({ data: expect.objectContaining({ coverArtUrl: AUDIBLE_COVER }) });
  });

  it('drops a cover sent from another host', async () => {
    await reportIssue(ASIN, 'user-1', 'Audio skips', { title: 'Book Title', author: 'Book Author', coverArtUrl: OTHER_COVER });

    expect(prismaMock.audiobook.create).toHaveBeenCalledWith({ data: expect.objectContaining({ coverArtUrl: undefined }) });
  });
});
