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
 */

import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';

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
  reason: 'cancelled_by_user' | 'retry_not_due';
  message: string;
}

export type AutoReRequestDecision =
  | { skip: AutoReRequestSkip; nextCount?: never }
  | { skip: null; nextCount: number };

/**
 * Decide whether an automatic caller may replace `existing`, and with which
 * `autoRerequestCount` the new request starts.
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
    return { skip: null, nextCount: retries };
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

  logger.info(
    `Re-requesting ${existing.status} request ${existing.id} ("${title}") automatically: retry ${retries + 1}; ` +
    `if it fails again with no new block, the next retry waits ${autoReRequestWaitDays(retries + 1)} days`
  );
  return { skip: null, nextCount: retries + 1 };
}
