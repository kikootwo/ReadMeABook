/**
 * Component: Re-request (replace a failed request, keeping its blocklist)
 * Documentation: documentation/admin-features/release-blocklist.md
 *
 * A failed/warn/cancelled request can be requested again (user re-request,
 * shelf sync, watched lists, interactive pick). The old request is replaced
 * in one transaction:
 *   1. create the new request
 *   2. move the old request's BlockedRelease rows to it (same row ids)
 *   3. delete the old request, guarded by its re-requestable status
 * The old request used to be deleted first, and its blocklist cascaded away
 * with it, so the new request grabbed the same dead release again (#312).
 * When step 3 deletes nothing, another caller replaced it first: the
 * transaction rolls back (no second request) and RequestAlreadyReplacedError
 * is thrown. Callers do every read and early return before, and queue jobs
 * and notifications only after this resolves (after commit).
 */

import { prisma } from '@/lib/db';
import type { Prisma } from '@/generated/prisma';

/** Request statuses that may be replaced by a new request for the same user and book. */
export const RE_REQUESTABLE_STATUSES = ['failed', 'warn', 'cancelled'];

export class RequestAlreadyReplacedError extends Error {
  constructor(public readonly requestId: string) {
    super(`Request ${requestId} was already replaced by another re-request`);
    this.name = 'RequestAlreadyReplacedError';
  }
}

/**
 * Create a request; with `replacesRequestId`, atomically replace that
 * failed/warn/cancelled request, carrying its blocklist over.
 */
export async function createRequestReplacing<A extends Prisma.RequestCreateArgs>(
  args: Prisma.SelectSubset<A, Prisma.RequestCreateArgs>,
  replacesRequestId: string | null
): Promise<Prisma.RequestGetPayload<A>> {
  if (!replacesRequestId) {
    return prisma.request.create(args) as unknown as Promise<Prisma.RequestGetPayload<A>>;
  }

  return prisma.$transaction(async (tx) => {
    const created = await tx.request.create(args);
    await tx.blockedRelease.updateMany({
      where: { requestId: replacesRequestId },
      data: { requestId: created.id },
    });
    const removed = await tx.request.deleteMany({
      where: { id: replacesRequestId, status: { in: RE_REQUESTABLE_STATUSES }, deletedAt: null },
    });
    if (removed.count === 0) {
      // Throwing rolls the transaction back: the new request and the moved rows are undone
      throw new RequestAlreadyReplacedError(replacesRequestId);
    }
    return created;
  }) as unknown as Promise<Prisma.RequestGetPayload<A>>;
}
