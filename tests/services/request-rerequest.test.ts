/**
 * Component: Re-request Tests (atomic replace keeps the blocklist)
 * Documentation: documentation/admin-features/release-blocklist.md
 *
 * $transaction runs the callback with a separate `tx` client and records
 * whether it committed (callback resolved) or rolled back (callback threw),
 * as Prisma's interactive transactions do. Writes must go through `tx`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const txMock = createPrismaMock();
const txState = vi.hoisted(() => ({ outcome: 'none' as 'none' | 'committed' | 'rolled back' }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

const { createRequestReplacing, RequestAlreadyReplacedError } = await import('@/lib/services/request-rerequest');

const args = { data: { userId: 'user-1', audiobookId: 'book-1', status: 'pending', type: 'audiobook', progress: 0 } };

beforeEach(() => {
  vi.clearAllMocks();
  txState.outcome = 'none';
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    try {
      const result = await fn(txMock);
      txState.outcome = 'committed';
      return result;
    } catch (error) {
      txState.outcome = 'rolled back';
      throw error;
    }
  });
  txMock.request.create.mockResolvedValue({ id: 'req-new' });
  txMock.blockedRelease.updateMany.mockResolvedValue({ count: 2 });
  txMock.request.deleteMany.mockResolvedValue({ count: 1 });
});

describe('createRequestReplacing', () => {
  it('creates a plain request (no transaction) when nothing is replaced', async () => {
    prismaMock.request.create.mockResolvedValue({ id: 'req-new' });

    expect(await createRequestReplacing(args, null)).toEqual({ id: 'req-new' });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('creates the new request, moves the blocklist rows to it, then deletes the old request (guarded), in one transaction', async () => {
    const created = await createRequestReplacing(args, 'req-old');

    expect(created).toEqual({ id: 'req-new' });
    expect(txMock.request.create).toHaveBeenCalledWith(args);
    expect(txMock.blockedRelease.updateMany).toHaveBeenCalledWith({ where: { requestId: 'req-old' }, data: { requestId: 'req-new' } });
    expect(txMock.request.deleteMany).toHaveBeenCalledWith({
      where: { id: 'req-old', status: { in: ['failed', 'warn', 'cancelled'] }, deletedAt: null },
    });
    // Order matters: deleting first would cascade the blocklist away
    const order = [txMock.request.create, txMock.blockedRelease.updateMany, txMock.request.deleteMany].map((m) => m.mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(prismaMock.request.create).not.toHaveBeenCalled();
    expect(prismaMock.request.delete).not.toHaveBeenCalled();
    expect(txState.outcome).toBe('committed');
  });

  it('throws inside the transaction (so it rolls back) when the guarded delete removes nothing', async () => {
    // What the database answers when another re-request already replaced the old request
    txMock.request.deleteMany.mockResolvedValue({ count: 0 });

    await expect(createRequestReplacing(args, 'req-old')).rejects.toBeInstanceOf(RequestAlreadyReplacedError);
    expect(txState.outcome).toBe('rolled back');
  });

  it('touches neither the blocklist nor the old request when creating the new one fails', async () => {
    txMock.request.create.mockRejectedValue(new Error('db error'));

    await expect(createRequestReplacing(args, 'req-old')).rejects.toThrow('db error');
    expect(txMock.blockedRelease.updateMany).not.toHaveBeenCalled();
    expect(txMock.request.deleteMany).not.toHaveBeenCalled();
    expect(txState.outcome).toBe('rolled back');
  });
});
