/**
 * Component: Request Stop Guard Tests
 * Documentation: documentation/backend/services/jobs.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

describe('request stop guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.request.updateMany.mockResolvedValue({ count: 1 });
  });

  it.each([undefined, null, ''])('writes nothing and returns false without a request id (%s)', async (requestId) => {
    // updateMany with `id: undefined` drops the filter and would fail every live request
    const { markRequestFailedUnlessStopped, updateRequestUnlessStopped } = await import('@/lib/utils/request-stop-guard');

    await expect(markRequestFailedUnlessStopped(requestId, 'boom')).resolves.toBe(false);
    await expect(updateRequestUnlessStopped(requestId, { status: 'processing' })).resolves.toBe(false);
    expect(prismaMock.request.updateMany).not.toHaveBeenCalled();
  });

  it('treats a missing request id as stopped without reading the database', async () => {
    const { getRequestStopReason } = await import('@/lib/utils/request-stop-guard');

    await expect(getRequestStopReason(undefined)).resolves.toBe('missing');
    await expect(getRequestStopReason('')).resolves.toBe('missing');
    expect(prismaMock.request.findUnique).not.toHaveBeenCalled();
  });

  it('writes failed with one conditional update that skips cancelled and deleted requests', async () => {
    const { markRequestFailedUnlessStopped } = await import('@/lib/utils/request-stop-guard');

    await expect(markRequestFailedUnlessStopped('req-1', 'boom')).resolves.toBe(true);
    expect(prismaMock.request.updateMany).toHaveBeenCalledWith({
      where: { id: 'req-1', deletedAt: null, status: { not: 'cancelled' } },
      data: { status: 'failed', errorMessage: 'boom', updatedAt: expect.any(Date) },
    });
  });

  it('returns false when the conditional update matches no row', async () => {
    prismaMock.request.updateMany.mockResolvedValue({ count: 0 });
    const { markRequestFailedUnlessStopped } = await import('@/lib/utils/request-stop-guard');

    await expect(markRequestFailedUnlessStopped('req-1', 'boom')).resolves.toBe(false);
  });

  it.each([
    [{ status: 'cancelled', deletedAt: null }, 'cancelled'],
    [{ status: 'downloading', deletedAt: new Date() }, 'deleted'],
    [null, 'missing'],
    [{ status: 'downloading', deletedAt: null }, null],
  ])('reads %o as stop reason %s', async (row, expected) => {
    prismaMock.request.findUnique.mockResolvedValue(row);
    const { getRequestStopReason } = await import('@/lib/utils/request-stop-guard');

    await expect(getRequestStopReason('req-1')).resolves.toBe(expected);
  });
});
