/**
 * Component: Requester tags and the Explicit flag, the per-run item writer (#232, #542)
 * Documentation: documentation/features/requester-tags.md, documentation/features/explicit-flag.md
 *
 * One step for every path: delivery (books the scan just made available), repair (listed items
 * whose tag list lost a requester tag or whose Explicit flag is off, capped per run) and the
 * backfill job. Candidates are the available requests of this run's delivered books and listed
 * items (one read per 1,000 item ids). Tags (setting on): a request completed without approval
 * (`approvalBypassedBy` set) and an admin's request that RMAB never downloaded are never tagged.
 * Explicit (any mode): an item is flagged when any candidate request of it is marked; those rules
 * don't apply because the flag only restricts. One shared write per item (writeABSItem). Never
 * throws for an ABS failure; stops a run after consecutive failures.
 */

import { prisma } from '@/lib/db';
import { getConfigService } from '@/lib/services/config.service';
import type { RMABLogger } from '@/lib/utils/logger';
import type { LibraryItem } from '@/lib/services/library/ILibraryService';
import { writeABSItem, type ABSItemWriteResult } from './api';
import { loadRequesterTagMap, logRunWarning } from './requester-tag-users';
import { createExplicitGuard, hasMarkedAvailableRequests, type ExplicitGuard } from './explicit-flag';
import {
  REQUESTER_TAG_FAILURE_LIMIT,
  REQUESTER_TAG_ITEM_IDS_PER_READ,
  REQUESTER_TAG_RECHECK_EVERY,
  REQUESTER_TAG_REPAIR_CAP,
  REQUESTER_TAG_SETTING_KEY,
} from '@/lib/constants/requester-tags';

export { REQUESTER_TAG_SETTING_KEY };

export interface ItemMarkResult {
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
  /** items whose Explicit flag was turned on / not written because the key's user can't see explicit books */
  markedExplicit: number;
  explicitHeldBack: number;
  stoppedEarly: boolean;
}

export async function isRequesterTaggingOn(): Promise<boolean> {
  return (await getConfigService().get(REQUESTER_TAG_SETTING_KEY)) === 'true';
}

interface ItemPlan {
  title: string;
  tags: Set<string>;
  explicit: boolean;
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
  explicit: true,
  audiobook: { select: { id: true, absItemId: true, title: true } },
  _count: { select: { downloadHistory: true } },
} as const;

interface Candidate {
  id: string;
  userId: string;
  approvalBypassedBy: string | null;
  explicit: boolean;
  audiobook: { id: string; absItemId: string | null; title: string };
  _count: { downloadHistory: number };
}

/** The available requests of the delivered books and the listed items (marked ones only when tagging is off). */
async function loadCandidates(deliveredBookIds: string[], listedItemIds: string[], markedOnly: boolean): Promise<Candidate[]> {
  const found = new Map<string, Candidate>();
  const where = markedOnly ? { ...CANDIDATE_WHERE, explicit: true } : CANDIDATE_WHERE;
  for (let start = 0; start === 0 || start < listedItemIds.length; start += REQUESTER_TAG_ITEM_IDS_PER_READ) {
    const bookIds = start === 0 ? deliveredBookIds : [];
    const itemIds = listedItemIds.slice(start, start + REQUESTER_TAG_ITEM_IDS_PER_READ);
    const OR = [
      ...(bookIds.length > 0 ? [{ audiobookId: { in: bookIds } }] : []),
      ...(itemIds.length > 0 ? [{ audiobook: { absItemId: { in: itemIds } } }] : []),
    ];
    if (OR.length === 0) continue;
    const rows = await prisma.request.findMany({ where: { ...where, OR }, select: CANDIDATE_SELECT });
    for (const row of rows) found.set(row.id, row);
  }
  return [...found.values()];
}

/**
 * A manual or bulk import with no request to recycle creates one for the importing admin; no user
 * asked for that book. Told apart by requester and history: an admin's request with no download
 * record (an import never writes one; every RMAB download does). Also matches an admin's own
 * request that reached the library without an RMAB download, which is not tagged either.
 */
const importedForAdmin = (r: Candidate, role: string | undefined) => role === 'admin' && r._count.downloadHistory === 0;

/** Adds each eligible candidate's requester tag to its item's plan. */
async function planTags(
  candidates: Candidate[],
  planFor: (r: Candidate) => ItemPlan,
  result: ItemMarkResult,
  logger: RMABLogger
): Promise<void> {
  const eligible = candidates.filter((r) => r.approvalBypassedBy === null);
  const unapproved = candidates.filter((r) => r.approvalBypassedBy !== null);
  result.skippedUnapproved = unapproved.length;
  if (unapproved.length > 0) {
    logger.info(`${unapproved.length} requests delivered without approval are not tagged`);
    for (const r of unapproved) logger.debug(`Not tagging request ${r.id} (${r.approvalBypassedBy})`);
  }
  if (eligible.length === 0) return;

  const map = await loadRequesterTagMap();
  const seen = new Set<string>();
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
    planFor(r).tags.add(map.tagByUser.get(r.userId)!);
  }
}

/** Counts one write's outcome and logs it; true when an ABS call failed (counts toward the stop). */
function recordOutcome(outcome: ABSItemWriteResult, plan: ItemPlan, itemId: string, result: ItemMarkResult, logger: RMABLogger): boolean {
  const where = `"${plan.title}" (Audiobookshelf item ${itemId})`;
  if (outcome.tags === 'added') {
    result.tagged++;
    logger.info(`Tagged ${where} with ${outcome.addedTags.join(', ')}`);
  } else if (outcome.tags === 'present') {
    result.alreadyTagged++;
  } else if (outcome.tags === 'failed') {
    logger.warn(`Could not tag ${where}: ${outcome.error}`);
  }
  if (outcome.explicit === 'set') {
    result.markedExplicit++;
    logger.info(`Marked ${where} explicit`);
  } else if (outcome.explicit === 'failed') {
    logger.warn(`Could not mark ${where} explicit: ${outcome.error}`);
  }
  const callFailed = outcome.tags === 'failed' || outcome.explicit === 'failed';
  if (callFailed || outcome.tags === 'unreadable') result.failed++;
  return callFailed;
}

const succeeded = (o: ABSItemWriteResult) =>
  o.tags === 'added' || o.tags === 'present' || o.explicit === 'set' || o.explicit === 'present';

/**
 * Writes this run's requester tags and Explicit flags. `tagging: false` reads only marked requests
 * and writes only the flag. `mode: 'backfill'` writes every listed item that needs it, uncapped,
 * and may read items listed without a tag array.
 */
export async function applyItemMarks(opts: {
  deliveredBookIds: Iterable<string>;
  listedItems: LibraryItem[];
  logger: RMABLogger;
  tagging: boolean;
  mode?: 'scan' | 'backfill';
  shouldContinue?: () => Promise<boolean>;
}): Promise<ItemMarkResult> {
  const { logger, mode = 'scan' } = opts;
  const guard = createExplicitGuard(logger);
  const result: ItemMarkResult = {
    considered: 0, tagged: 0, alreadyTagged: 0, failed: 0,
    skippedNoTag: 0, skippedShared: 0, skippedUser: 0, skippedUnapproved: 0, skippedImported: 0,
    markedExplicit: 0, explicitHeldBack: 0, stoppedEarly: false,
  };
  await writePlannedItems(opts, guard, result);
  // Once per scan while marked books are in the library: warn even when nothing was written (#542)
  if (mode === 'scan' && !guard.checked() && (await hasMarkedAvailableRequests())) await guard.allowed();
  result.explicitHeldBack = guard.finish();
  return result;
}

async function writePlannedItems(
  opts: Parameters<typeof applyItemMarks>[0],
  guard: ExplicitGuard,
  result: ItemMarkResult
): Promise<void> {
  const { listedItems, logger, tagging, mode = 'scan', shouldContinue } = opts;
  const delivered = new Set(opts.deliveredBookIds);
  const listed = new Map(listedItems.map((item) => [item.externalId, item]));
  if (delivered.size === 0 && listed.size === 0) return;

  const candidates = await loadCandidates([...delivered], [...listed.keys()], !tagging);
  result.considered = candidates.length;
  const items = new Map<string, ItemPlan>();
  const planFor = (r: Candidate): ItemPlan => {
    const itemId = r.audiobook.absItemId!;
    const plan = items.get(itemId) ?? { title: r.audiobook.title, tags: new Set<string>(), explicit: false, delivered: false };
    plan.delivered ||= delivered.has(r.audiobook.id);
    items.set(itemId, plan);
    return plan;
  };
  for (const r of candidates) if (r.explicit) planFor(r).explicit = true;
  if (tagging) await planTags(candidates, planFor, result, logger);

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
    const listedItem = listed.get(itemId);
    const repairOnly = mode === 'scan' && !plan.delivered;
    const expected = [...plan.tags];
    const listedTags = listedItem?.tags;
    let needTags = expected.length > 0;
    if (needTags && listedTags && expected.every((t) => listedTags.includes(t))) {
      result.alreadyTagged++;
      needTags = false;
    }
    if (repairOnly && !listedTags) needTags = false; // repair acts only on a listed tag list that lacks a tag
    let needExplicit = plan.explicit && listedItem?.explicit !== true;
    if (repairOnly && listedItem?.explicit === undefined) needExplicit = false; // ... or a listed flag that is off
    if (needExplicit && !(await guard.allowed())) {
      guard.holdBack(plan.title);
      needExplicit = false;
    }
    if (!needTags && !needExplicit) continue;
    if (repairOnly) {
      if (repairs >= REQUESTER_TAG_REPAIR_CAP) {
        deferred++;
        continue;
      }
      repairs++;
    }

    const outcome = await writeABSItem(itemId, {
      ...(needTags ? { tags: expected } : {}),
      ...(needExplicit ? { explicit: true as const } : {}),
    });
    if (recordOutcome(outcome, plan, itemId, result, logger)) {
      failures++;
      if (failures >= REQUESTER_TAG_FAILURE_LIMIT) {
        const hint = outcome.httpStatus === 403 ? ": the Audiobookshelf API key's user needs permission to update items" : '';
        logger.error(`Audiobookshelf item writes stopped for this run after ${failures} failures in a row${hint}`);
        result.stoppedEarly = true;
        break;
      }
    } else if (succeeded(outcome)) {
      failures = 0;
    }
  }
  if (deferred > 0) logger.info(`${deferred} more items need their requester tag or Explicit flag; the next scan continues`);
}

/**
 * The scan's delivery step (Audiobookshelf): writes this run's deliveries and repairs listed items.
 * Tags only while the setting is on; the Explicit flag whenever a request is marked.
 */
export async function runItemMarkStep(opts: {
  deliveredBookIds: Iterable<string>;
  listedItems: LibraryItem[];
  logger: RMABLogger;
}): Promise<ItemMarkResult> {
  return applyItemMarks({ ...opts, tagging: await isRequesterTaggingOn(), mode: 'scan' });
}
