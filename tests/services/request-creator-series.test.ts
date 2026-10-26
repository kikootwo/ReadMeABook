/**
 * Component: Request Creator Series Tests (a request stores the series Audnexus lacks)
 * Documentation: documentation/integrations/audible.md
 *
 * createRequestForUser with the real Audible service (axios mocked): Audnexus answers
 * without seriesPrimary, the Audible catalog has the series.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const htmlClientMock = vi.hoisted(() => ({ get: vi.fn() }));
const apiClientMock = vi.hoisted(() => ({ get: vi.fn() }));
const axiosMock = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn() }));

vi.mock('axios', () => ({ default: axiosMock, ...axiosMock }));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));
vi.mock('@/lib/utils/audiobook-matcher', () => ({ findPlexMatch: vi.fn().mockResolvedValue(null) }));
const jobQueue = vi.hoisted(() => ({ addSearchJob: vi.fn(), addNotificationJob: vi.fn() }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueue }));
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({ get: vi.fn(async () => null), getAudibleRegion: vi.fn(async () => 'us') }),
}));
vi.mock('@/lib/services/works.service', () => ({
  getSiblingAsins: vi.fn(async () => new Map()),
  seedAsin: vi.fn(async () => undefined),
}));

type CreateRequestForUser = typeof import('@/lib/services/request-creator.service').createRequestForUser;
/** Re-imported per test: a fresh Audible service (no series cache or pause carried over). */
let createRequestForUser: CreateRequestForUser;

const USER = 'user-1';

/** Audnexus knows the book but has no seriesPrimary; the catalog lists its series. */
function audibleServes(asin: string, catalog: 'series' | 'fails') {
  axiosMock.get.mockResolvedValue({
    data: { asin, title: 'Synthetic Second Book', authors: [{ name: 'Synthetic Author' }], releaseDate: '2026-10-21T00:00:00.000Z' },
  });
  if (catalog === 'fails') {
    apiClientMock.get.mockRejectedValue(Object.assign(new Error('Service Unavailable'), { response: { status: 503 } }));
  } else {
    apiClientMock.get.mockResolvedValue({
      data: { product: { asin, title: 'Synthetic Second Book', series: [{ asin: 'SER0000001', title: 'Synthetic Saga', sequence: '2' }] } },
    });
  }
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  ({ createRequestForUser } = await import('@/lib/services/request-creator.service'));
  axiosMock.get.mockReset();
  apiClientMock.get.mockReset();
  axiosMock.create.mockReset();
  axiosMock.create.mockReturnValueOnce(htmlClientMock).mockReturnValueOnce(apiClientMock);
  prismaMock.request.findFirst.mockResolvedValue(null);
  prismaMock.request.create.mockResolvedValue({ id: 'req-1', audiobook: { id: 'book-1' }, user: { id: USER } });
  prismaMock.ignoredAudiobook.findUnique.mockResolvedValue(null);
  prismaMock.ignoredAudiobook.findFirst.mockResolvedValue(null);
  prismaMock.user.findUnique.mockResolvedValue({ role: 'user', autoApproveRequests: true, plexUsername: 'u' });
  prismaMock.audiobook.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'book-1', ...data }));
  prismaMock.audiobook.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'book-1', ...data }));
  jobQueue.addSearchJob.mockResolvedValue(undefined);
  jobQueue.addNotificationJob.mockResolvedValue(undefined);
});

describe('createRequestForUser stores the series from the Audible catalog', () => {
  it('a new book is created with series, part and series ASIN', async () => {
    audibleServes('B0REQS0001', 'series');
    prismaMock.audiobook.findFirst.mockResolvedValue(null);

    const result = await createRequestForUser(USER, { asin: 'B0REQS0001', title: 'Synthetic Second Book', author: 'Synthetic Author' });

    expect(result.success).toBe(true);
    expect(prismaMock.audiobook.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ audibleAsin: 'B0REQS0001', series: 'Synthetic Saga', seriesPart: '2', seriesAsin: 'SER0000001', year: 2026 }),
    });
  });

  it('an existing book without a series is updated with it', async () => {
    audibleServes('B0REQS0002', 'series');
    prismaMock.audiobook.findFirst.mockResolvedValue({
      id: 'book-1', audibleAsin: 'B0REQS0002', title: 'Synthetic Second Book', author: 'Synthetic Author', narrator: null,
      coverArtUrl: null, series: null, seriesPart: null, seriesAsin: null,
    });

    const result = await createRequestForUser(USER, { asin: 'B0REQS0002', title: 'Synthetic Second Book', author: 'Synthetic Author' });

    expect(result.success).toBe(true);
    expect(prismaMock.audiobook.update).toHaveBeenCalledWith({
      where: { id: 'book-1' },
      data: expect.objectContaining({ series: 'Synthetic Saga', seriesPart: '2', seriesAsin: 'SER0000001' }),
    });
  });

  it('a failing catalog never blocks the request; the series stays empty', async () => {
    audibleServes('B0REQS0003', 'fails');
    prismaMock.audiobook.findFirst.mockResolvedValue(null);

    const result = await createRequestForUser(USER, { asin: 'B0REQS0003', title: 'Synthetic Second Book', author: 'Synthetic Author' });

    expect(result.success).toBe(true);
    const { data } = prismaMock.audiobook.create.mock.calls[0][0];
    expect(data).toMatchObject({ audibleAsin: 'B0REQS0003', year: 2026 });
    expect(data.series).toBeUndefined();
    expect(data.seriesAsin).toBeUndefined();
  });
});
