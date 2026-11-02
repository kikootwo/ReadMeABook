/**
 * Component: Request Cancel Service Tests
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * Fails on main: the cancel wrote `status` by id (overwriting a status that moved on) and never
 * touched the download.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@/generated/prisma/client';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const jobQueueMock = vi.hoisted(() => ({ addNotificationJob: vi.fn() }));
const stepMock = vi.hoisted(() => ({ handleCancelledDownload: vi.fn(), newestSelectedRow: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/services/cancelled-download', () => stepMock);

const record = (status = 'downloading') => ({
  id: 'req-1', status, audiobookId: 'ab-1', type: 'audiobook',
  audiobook: { title: 'Book', author: 'Author' }, user: { plexUsername: 'reader' },
});

beforeEach(() => {
  vi.clearAllMocks();
  jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
  stepMock.newestSelectedRow.mockResolvedValue({ id: 'dh-1' });
  stepMock.handleCancelledDownload.mockResolvedValue({ outcome: 'removed', clientName: 'qBittorrent', detail: 'partial' });
});

async function cancel(rec = record(), audience: 'admin' | 'owner' = 'admin') {
  const { cancelLoadedRequest } = await import('@/lib/services/request-cancel.service');
  return cancelLoadedRequest(rec, { audience });
}

describe('cancelLoadedRequest', () => {
  it('flips only from the status it read, sets cancelledAt, then runs the download step', async () => {
    const order: string[] = [];
    prismaMock.request.updateMany.mockImplementationOnce(async () => { order.push('flip'); return { count: 1 }; });
    stepMock.handleCancelledDownload.mockImplementationOnce(async () => { order.push('client'); return { outcome: 'removed', clientName: 'qBittorrent', detail: '' }; });

    const res = await cancel();

    expect(prismaMock.request.updateMany).toHaveBeenCalledWith({
      where: { id: 'req-1', deletedAt: null, status: 'downloading' },
      data: { status: 'cancelled', cancelledAt: expect.any(Date), updatedAt: expect.any(Date) },
    });
    expect(order).toEqual(['flip', 'client']);
    expect(res).toMatchObject({ success: true, download: 'removed', request: { id: 'req-1', status: 'cancelled', cancelledAt: expect.any(Date) } });
    expect(res.success && res.message).toBe('Request cancelled. Its download was removed from qBittorrent.');
    expect(jobQueueMock.addNotificationJob).toHaveBeenCalledWith('request_cancelled', 'req-1', 'Book', 'Author', 'reader');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('clears the pre-selected torrent only when withdrawing an awaiting_approval request', async () => {
    prismaMock.request.updateMany.mockResolvedValue({ count: 1 });
    await cancel(record('awaiting_approval'));
    expect(prismaMock.request.updateMany.mock.calls[0][0].data.selectedTorrent).toBe(Prisma.DbNull);
    await cancel(record('searching'));
    expect(prismaMock.request.updateMany.mock.calls[1][0].data).not.toHaveProperty('selectedTorrent');
  });

  it('a status that moved on (downloading -> processing) is not cancelled: no client call', async () => {
    prismaMock.request.updateMany.mockResolvedValueOnce({ count: 0 });
    prismaMock.request.findFirst.mockResolvedValueOnce({ status: 'processing' });

    expect(await cancel()).toEqual({ success: false, reason: 'not_cancellable', status: 'processing' });
    expect(stepMock.handleCancelledDownload).not.toHaveBeenCalled();
    expect(jobQueueMock.addNotificationJob).not.toHaveBeenCalled();
  });

  it('a non-cancellable status is refused without a write', async () => {
    expect(await cancel(record('available'))).toEqual({ success: false, reason: 'not_cancellable', status: 'available' });
    expect(prismaMock.request.updateMany).not.toHaveBeenCalled();
  });

  it('a second cancel of a cancelled request succeeds without doing anything again', async () => {
    prismaMock.request.findFirst.mockResolvedValueOnce({ cancelledAt: new Date('2026-11-01T00:00:00Z') });
    const res = await cancel(record('cancelled'));
    expect(res).toMatchObject({ success: true, alreadyCancelled: true, download: 'none', message: 'This request was already cancelled.' });
    expect(prismaMock.request.updateMany).not.toHaveBeenCalled();
    expect(stepMock.handleCancelledDownload).not.toHaveBeenCalled();
  });

  it('two cancels at once: one flips and runs the step, the other gets the idempotent answer', async () => {
    let flipped = false;
    prismaMock.request.updateMany.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5));
      if (flipped) return { count: 0 };
      flipped = true;
      return { count: 1 };
    });
    prismaMock.request.findFirst.mockImplementation(async (args: any) =>
      (args.select.status ? { status: 'cancelled' } : { cancelledAt: new Date() }));

    const [a, b] = await Promise.all([cancel(), cancel()]);

    expect([a, b].filter((r) => r.success && !r.alreadyCancelled)).toHaveLength(1);
    expect([a, b].filter((r) => r.success && r.alreadyCancelled)).toHaveLength(1);
    expect(stepMock.handleCancelledDownload).toHaveBeenCalledTimes(1);
    expect(jobQueueMock.addNotificationJob).toHaveBeenCalledTimes(1);
  });

  it('a request deleted between the read and the flip is not found', async () => {
    prismaMock.request.updateMany.mockResolvedValueOnce({ count: 0 });
    prismaMock.request.findFirst.mockResolvedValueOnce(null);
    expect(await cancel()).toEqual({ success: false, reason: 'not_found' });
  });

  it('a notification failure does not fail the cancel', async () => {
    prismaMock.request.updateMany.mockResolvedValueOnce({ count: 1 });
    jobQueueMock.addNotificationJob.mockRejectedValueOnce(new Error('redis down'));
    expect((await cancel()).success).toBe(true);
  });
});

describe('cancelMessage', () => {
  it.each([
    'removed', 'kept_seeding', 'kept_unlimited', 'kept_shared', 'kept_not_owned', 'kept_finished', 'retry_later', 'not_removed', 'none',
  ] as const)('owner message for %s never names the client or another request', async (outcome) => {
    const { cancelMessage } = await import('@/lib/services/request-cancel.service');
    const message = cancelMessage(outcome, 'owner', 'qBittorrent');
    expect(message).not.toMatch(/qBittorrent|another request|30 minutes/i);
    expect(message.startsWith('Request cancelled.')).toBe(true);
  });

  it('admin messages name the client; retry says "next seeding cleanup"; usenet errors promise no retry', async () => {
    const { cancelMessage } = await import('@/lib/services/request-cancel.service');
    expect(cancelMessage('kept_shared', 'admin', 'qBittorrent')).toBe('Request cancelled. Its download stays in qBittorrent: another request still uses it.');
    expect(cancelMessage('retry_later', 'admin', 'qBittorrent')).toMatch(/on its next seeding cleanup\.$/);
    expect(cancelMessage('not_removed', 'admin', 'NZBGet')).not.toMatch(/again|retry|later/i);
    expect(cancelMessage('not_removed', 'owner')).not.toMatch(/again|retry|later/i);
  });
});
