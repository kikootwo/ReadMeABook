/**
 * Component: Library access requests (a user asks for a book already in the library)
 * Documentation: documentation/features/requester-tags.md
 *
 * While requester tags are on (Audiobookshelf), a non-admin's manual request for a book already in
 * the library becomes an access request (`Request.accessRequest`) instead of being refused. It
 * follows the user's approval rule; approving it grants it without a search: the request becomes
 * `available` and the delivery step adds the user's `req:` tag, under #232's eligibility rules.
 * The library match step leaves an access request alone while it awaits approval.
 */

import { prisma } from '@/lib/db';
import { getConfigService } from '@/lib/services/config.service';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { findPlexMatch } from '@/lib/utils/audiobook-matcher';
import { RMABLogger } from '@/lib/utils/logger';
import { RE_REQUESTABLE_STATUSES } from '@/lib/services/request-rerequest';
import { AVAILABLE_DATA } from '@/lib/services/library/match-requests';
import { applyItemMarks, isRequesterTaggingOn } from '@/lib/services/audiobookshelf/requester-tags';
import { isExplicitMarkOn } from '@/lib/services/audiobookshelf/explicit-flag';
import { loadRequesterTagMap } from '@/lib/services/audiobookshelf/requester-tag-users';

const moduleLogger = RMABLogger.create('LibraryAccess');

const isAudiobookshelf = async () => (await getConfigService().get('system.backend_mode')) === 'audiobookshelf';

/** The caller's access state for a book in the library (search results); none = nothing to show. */
export type LibraryAccessState = 'request' | 'requested' | 'denied';

export type AccessRefusal = {
  success: false;
  reason: 'already_available' | 'access_unavailable';
  message: string;
};

export const ALREADY_AVAILABLE: AccessRefusal = {
  success: false,
  reason: 'already_available',
  message: 'This audiobook is already available in your library',
};

const ACCESS_UNAVAILABLE: AccessRefusal = {
  success: false,
  reason: 'access_unavailable',
  message: "This audiobook is already in the library, but your username can't be turned into a tag of its own, so access can't be requested here. Ask an admin for access.",
};

/** off: no access requests for this user (Plex, tagging off, admin, unknown user); no_tag: the user's name gives no tag of its own */
async function accessBlock(userId: string): Promise<'off' | 'no_tag' | null> {
  if (!(await isAudiobookshelf()) || !(await isRequesterTaggingOn())) return 'off';
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user || user.role === 'admin') return 'off';
  const map = await loadRequesterTagMap();
  return map.tagByUser.has(userId) ? null : 'no_tag';
}

/**
 * A manual request for a book already in the library: null = create an access request; otherwise
 * the refusal to return (the user already has the book, or access requests don't apply).
 */
export async function accessRequestRefusal(userId: string, asin: string): Promise<AccessRefusal | null> {
  const block = await accessBlock(userId);
  if (block === 'off') return ALREADY_AVAILABLE;
  const own = await prisma.request.findFirst({
    where: { userId, type: 'audiobook', status: 'available', deletedAt: null, audiobook: { audibleAsin: asin } },
    select: { id: true },
  });
  if (own) return ALREADY_AVAILABLE;
  return block === 'no_tag' ? ACCESS_UNAVAILABLE : null;
}

/**
 * Search results: the caller's access state per ASIN of the books in the library. Empty when
 * access requests don't apply to the caller. Never throws (a failure shows no access buttons).
 */
export async function libraryAccessStates(userId: string, asins: string[]): Promise<Map<string, LibraryAccessState>> {
  const states = new Map<string, LibraryAccessState>();
  if (asins.length === 0) return states;
  try {
    if ((await accessBlock(userId)) !== null) return states;
    const own = await prisma.request.findMany({
      where: { userId, type: 'audiobook', deletedAt: null, audiobook: { audibleAsin: { in: asins } } },
      select: { status: true, accessRequest: true, audiobook: { select: { audibleAsin: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const latest = new Map<string, (typeof own)[number]>();
    for (const r of own) if (r.audiobook.audibleAsin && !latest.has(r.audiobook.audibleAsin)) latest.set(r.audiobook.audibleAsin, r);
    for (const asin of asins) {
      const r = latest.get(asin);
      if (!r || RE_REQUESTABLE_STATUSES.includes(r.status)) states.set(asin, 'request');
      else if (r.accessRequest && r.status === 'awaiting_approval') states.set(asin, 'requested');
      else if (r.accessRequest && r.status === 'denied') states.set(asin, 'denied');
      // the user's own available request (they have the book) or any other request: nothing to offer
    }
  } catch (error) {
    moduleLogger.error(`Library access states not loaded: ${error instanceof Error ? error.message : String(error)}`);
    states.clear();
  }
  return states;
}

const GRANT_INCLUDE = { audiobook: true, user: { select: { id: true, plexUsername: true } } } as const;

export type GrantResult =
  | { granted: true; request: Record<string, unknown> }
  | { granted: false; reason: 'not_in_library' | 'changed' };

/**
 * Grants an access request that awaits approval (approval or auto-approval): compare-and-set to
 * `available` (approval record cleared), the book's library item id filled in when missing, the
 * `request_available` notification, then the delivery step for this book (Audiobookshelf), which
 * tags the requester. `not_in_library`: the book left the library, nothing changed.
 */
export async function grantLibraryAccess(requestId: string, logger: RMABLogger = moduleLogger): Promise<GrantResult> {
  const request = await prisma.request.findFirst({
    where: { id: requestId, deletedAt: null, accessRequest: true, status: 'awaiting_approval' },
    include: GRANT_INCLUDE,
  });
  if (!request) return { granted: false, reason: 'changed' };
  const book = request.audiobook;
  const match = await findPlexMatch({ asin: book.audibleAsin || '', title: book.title, author: book.author, narrator: book.narrator || undefined });
  if (!match) return { granted: false, reason: 'not_in_library' };

  const data = { ...AVAILABLE_DATA(), approvalBypassedBy: null };
  const { count } = await prisma.request.updateMany({ where: { id: requestId, status: 'awaiting_approval', deletedAt: null }, data });
  if (count !== 1) return { granted: false, reason: 'changed' };

  const abs = await isAudiobookshelf();
  const missingItem = abs ? !book.absItemId && { absItemId: match.plexGuid } : !book.plexGuid && { plexGuid: match.plexGuid };
  if (missingItem) {
    await prisma.audiobook.update({ where: { id: book.id }, data: missingItem }).catch((error) => {
      logger.error(`Library item id of book ${book.id} not saved: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
  const username = request.user.plexUsername || 'Unknown User';
  logger.info(`Granted ${username} access to "${book.title}" (already in the library)`);

  await getJobQueueService()
    .addNotificationJob('request_available', request.id, book.title, book.author, username, undefined, 'audiobook')
    .catch((error) => logger.error('Failed to queue notification', { error: error instanceof Error ? error.message : String(error) }));

  if (abs) {
    try {
      await applyItemMarks({
        deliveredBookIds: [book.id],
        listedItems: [],
        logger,
        tagging: await isRequesterTaggingOn(),
        explicit: await isExplicitMarkOn(),
      });
    } catch (error) {
      logger.error(`Requester tag for granted access not written: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { granted: true, request: { ...request, ...data, ...(missingItem ? { audiobook: { ...book, ...missingItem } } : {}) } };
}
