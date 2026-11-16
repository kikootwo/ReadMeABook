/**
 * Component: Works Heal (detach wrongly linked series volumes)
 * Documentation: documentation/integrations/audible.md
 *
 * Different volumes of one series wrongly linked into one work (#599) are split on the
 * pre-dedup rows of the series, search and author views and both watched syncs
 * (`partitionVolumes`, heal level); each class apart from the anchor's moves to a new work.
 */

import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { partitionVolumes } from '@/lib/utils/series-volume';
import type { AudibleAudiobook } from '@/lib/integrations/audible.service';

const logger = RMABLogger.create('WorksHeal');

/** Another view already moved these rows: roll back, nothing to do */
class AlreadyMoved extends Error {}

/** One class to a new work in one transaction, only while its rows sit in the stale work: a rerun or a
 *  concurrent view matches 0 rows and rolls back (no empty work); a partial count commits */
async function moveClass(staleWorkId: string, cls: AudibleAudiobook[]): Promise<void> {
  const anchor = cls[0];
  try {
    const newWorkId = await prisma.$transaction(async (tx) => {
      const work = await tx.work.create({ data: { title: anchor.title, author: anchor.author } });
      const { count } = await tx.workAsin.updateMany({
        where: { asin: { in: cls.map((b) => b.asin) }, workId: staleWorkId },
        data: { workId: work.id, isCanonical: false },
      });
      if (count === 0) throw new AlreadyMoved();
      await tx.workAsin.updateMany({ where: { asin: anchor.asin, workId: work.id }, data: { isCanonical: true } });
      return work.id;
    });
    logger.info(`Detached ${cls.length} ASIN(s) of "${anchor.title}" (${cls.map((b) => b.asin).join(', ')}) from a work that linked different volumes`, {
      staleWorkId,
      newWorkId,
    });
  } catch (error) {
    if (error instanceof AlreadyMoved) return;
    logger.warn('Could not detach a wrongly linked volume; the view still shows it apart', {
      error: error instanceof Error ? error.message : String(error),
      staleWorkId,
      asins: cls.map((b) => b.asin),
    });
  }
}

/** Detach known different volumes one work links: sequential transactions, only `dedup_auto` rows
 *  move, the anchor (canonical ASIN when in view) never moves. Never throws. */
export async function detachVetoedAsins(rows: AudibleAudiobook[]): Promise<void> {
  if (rows.length < 2) return;
  try {
    const unique = [...new Map(rows.map((r) => [r.asin, r])).values()];
    const entries = await prisma.workAsin.findMany({
      where: { asin: { in: unique.map((r) => r.asin) } },
      select: { asin: true, workId: true, isCanonical: true, source: true },
    });
    const byAsin = new Map(entries.map((e) => [e.asin, e]));

    const rowsByWork = new Map<string, AudibleAudiobook[]>();
    for (const row of unique) {
      const workId = byAsin.get(row.asin)?.workId;
      if (workId) rowsByWork.set(workId, [...(rowsByWork.get(workId) ?? []), row]);
    }

    for (const [workId, members] of rowsByWork) {
      if (members.length < 2) continue;
      const canonical = members.find((m) => byAsin.get(m.asin)?.isCanonical)?.asin;
      for (const cls of partitionVolumes(members, canonical, 'heal').slice(1)) {
        const movable = cls.filter((b) => byAsin.get(b.asin)?.source === 'dedup_auto');
        if (movable.length > 0) await moveClass(workId, movable);
      }
    }
  } catch (error) {
    logger.warn('Works heal skipped', {
      error: error instanceof Error ? error.message : String(error),
      rowCount: rows.length,
    });
  }
}
