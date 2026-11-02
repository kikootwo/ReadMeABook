/**
 * Component: Request Stop Guard
 * Documentation: documentation/backend/services/jobs.md
 *
 * A user can cancel (or delete) a request while a background job is working
 * on it. The guarded jobs must then stop: never import the download and never
 * flip the request back to 'failed', 'searching', 'downloading' or 'processing'.
 */

import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '../db';

export type RequestStopReason = 'cancelled' | 'deleted' | 'missing';

/**
 * Why background work for this request must stop, or null to carry on.
 * A row that no longer exists (or no id at all) counts as stopped.
 */
export async function getRequestStopReason(requestId: string | null | undefined): Promise<RequestStopReason | null> {
  if (!requestId) return 'missing';

  const request = await prisma.request.findUnique({
    where: { id: requestId },
    select: { status: true, deletedAt: true },
  });

  if (!request) return 'missing';
  if (request.deletedAt) return 'deleted';
  if (request.status === 'cancelled') return 'cancelled';
  return null;
}

/**
 * Update the request in one conditional write that skips cancelled and
 * deleted requests, so a cancel landing at the same moment is never
 * overwritten. Returns true when the request was written.
 *
 * Without an id this writes nothing: Prisma's updateMany treats
 * `id: undefined` as "no filter" and would update every live request.
 */
export async function updateRequestUnlessStopped(
  requestId: string | null | undefined,
  data: Prisma.RequestUpdateManyMutationInput
): Promise<boolean> {
  if (!requestId) return false;

  const { count } = await prisma.request.updateMany({
    where: { id: requestId, deletedAt: null, status: { not: 'cancelled' } },
    data: { ...data, updatedAt: new Date() },
  });
  return count > 0;
}

/** Mark the request failed unless it was cancelled or deleted. */
export function markRequestFailedUnlessStopped(
  requestId: string | null | undefined,
  errorMessage: string
): Promise<boolean> {
  return updateRequestUnlessStopped(requestId, { status: 'failed', errorMessage });
}
