/**
 * Component: Automatic re-request rules (shelf sync, watched authors and series)
 * Documentation: documentation/admin-features/release-blocklist.md
 *
 * Automatic callers pass `automatic: true` to createRequestForUser. When the
 * user already has a failed/warn/cancelled request for the book, this decides
 * whether the automatic caller may replace it:
 *   - cancelled: never (the user or an admin cancelled it; a manual request still can)
 *   - failed/warn with a block added during this attempt: now, count unchanged
 *     (the next search skips that release, and the blocklist bounds the retries)
 *   - failed/warn with no new block: after a growing wait from the failure
 *     (`updatedAt`): 1, 3, 7, 14, then every 30 days; count + 1
 * User requests and in-place user retries never come here and reset the count to 0.
 * A book removed from the library (#214) is never requested automatically, for any
 * user, while its "Removed from library" failed request stands: removedFromLibrarySkip().
 */

import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { REMOVED_FROM_LIBRARY_MESSAGE } from '@/lib/constants/request-statuses';

const logger = RMABLogger.create('AutoReRequest');

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days to wait before automatic retry n+1 of a failure that added no block; the last value repeats. */
export const AUTO_REREQUEST_WAIT_DAYS = [1, 3, 7, 14, 30] as const;

/** Wait in days after `retries` automatic retries so far. */
export function autoReRequestWaitDays(retries: number): number {
  const step = Math.min(Math.max(retries, 0), AUTO_REREQUEST_WAIT_DAYS.length - 1);
  return AUTO_REREQUEST_WAIT_DAYS[step];
}

/** The user's existing failed/warn/cancelled request for the book. */
export interface AutoReRequestCandidate {
  id: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  autoRerequestCount: number;
}

/** A skip, shaped so createRequestForUser can return it as is. */
export interface AutoReRequestSkip {
  success: false;
  reason: 'cancelled_by_user' | 'retry_not_due' | 'removed_from_library';
  message: string;
}

/** Go-ahead: the count the new request starts with, and the info line to log once it is created. */
export interface AutoReRequestGo {
  skip: null;
  nextCount: number;
  logLine: string;
}

export type AutoReRequestDecision = { skip: AutoReRequestSkip; nextCount?: never; logLine?: never } | AutoReRequestGo;

function goLine(existing: AutoReRequestCandidate, title: string, nextCount: number, why: string): string {
  return `Re-requested ${existing.status} request ${existing.id} ("${title}") automatically (${why}); ` +
    `if it fails again with no new block, the next automatic retry waits ${autoReRequestWaitDays(nextCount)} days`;
}

/**
 * Decide whether an automatic caller may replace `existing`, and with which
 * `autoRerequestCount` the new request starts. Logs only at debug; the caller
 * logs `logLine` at info once the replacement is actually created.
 */
export async function decideAutoReRequest(
  existing: AutoReRequestCandidate,
  title: string,
  now: Date = new Date()
): Promise<AutoReRequestDecision> {
  if (existing.status === 'cancelled') {
    logger.debug(`Not re-requesting cancelled request ${existing.id} ("${title}") automatically`);
    return {
      skip: {
        success: false,
        reason: 'cancelled_by_user',
        message: 'This request was cancelled; only a manual request replaces it',
      },
    };
  }

  const retries = existing.autoRerequestCount ?? 0;

  // Blocks carried over from earlier requests keep their createdAt, so only
  // blocks written during this attempt are on or after the request's createdAt
  const newBlocks = await prisma.blockedRelease.count({
    where: { requestId: existing.id, createdAt: { gte: existing.createdAt } },
  });
  if (newBlocks > 0) {
    return { skip: null, nextCount: retries, logLine: goLine(existing, title, retries, 'a release was blocked, so at once') };
  }

  const dueAt = new Date(existing.updatedAt.getTime() + autoReRequestWaitDays(retries) * DAY_MS);
  if (now < dueAt) {
    logger.debug(
      `Not re-requesting ${existing.status} request ${existing.id} ("${title}") automatically until ${dueAt.toISOString()} (automatic retry ${retries + 1})`
    );
    return {
      skip: {
        success: false,
        reason: 'retry_not_due',
        message: `Automatic retry ${retries + 1} is due ${dueAt.toISOString()}`,
      },
    };
  }

  logger.debug(`Automatic retry ${retries + 1} of ${existing.status} request ${existing.id} ("${title}") is due`);
  return { skip: null, nextCount: retries + 1, logLine: goLine(existing, title, retries + 1, `retry ${retries + 1}`) };
}

/**
 * Skip for automatic callers while any user's request for the book stands failed
 * by the library scan as removed from the library (#214); null otherwise. Only a
 * manual request brings the book back (the owner's replaces that failed request).
 */
export async function removedFromLibrarySkip(asin: string): Promise<AutoReRequestSkip | null> {
  const removed = await prisma.request.findFirst({
    where: {
      audiobook: { audibleAsin: asin },
      type: 'audiobook',
      status: 'failed',
      errorMessage: REMOVED_FROM_LIBRARY_MESSAGE,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!removed) return null;
  logger.debug(`Not requesting ASIN ${asin} automatically: request ${removed.id} failed as removed from the library`);
  return {
    success: false,
    reason: 'removed_from_library',
    message: 'This audiobook was removed from the library; only a manual request brings it back',
  };
}
