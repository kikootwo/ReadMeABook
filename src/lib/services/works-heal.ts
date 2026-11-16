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
import { canonicalByWork, partitionVolumes } from '@/lib/utils/series-volume';
import { fillSeriesPositions } from '@/lib/integrations/audible-series-positions';
import type { AudibleAudiobook } from '@/lib/integrations/audible.service';

const logger = RMABLogger.create('WorksHeal');

type Entry = { asin: string; workId: string; isCanonical: boolean; source: string };

/** Another view already moved these rows: roll back, nothing to do */
class AlreadyMoved extends Error {}

/** One class to a new work (named after the class anchor) in one transaction, only while its rows sit in
 *  the stale work: a rerun or a concurrent view matches 0 rows and rolls back (no empty work); a partial count commits */
async function moveClass(staleWorkId: string, movable: AudibleAudiobook[], anchor: AudibleAudiobook): Promise<void> {
  try {
    const newWorkId = await prisma.$transaction(async (tx) => {
      const work = await tx.work.create({ data: { title: anchor.title, author: anchor.author } });
      const { count } = await tx.workAsin.updateMany({
        where: { asin: { in: movable.map((b) => b.asin) }, workId: staleWorkId },
        data: { workId: work.id, isCanonical: false },
      });
      if (count === 0) throw new AlreadyMoved();
      await tx.workAsin.updateMany({ where: { asin: movable[0].asin, workId: work.id }, data: { isCanonical: true } });
      return work.id;
    });
    logger.info(`Detached ${movable.length} ASIN(s) of "${anchor.title}" (${movable.map((b) => b.asin).join(', ')}) from a work that linked different volumes`, {
      staleWorkId,
      newWorkId,
    });
  } catch (error) {
    if (error instanceof AlreadyMoved) return;
    logger.warn('Could not detach a wrongly linked volume; the view still shows it apart', {
      error: error instanceof Error ? error.message : String(error),
      staleWorkId,
      asins: movable.map((b) => b.asin),
    });
  }
}

/** Per work with 2+ rows in view and its canonical ASIN in view (else the anchor's class is unknown here) */
async function healWorks(rows: AudibleAudiobook[], entries: Entry[]): Promise<void> {
  const byAsin = new Map(entries.map((e) => [e.asin, e]));
  const canonical = canonicalByWork(entries);
  const rowsByWork = new Map<string, AudibleAudiobook[]>();
  for (const row of rows) {
    const workId = byAsin.get(row.asin)?.workId;
    if (workId) rowsByWork.set(workId, [...(rowsByWork.get(workId) ?? []), row]);
  }

  for (const [workId, members] of rowsByWork) {
    if (members.length < 2 || !canonical.has(workId)) continue;
    for (const cls of partitionVolumes(members, canonical.get(workId), 'heal').slice(1)) {
      const movable = cls.filter((b) => byAsin.get(b.asin)?.source === 'dedup_auto');
      if (movable.length > 0) await moveClass(workId, movable, cls[0]);
    }
  }
}

/** ASINs whose work links another row in view */
function linkedAsins(entries: Entry[]): Set<string> {
  const perWork = new Map<string, number>();
  entries.forEach((e) => perWork.set(e.workId, (perWork.get(e.workId) ?? 0) + 1));
  return new Set(entries.filter((e) => (perWork.get(e.workId) ?? 0) > 1).map((e) => e.asin));
}

/**
 * Detach known different volumes one work links: sequential transactions, only `dedup_auto` rows move,
 * the anchor (canonical ASIN) never moves. With `seriesAsin` (series views) positions are filled first,
 * also for unlabelled rows a work links (one work lookup serves both). Returns the rows, filled. Never throws.
 */
export async function detachVetoedAsins(rows: AudibleAudiobook[], seriesAsin?: string): Promise<AudibleAudiobook[]> {
  const unique = [...new Map(rows.map((r) => [r.asin, r])).values()];
  if (unique.length < 2) return rows;
  let filled: AudibleAudiobook[] | undefined;
  try {
    const entries: Entry[] = await prisma.workAsin.findMany({
      where: { asin: { in: unique.map((r) => r.asin) } },
      select: { asin: true, workId: true, isCanonical: true, source: true },
    });
    filled = seriesAsin ? await fillSeriesPositions(rows, seriesAsin, linkedAsins(entries)) : rows;
    await healWorks([...new Map(filled.map((r) => [r.asin, r])).values()], entries);
  } catch (error) {
    logger.warn('Works heal skipped', {
      error: error instanceof Error ? error.message : String(error),
      rowCount: rows.length,
    });
  }
  // No work lookup: positions are still filled for the rows local dedup would merge
  return filled ?? (seriesAsin ? fillSeriesPositions(rows, seriesAsin) : rows);
}
