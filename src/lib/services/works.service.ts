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
import type { DedupGroup } from '@/lib/utils/deduplicate-audiobooks';

const logger = RMABLogger.create('WorksService');

// ---------------------------------------------------------------------------
// Layer 1: Persist dedup groups (fire-and-forget from API routes)
// ---------------------------------------------------------------------------

/**
 * Persist dedup groups to the works table. For each group of 2+ ASINs that
 * were identified as the same audiobook, create or update a Work record
 * linking all ASINs together.
 *
 * Safe to call fire-and-forget — never throws.
 */
export async function persistDedupGroups(groups: DedupGroup[]): Promise<void> {
  try {
    for (const group of groups) {
      await persistSingleGroup(group);
    }
  } catch (error) {
    logger.error('Failed to persist dedup groups', {
      error: error instanceof Error ? error.message : String(error),
      groupCount: groups.length,
    });
  }
}

/**
 * Persist a single dedup group. Handles merging when ASINs span multiple
 * existing works.
 */
async function persistSingleGroup(group: DedupGroup): Promise<void> {
  const { canonicalAsin, allAsins, title, author, narrator, durationMinutes } = group;

  // Find which of these ASINs already exist in work_asins
  const existingEntries = await prisma.workAsin.findMany({
    where: { asin: { in: allAsins } },
    select: { asin: true, workId: true },
  });

  // Collect unique work IDs that already contain any of our ASINs
  const existingWorkIds = [...new Set(existingEntries.map(e => e.workId))];
  const existingAsinSet = new Set(existingEntries.map(e => e.asin));

  if (existingWorkIds.length === 0) {
    // No existing works — create a new one with all ASINs
    const work = await prisma.work.create({
      data: { title, author },
    });

    await Promise.all(
      allAsins.map(asin =>
        prisma.workAsin.create({
          data: {
            workId: work.id,
            asin,
            narrator: asin === canonicalAsin ? narrator : undefined,
            durationMinutes: asin === canonicalAsin ? durationMinutes : undefined,
            isCanonical: asin === canonicalAsin,
            source: 'dedup_auto',
          },
        })
      )
    );

    logger.debug('Created new work', { workId: work.id, asinCount: allAsins.length });
  } else {
    // Use the first existing work as the target
    const targetWorkId = existingWorkIds[0];

    // If multiple existing works, merge them into the target
    if (existingWorkIds.length > 1) {
      const mergeWorkIds = existingWorkIds.slice(1);

      // Move all ASINs from other works to the target
      await prisma.workAsin.updateMany({
        where: { workId: { in: mergeWorkIds } },
        data: { workId: targetWorkId },
      });

      // Delete the now-empty works
      await prisma.work.deleteMany({
        where: { id: { in: mergeWorkIds } },
      });

      logger.debug('Merged works', {
        targetWorkId,
        mergedWorkIds: mergeWorkIds,
      });
    }

    // Add any new ASINs that don't already exist
    const newAsins = allAsins.filter(a => !existingAsinSet.has(a));
    if (newAsins.length > 0) {
      await Promise.all(
        newAsins.map(asin =>
          prisma.workAsin.create({
            data: {
              workId: targetWorkId,
              asin,
              narrator: asin === canonicalAsin ? narrator : undefined,
              durationMinutes: asin === canonicalAsin ? durationMinutes : undefined,
              isCanonical: asin === canonicalAsin,
              source: 'dedup_auto',
            },
          })
        )
      );

      logger.debug('Added ASINs to existing work', {
        workId: targetWorkId,
        newAsinCount: newAsins.length,
      });
    }

    // Update canonical status: ensure the canonical ASIN is marked
    await prisma.workAsin.updateMany({
      where: { workId: targetWorkId, asin: canonicalAsin },
      data: { isCanonical: true },
    });
  }
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
