/**
 * Component: Requester tags, the per-run tagger (#232)
 * Documentation: documentation/features/requester-tags.md
 *
 * One tagger for every path: delivery (books the scan just made available), repair (listed items
 * whose tag list lost a requester tag, capped per run) and the backfill job. Candidates are the
 * available requests of this run's delivered books and listed items (one read per 1,000 item ids).
 * A request completed without approval (`approvalBypassedBy` set) and an admin's request that RMAB
 * never downloaded (a manual or bulk import made for the importing admin) are never tagged on any
 * path. Writes go through addABSItemTags (read, merge, write). Never throws for an ABS failure;
 * stops a run after consecutive failures.
 */

import { prisma } from '@/lib/db';
import { getConfigService } from '@/lib/services/config.service';
import type { RMABLogger } from '@/lib/utils/logger';
import type { LibraryItem } from '@/lib/services/library/ILibraryService';
import { addABSItemTags } from './api';
import { loadRequesterTagMap, logRunWarning } from './requester-tag-users';
import {
  REQUESTER_TAG_FAILURE_LIMIT,
  REQUESTER_TAG_ITEM_IDS_PER_READ,
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
  /**
   * requests not tagged: name leaves no tag, shared tag, user deleted or not approved, completed
   * without approval, an admin's request RMAB never downloaded (an import nobody asked for)
   */
  skippedNoTag: number;
  skippedShared: number;
  skippedUser: number;
  skippedUnapproved: number;
  skippedImported: number;
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
  _count: { select: { downloadHistory: true } },
} as const;

interface Candidate {
  id: string;
  userId: string;
  approvalBypassedBy: string | null;
  audiobook: { id: string; absItemId: string | null; title: string };
  _count: { downloadHistory: number };
}

/** The available requests of the delivered books and the listed items; nothing else is read. */
async function loadCandidates(deliveredBookIds: string[], listedItemIds: string[]): Promise<Candidate[]> {
  const found = new Map<string, Candidate>();
  for (let start = 0; start === 0 || start < listedItemIds.length; start += REQUESTER_TAG_ITEM_IDS_PER_READ) {
    const bookIds = start === 0 ? deliveredBookIds : [];
    const itemIds = listedItemIds.slice(start, start + REQUESTER_TAG_ITEM_IDS_PER_READ);
    const OR = [
      ...(bookIds.length > 0 ? [{ audiobookId: { in: bookIds } }] : []),
      ...(itemIds.length > 0 ? [{ audiobook: { absItemId: { in: itemIds } } }] : []),
    ];
    if (OR.length === 0) continue;
    const rows = await prisma.request.findMany({ where: { ...CANDIDATE_WHERE, OR }, select: CANDIDATE_SELECT });
    for (const row of rows) found.set(row.id, row);
  }
  return [...found.values()];
}

/**
 * A manual or bulk import with no request to recycle creates one for the importing admin; no user
 * asked for that book. Told apart by owner and history: an admin's request with no download record
 * (an import never writes one; every RMAB download does). Also matches an admin's own request that
 * reached the library without an RMAB download, which is not tagged either.
 */
const importedForAdmin = (r: Candidate, role: string | undefined) => role === 'admin' && r._count.downloadHistory === 0;

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
    skippedNoTag: 0, skippedShared: 0, skippedUser: 0, skippedUnapproved: 0, skippedImported: 0, stoppedEarly: false,
  };
  if (delivered.size === 0 && listed.size === 0) return result;

  const candidates = await loadCandidates([...delivered], [...listed.keys()]);
  const eligible = candidates.filter((r) => r.approvalBypassedBy === null);
  const unapproved = candidates.filter((r) => r.approvalBypassedBy !== null);

  result.considered = candidates.length;
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
    if (importedForAdmin(r, user.role)) {
      result.skippedImported++;
      logger.debug(`Not tagging request ${r.id}: an admin's import nobody requested`);
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
