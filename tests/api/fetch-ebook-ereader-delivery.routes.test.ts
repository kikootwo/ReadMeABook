/**
 * Component: Fetch E-book API Tests, e-reader delivery of an ebook already in the library
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Asking for an ebook that's already downloaded doesn't fetch it again, but it does email it to
 * the asking user's e-reader devices.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const queueEreaderDeliveryMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: vi.fn((_req: unknown, handler: (req: unknown) => unknown) => handler({ user: { id: 'reader-2', role: 'user' } })),
  requireAdmin: vi.fn((_req: unknown, handler: () => unknown) => handler()),
}));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => ({ addSearchEbookJob: vi.fn() }) }));
vi.mock('@/lib/services/ereader-delivery.service', () => ({
  DELIVERABLE_EBOOK_STATUSES: ['downloaded', 'available'],
  queueEreaderDelivery: queueEreaderDeliveryMock,
}));
vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => ({ getAudiobookDetails: vi.fn(async () => ({ title: 'Red Rising', author: 'Pierce Brown' })) }),
}));
vi.mock('@/lib/utils/audiobook-matcher', () => ({ findPlexMatch: vi.fn(async () => null) }));

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.configuration.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
    where.key === 'ebook_annas_archive_enabled' ? { key: where.key, value: 'true' } : null
  );
});

describe('POST /api/audiobooks/[asin]/fetch-ebook', () => {
  function existingEbook(status: string) {
    prismaMock.audiobook.findFirst.mockResolvedValue({ id: 'ab-1', title: 'Red Rising', author: 'Pierce Brown' });
    prismaMock.request.findFirst
      .mockResolvedValueOnce({ id: 'audiobook-req', status: 'available' }) // the audiobook is in the library
      .mockResolvedValueOnce({ id: 'ebook-req', status }); // someone already requested the ebook
  }

  it("emails an already-downloaded ebook to the asking user's devices", async () => {
    existingEbook('downloaded');
    const { POST } = await import('@/app/api/audiobooks/[asin]/fetch-ebook/route');

    const response = await POST({} as any, { params: Promise.resolve({ asin: 'B00ABCDEFG' }) });

    expect(response.status).toBe(409);
    expect(queueEreaderDeliveryMock).toHaveBeenCalledWith('ebook-req', expect.anything(), { userIds: ['reader-2'], delaySeconds: 0 });
  });

  it("doesn't send while the ebook is still being fetched", async () => {
    existingEbook('downloading');
    const { POST } = await import('@/app/api/audiobooks/[asin]/fetch-ebook/route');

    await POST({} as any, { params: Promise.resolve({ asin: 'B00ABCDEFG' }) });

    expect(queueEreaderDeliveryMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/requests/[id]/fetch-ebook', () => {
  it("emails an already-downloaded ebook to the request owner's devices", async () => {
    prismaMock.request.findFirst
      .mockResolvedValueOnce({ id: 'req-1', userId: 'owner-1', status: 'available', audiobook: { id: 'ab-1', title: 'Red Rising', author: 'Pierce Brown' } })
      .mockResolvedValueOnce({ id: 'ebook-req', status: 'downloaded' });
    const { POST } = await import('@/app/api/requests/[id]/fetch-ebook/route');

    const payload = await (await POST({} as any, { params: Promise.resolve({ id: 'req-1' }) })).json();

    expect(payload.success).toBe(false);
    expect(queueEreaderDeliveryMock).toHaveBeenCalledWith('ebook-req', expect.anything(), { userIds: ['owner-1'], delaySeconds: 0 });
  });
});
