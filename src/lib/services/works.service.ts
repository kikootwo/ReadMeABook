/**
 * Component: Works Service
 * Documentation: documentation/integrations/audible.md
 *
 * Manages the works table — persistent cross-ASIN audiobook identity mapping.
 * Layer 1: Auto-populated from dedup logic when users browse search/author/series pages.
 * Layer 2: Seeded at request time to ensure requested ASINs are tracked.
 */

import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { metadataScore, type DedupGroup } from '@/lib/utils/deduplicate-audiobooks';
import { partitionVolumes } from '@/lib/utils/series-volume';
import type { AudibleAudiobook } from '@/lib/integrations/audible.service';

const logger = RMABLogger.create('WorksService');

// ---------------------------------------------------------------------------
// Layer 1: Persist dedup groups (fire-and-forget from API routes)
// ---------------------------------------------------------------------------

/**
 * Persist dedup groups to the works table. For each group of 2+ ASINs that
 * were identified as the same audiobook, create or update a Work record
 * linking all ASINs together. Groups whose series positions are not settled
 * (`persistable: false`) are display-only and never written (#599).
 *
 * Safe to call fire-and-forget — never throws; one failing group does not stop the rest.
 */
export async function persistDedupGroups(groups: DedupGroup[]): Promise<void> {
  for (const group of groups) {
    if (group.persistable === false) continue;
    try {
      await persistSingleGroup(group);
    } catch (error) {
      logger.error('Failed to persist dedup group', {
        error: error instanceof Error ? error.message : String(error),
        canonicalAsin: group.canonicalAsin,
      });
    }
  }
}

/** work_asins rows for group ASINs not linked yet (concurrent inserts are skipped) */
function newRows(group: DedupGroup, workId: string, asins: string[]) {
  return asins.map(asin => ({
    workId,
    asin,
    narrator: asin === group.canonicalAsin ? group.narrator : undefined,
    durationMinutes: asin === group.canonicalAsin ? group.durationMinutes : undefined,
    isCanonical: asin === group.canonicalAsin,
    source: 'dedup_auto',
  }));
}

/**
 * Persist a single dedup group. Merge rule (#599): of the existing works the group
 * touches, at most one may hold ASINs outside the group (it becomes the target); a
 * work is absorbed only when all its ASINs are in the group, so the in-view checks
 * covered them. With two or more such works there is no merge: unlinked group ASINs
 * join the work holding the canonical ASIN, or nothing is written when it is unlinked.
 */
async function persistSingleGroup(group: DedupGroup): Promise<void> {
  const { canonicalAsin, allAsins, title, author } = group;

  const existingEntries = await prisma.workAsin.findMany({
    where: { asin: { in: allAsins } },
    select: { asin: true, workId: true },
  });
  const existingWorkIds = [...new Set(existingEntries.map(e => e.workId))];
  const existingAsinSet = new Set(existingEntries.map(e => e.asin));
  const unlinked = allAsins.filter(a => !existingAsinSet.has(a));

  if (existingWorkIds.length === 0) {
    const work = await prisma.work.create({ data: { title, author } });
    const { count } = await prisma.workAsin.createMany({ data: newRows(group, work.id, allAsins), skipDuplicates: true });
    // Every ASIN was linked by a concurrent view meanwhile: drop the empty work
    if (count === 0) await prisma.work.deleteMany({ where: { id: work.id, asins: { none: {} } } });
    logger.debug('Created new work', { workId: work.id, asinCount: count });
    return;
  }

  const groupSet = new Set(allAsins);
  const touchedRows = await prisma.workAsin.findMany({
    where: { workId: { in: existingWorkIds } },
    select: { asin: true, workId: true },
  });
  const outsideWorkIds = existingWorkIds.filter(id => touchedRows.some(r => r.workId === id && !groupSet.has(r.asin)));
  const canonicalWorkId = existingEntries.find(e => e.asin === canonicalAsin)?.workId;

  let targetWorkId: string;
  if (outsideWorkIds.length >= 2) {
    if (!canonicalWorkId) {
      logger.debug('Group spans works with unchecked ASINs and its canonical ASIN is unlinked; nothing written', { canonicalAsin });
      return;
    }
    targetWorkId = canonicalWorkId;
  } else {
    targetWorkId = outsideWorkIds[0] ?? canonicalWorkId ?? existingWorkIds[0];
    const mergeWorkIds = existingWorkIds.filter(id => id !== targetWorkId);
    if (mergeWorkIds.length > 0) {
      // Move only the group's rows; delete only works left empty (a concurrent insert survives)
      await prisma.workAsin.updateMany({
        where: { asin: { in: allAsins }, workId: { in: mergeWorkIds } },
        data: { workId: targetWorkId },
      });
      await prisma.work.deleteMany({ where: { id: { in: mergeWorkIds }, asins: { none: {} } } });
      logger.debug('Merged works', { targetWorkId, mergedWorkIds: mergeWorkIds });
    }
  }

  if (unlinked.length > 0) {
    await prisma.workAsin.createMany({ data: newRows(group, targetWorkId, unlinked), skipDuplicates: true });
    logger.debug('Added ASINs to existing work', { workId: targetWorkId, newAsinCount: unlinked.length });
  }

  // Ensure the canonical ASIN is marked
  await prisma.workAsin.updateMany({
    where: { workId: targetWorkId, asin: canonicalAsin },
    data: { isCanonical: true },
  });
}

// ---------------------------------------------------------------------------
// Layer 2: Seed ASIN at request time
// ---------------------------------------------------------------------------

/**
 * Ensure an ASIN is tracked in the works table. Creates a single-ASIN work
 * if the ASIN isn't already present. Called at request creation time.
 *
 * Safe to call fire-and-forget — never throws.
 */
export async function seedAsin(
  asin: string,
  title: string,
  author: string,
  narrator?: string,
  durationMinutes?: number
): Promise<void> {
  try {
    // Check if ASIN already tracked
    const existing = await prisma.workAsin.findUnique({
      where: { asin },
    });
    if (existing) return;

    // Create a new single-ASIN work
    const work = await prisma.work.create({
      data: { title, author },
    });

    await prisma.workAsin.create({
      data: {
        workId: work.id,
        asin,
        narrator,
        durationMinutes,
        isCanonical: true,
        source: 'dedup_auto',
      },
    });

    logger.debug('Seeded ASIN', { workId: work.id, asin });
  } catch (error) {
    logger.error('Failed to seed ASIN', {
      error: error instanceof Error ? error.message : String(error),
      asin,
    });
  }
}

// ---------------------------------------------------------------------------
// View-level collapse (consult the works table after local dedup)
// ---------------------------------------------------------------------------

/**
 * Collapse books that already share a Work record according to the works table.
 *
 * The local `deduplicateAndCollectGroups()` pass is title/narrator/duration-based
 * and stateless — it can fail to merge ASINs whose source metadata diverges (e.g.
 * a series-page scrape captures different "first narrators" for two ASINs of the
 * same recording, or two paginated pages each contain one ASIN and never compare
 * them). The works table is the durable source of truth for "same book" identity,
 * populated by every prior dedup pass and by request-time seeding. This pass
 * applies that knowledge to the current view.
 *
 * Behavior:
 *  - Books whose ASINs map to a shared workId collapse to a single representative
 *    chosen by `metadataScore()` (same ranking as local dedup).
 *  - Books not present in any work, or in single-ASIN works, pass through untouched.
 *  - Known different volumes of one series never collapse, even when a work links
 *    them (#599): each work's books in view are split with `partitionVolumes` (anchor =
 *    canonical ASIN when in view), in memory only — the heal does the writes.
 *  - Original ordering is preserved (the kept representative sits at the position
 *    of the first occurrence of its work in the input list).
 *  - DB failure is non-fatal: the input list is returned unchanged so the view
 *    still renders (degrades to local-dedup-only behavior).
 */
export async function collapseByExistingWorks(
  books: AudibleAudiobook[],
): Promise<AudibleAudiobook[]> {
  if (books.length <= 1) return books;

  try {
    const asins = books.map(b => b.asin);
    const entries = await prisma.workAsin.findMany({
      where: { asin: { in: asins } },
      select: { asin: true, workId: true, isCanonical: true },
    });

    if (entries.length === 0) return books;

    const asinToWorkId = new Map<string, string>();
    const canonicalByWork = new Map<string, string>();
    for (const entry of entries) {
      asinToWorkId.set(entry.asin, entry.workId);
      if (entry.isCanonical) canonicalByWork.set(entry.workId, entry.asin);
    }

    // Each work's books in view, split into classes of compatible volumes
    const booksByWork = new Map<string, AudibleAudiobook[]>();
    for (const book of books) {
      const workId = asinToWorkId.get(book.asin);
      if (workId) booksByWork.set(workId, [...(booksByWork.get(workId) ?? []), book]);
    }
    const classKey = new Map<AudibleAudiobook, string>();
    for (const [workId, members] of booksByWork) {
      partitionVolumes(members, canonicalByWork.get(workId), 'collapse')
        .forEach((cls, i) => cls.forEach(book => classKey.set(book, `${workId}#${i}`)));
    }

    // Walk the input once, preserving position. For each class seen, keep a
    // running "best" book; for books not in any work, emit immediately.
    const result: AudibleAudiobook[] = [];
    const keyToResultIndex = new Map<string, number>();

    for (const book of books) {
      const key = classKey.get(book);
      if (!key) {
        result.push(book);
        continue;
      }

      const existingIndex = keyToResultIndex.get(key);
      if (existingIndex === undefined) {
        keyToResultIndex.set(key, result.length);
        result.push(book);
        continue;
      }

      // A sibling from this work is already in the result. Keep whichever
      // has the richer metadata; on tie, keep the earlier entry (already there).
      const existing = result[existingIndex];
      if (metadataScore(book) > metadataScore(existing)) {
        result[existingIndex] = book;
      }
    }

    const collapsed = books.length - result.length;
    if (collapsed > 0) {
      logger.debug('Collapsed books via works table', {
        inputCount: books.length,
        outputCount: result.length,
        collapsed,
      });
    }

    return result;
  } catch (error) {
    logger.error('collapseByExistingWorks failed; returning input unchanged', {
      error: error instanceof Error ? error.message : String(error),
      bookCount: books.length,
    });
    return books;
  }
}

// ---------------------------------------------------------------------------
// Sibling ASIN lookup (for library matching expansion)
// ---------------------------------------------------------------------------

/**
 * Given a list of ASINs, return a map of each input ASIN to its sibling ASINs
 * (other ASINs in the same work, NOT including the input ASIN itself).
 *
 * ASINs not found in the works table are simply omitted from the result.
 */
export async function getSiblingAsins(
  asins: string[]
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (asins.length === 0) return result;

  // Step 1: Find which input ASINs are in work_asins and their work IDs
  const inputEntries = await prisma.workAsin.findMany({
    where: { asin: { in: asins } },
    select: { asin: true, workId: true },
  });

  if (inputEntries.length === 0) return result;

  // Build map of workId -> input ASINs in that work
  const workIdToInputAsins = new Map<string, string[]>();
  for (const entry of inputEntries) {
    const list = workIdToInputAsins.get(entry.workId);
    if (list) {
      list.push(entry.asin);
    } else {
      workIdToInputAsins.set(entry.workId, [entry.asin]);
    }
  }

  // Step 2: Get ALL ASINs in those works
  const workIds = [...workIdToInputAsins.keys()];
  const allWorkAsins = await prisma.workAsin.findMany({
    where: { workId: { in: workIds } },
    select: { asin: true, workId: true },
  });

  // Build map of workId -> all ASINs
  const workIdToAllAsins = new Map<string, string[]>();
  for (const entry of allWorkAsins) {
    const list = workIdToAllAsins.get(entry.workId);
    if (list) {
      list.push(entry.asin);
    } else {
      workIdToAllAsins.set(entry.workId, [entry.asin]);
    }
  }

  // Step 3: For each input ASIN, compute siblings (all ASINs in same work minus self)
  for (const entry of inputEntries) {
    const allInWork = workIdToAllAsins.get(entry.workId) || [];
    const siblings = allInWork.filter(a => a !== entry.asin);
    if (siblings.length > 0) {
      result.set(entry.asin, siblings);
    }
  }

  return result;
}
