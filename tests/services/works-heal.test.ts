/**
 * Component: Works Heal Tests (#599)
 * Documentation: documentation/integrations/audible.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import type { AudibleAudiobook } from '@/lib/integrations/audible.service';

const prismaMock = createPrismaMock();
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
const warn = vi.fn();
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() }) },
}));

const SERIES = 'B0H3C5X19W';
const [V1, V2, V3] = ['B0H36S85HC', 'B0H6N477LX', 'B0H6N6TH8T'];
const vol = (asin: string, part?: string, title = `Vol ${part}`): AudibleAudiobook =>
  ({ asin, title, author: `Author ${part}`, seriesAsin: SERIES, seriesPart: part });

type Entry = { asin: string; workId: string; isCanonical: boolean; source: string };
const entry = (asin: string, isCanonical = false, source = 'dedup_auto'): Entry => ({ asin, workId: 'STALE', isCanonical, source });

/** Each transaction runs its callback on the mock; outcomes are recorded */
const outcomes: Array<'committed' | 'rolled back'> = [];
let workSeq = 0;

async function heal(rows: AudibleAudiobook[]) {
  const { detachVetoedAsins } = await import('@/lib/services/works-heal');
  await detachVetoedAsins(rows);
}

describe('detachVetoedAsins', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    outcomes.length = 0;
    workSeq = 0;
    prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof prismaMock) => Promise<unknown>) => {
      try {
        const result = await fn(prismaMock);
        outcomes.push('committed');
        return result;
      } catch (error) {
        outcomes.push('rolled back');
        throw error;
      }
    });
    prismaMock.work.create.mockImplementation(async () => ({ id: `NEW${++workSeq}` }));
    prismaMock.workAsin.updateMany.mockResolvedValue({ count: 1 });
  });

  it('moves vols 2 and 3 to their own works one transaction at a time; the anchor never moves', async () => {
    prismaMock.workAsin.findMany.mockResolvedValue([entry(V1, true), entry(V2), entry('V2PRIME'), entry(V3)]);

    await heal([vol(V2, '2'), vol(V1, '1'), vol(V3, '3'), vol('V2PRIME', '2')]);

    expect(outcomes).toEqual(['committed', 'committed']);
    expect(prismaMock.work.create).toHaveBeenNthCalledWith(1, { data: { title: 'Vol 2', author: 'Author 2' } });
    expect(prismaMock.workAsin.updateMany).toHaveBeenCalledWith({
      where: { asin: { in: [V2, 'V2PRIME'] }, workId: 'STALE' },
      data: { workId: 'NEW1', isCanonical: false },
    });
    expect(prismaMock.workAsin.updateMany).toHaveBeenCalledWith({
      where: { asin: { in: [V3] }, workId: 'STALE' },
      data: { workId: 'NEW2', isCanonical: false },
    });
    const moved = prismaMock.workAsin.updateMany.mock.calls.flatMap((c) => c[0].where.asin?.in ?? [c[0].where.asin]);
    expect(moved).not.toContain(V1);
  });

  it('runs the transactions sequentially', async () => {
    prismaMock.workAsin.findMany.mockResolvedValue([entry(V1, true), entry(V2), entry(V3)]);
    let open = 0;
    let maxOpen = 0;
    prismaMock.work.create.mockImplementation(async () => {
      open++;
      maxOpen = Math.max(maxOpen, open);
      await new Promise((r) => setTimeout(r, 5));
      open--;
      return { id: `NEW${++workSeq}` };
    });

    await heal([vol(V1, '1'), vol(V2, '2'), vol(V3, '3')]);

    expect(maxOpen).toBe(1);
    expect(prismaMock.work.create).toHaveBeenCalledTimes(2);
  });

  it('rolls back when another view already moved the rows (count 0)', async () => {
    prismaMock.workAsin.findMany.mockResolvedValue([entry(V1, true), entry(V2)]);
    prismaMock.workAsin.updateMany.mockResolvedValue({ count: 0 });

    await expect(heal([vol(V1, '1'), vol(V2, '2')])).resolves.toBeUndefined();

    expect(outcomes).toEqual(['rolled back']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('resolves without throwing on a database error', async () => {
    prismaMock.workAsin.findMany.mockRejectedValue(new Error('connection lost'));
    await expect(heal([vol(V1, '1'), vol(V2, '2')])).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('opens no transaction when nothing is vetoed', async () => {
    prismaMock.workAsin.findMany.mockResolvedValue([entry(V1, true), entry('R1')]);
    await heal([vol(V1, '1'), vol('R1', undefined)]);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('heals only on known positions, not on "Band N" subtitles', async () => {
    prismaMock.workAsin.findMany.mockResolvedValue([entry('A', true), entry('B')]);
    await heal([
      { asin: 'A', title: 'T', author: 'X', subtitle: 'Series, Band 1' },
      { asin: 'B', title: 'T', author: 'X', subtitle: 'Series, Band 2' },
    ]);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('never moves a row that is not dedup_auto', async () => {
    prismaMock.workAsin.findMany.mockResolvedValue([entry(V1, true), entry(V2, false, 'admin_manual')]);
    await heal([vol(V1, '1'), vol(V2, '2')]);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
