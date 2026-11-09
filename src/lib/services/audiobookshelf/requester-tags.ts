/**
 * Component: Requester tags, the per-run tagger (#232)
 * Documentation: documentation/features/requester-tags.md
 *
 * One tagger for every path: delivery (books the scan just made available), repair (listed items
 * whose tag list lost a requester tag, capped per run) and the backfill job. Candidates come from
 * one query that requires `approvalBypassedBy` NULL, so a request completed without approval is
 * never tagged on any path. Writes go through addABSItemTags (read, merge, write). Never throws
 * for an ABS failure; stops a run after consecutive failures.
 */

import { prisma } from '@/lib/db';
import { getConfigService } from '@/lib/services/config.service';
import type { RMABLogger } from '@/lib/utils/logger';
import type { LibraryItem } from '@/lib/services/library/ILibraryService';
import { addABSItemTags } from './api';
import { loadRequesterTagMap, logRunWarning } from './requester-tag-users';
import {
  REQUESTER_TAG_FAILURE_LIMIT,
  REQUESTER_TAG_RECHECK_EVERY,
  REQUESTER_TAG_REPAIR_CAP,
  REQUESTER_TAG_SETTING_KEY,
} from '@/lib/constants/requester-tags';

export { REQUESTER_TAG_SETTING_KEY };

export interface RequesterTagResult {
  /** candidate requests (eligible and not) */
  considered: number;
  /** items written / items already holding their tags / items not written */
  tagged: number;
  alreadyTagged: number;
  failed: number;
  /** requests not tagged: name leaves no tag, shared tag, user deleted or not approved, completed without approval */
  skippedNoTag: number;
  skippedShared: number;
  skippedUser: number;
  skippedUnapproved: number;
  stoppedEarly: boolean;
}

export async function isRequesterTaggingOn(): Promise<boolean> {
  return (await getConfigService().get(REQUESTER_TAG_SETTING_KEY)) === 'true';
}

interface ItemPlan {
  title: string;
  tags: Set<string>;
  delivered: boolean;
}

const CANDIDATE_WHERE = {
  deletedAt: null,
  type: 'audiobook',
  status: 'available',
  audiobook: { absItemId: { not: null } },
} as const;

const CANDIDATE_SELECT = {
  id: true,
  userId: true,
  approvalBypassedBy: true,
  audiobook: { select: { id: true, absItemId: true, title: true } },
} as const;

/**
 * Tags the requesters of `deliveredBookIds` and repairs listed items. `mode: 'backfill'` tags
 * every listed eligible item, uncapped, and may read items listed without a tag array.
 */
export async function applyRequesterTags(opts: {
  deliveredBookIds: Iterable<string>;
  listedItems: LibraryItem[];
  logger: RMABLogger;
  mode?: 'scan' | 'backfill';
  shouldContinue?: () => Promise<boolean>;
}): Promise<RequesterTagResult> {
  const { listedItems, logger, mode = 'scan', shouldContinue } = opts;
  const delivered = new Set(opts.deliveredBookIds);
  const listed = new Map(listedItems.map((item) => [item.externalId, item]));
  const result: RequesterTagResult = {
    considered: 0, tagged: 0, alreadyTagged: 0, failed: 0,
    skippedNoTag: 0, skippedShared: 0, skippedUser: 0, skippedUnapproved: 0, stoppedEarly: false,
  };
  if (delivered.size === 0 && listed.size === 0) return result;

  type Candidate = { id: string; userId: string; audiobook: { id: string; absItemId: string | null; title: string } };
  const inRun = (r: Candidate) => delivered.has(r.audiobook.id) || listed.has(r.audiobook.absItemId ?? '');
  const eligible = (await prisma.request.findMany({
    where: { ...CANDIDATE_WHERE, approvalBypassedBy: null },
    select: CANDIDATE_SELECT,
  })).filter(inRun);
  const unapproved = (await prisma.request.findMany({
    where: { ...CANDIDATE_WHERE, approvalBypassedBy: { not: null } },
    select: CANDIDATE_SELECT,
  })).filter(inRun);

  result.considered = eligible.length + unapproved.length;
  result.skippedUnapproved = unapproved.length;
  if (unapproved.length > 0) {
    logger.info(`${unapproved.length} requests delivered without approval are not tagged`);
    for (const r of unapproved) logger.debug(`Not tagging request ${r.id} (${r.approvalBypassedBy})`);
  }
  if (eligible.length === 0) return result;

  const map = await loadRequesterTagMap();
  const seen = new Set<string>();
  const items = new Map<string, ItemPlan>();
  for (const r of eligible) {
    const user = map.usersById.get(r.userId);
    if (!user || map.excludedUsers.has(r.userId)) {
      result.skippedUser++;
      continue;
    }
    logRunWarning(map, user, seen, logger);
    const refused = map.refusedUsers.get(r.userId);
    if (refused) {
      if (refused === 'shared') result.skippedShared++;
      else result.skippedNoTag++;
      continue;
    }
    const itemId = r.audiobook.absItemId!;
    const plan = items.get(itemId) ?? { title: r.audiobook.title, tags: new Set<string>(), delivered: false };
    plan.tags.add(map.tagByUser.get(r.userId)!);
    plan.delivered ||= delivered.has(r.audiobook.id);
    items.set(itemId, plan);
  }

  // Delivered books first: they are never held back by the repair cap
  const ordered = [...items].sort(([, a], [, b]) => Number(b.delivered) - Number(a.delivered));
  let repairs = 0;
  let deferred = 0;
  let failures = 0;
  let visited = 0;
  for (const [itemId, plan] of ordered) {
    if (mode === 'backfill' && shouldContinue && visited > 0 && visited % REQUESTER_TAG_RECHECK_EVERY === 0 && !(await shouldContinue())) {
      logger.info('Requester tagging was turned off; stopping');
      result.stoppedEarly = true;
      break;
    }
    visited++;
    const expected = [...plan.tags];
    const listedTags = listed.get(itemId)?.tags;
    if (listedTags && expected.every((t) => listedTags.includes(t))) {
      result.alreadyTagged++;
      continue;
    }
    if (mode === 'scan' && !plan.delivered) {
      if (!listedTags) continue; // repair acts only on a listed tag list that lacks a tag
      if (repairs >= REQUESTER_TAG_REPAIR_CAP) {
        deferred++;
        continue;
      }
      repairs++;
    }

    const outcome = await addABSItemTags(itemId, expected);
    if (outcome.status === 'added') {
      failures = 0;
      result.tagged++;
      logger.info(`Tagged "${plan.title}" (Audiobookshelf item ${itemId}) with ${outcome.tags.join(', ')}`);
    } else if (outcome.status === 'present') {
      failures = 0;
      result.alreadyTagged++;
    } else if (outcome.status === 'unreadable') {
      result.failed++;
    } else {
      result.failed++;
      failures++;
      logger.warn(`Could not tag "${plan.title}" (Audiobookshelf item ${itemId}): ${outcome.error}`);
      if (failures >= REQUESTER_TAG_FAILURE_LIMIT) {
        const hint = outcome.httpStatus === 403 ? ": the Audiobookshelf API key's user needs permission to update items" : '';
        logger.error(`Requester tagging stopped for this run after ${failures} failures in a row${hint}`);
        result.stoppedEarly = true;
        break;
      }
    }
  }
  if (deferred > 0) logger.info(`${deferred} more items need their requester tag; the next scan continues`);
  return result;
}

/** The scan's delivery step: tags this run's deliveries and repairs listed items when the setting is on. */
export async function runRequesterTagStep(opts: {
  deliveredBookIds: Iterable<string>;
  listedItems: LibraryItem[];
  logger: RMABLogger;
}): Promise<RequesterTagResult | null> {
  if (!(await isRequesterTaggingOn())) return null;
  return applyRequesterTags({ ...opts, mode: 'scan' });
}
