/**
 * Component: Works Service Tests (series volumes and merge rule, #599)
 * Documentation: documentation/integrations/audible.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import type { DedupGroup } from '@/lib/utils/deduplicate-audiobooks';
import type { AudibleAudiobook } from '@/lib/integrations/audible.service';

const prismaMock = createPrismaMock();
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

const SERIES = 'B0H3C5X19W';
const [V1, V2, V3] = ['B0H36S85HC', 'B0H6N477LX', 'B0H6N6TH8T'];

function group(allAsins: string[], extra: Partial<DedupGroup> = {}): DedupGroup {
  return { canonicalAsin: allAsins[0], allAsins, title: 'T', author: 'A', ...extra };
}

/** workAsin.findMany answers by query: group lookup (asin in) or full works (workId in) */
function linkRows(rows: Array<{ asin: string; workId: string }>) {
  prismaMock.workAsin.findMany.mockImplementation(async (args: { where: { asin?: { in: string[] }; workId?: { in: string[] } } }) => {
    if (args.where.asin) return rows.filter((r) => args.where.asin!.in.includes(r.asin));
    return rows.filter((r) => args.where.workId!.in.includes(r.workId));
  });
}

async function persist(groups: DedupGroup[]) {
  const { persistDedupGroups } = await import('@/lib/services/works.service');
  await persistDedupGroups(groups);
}

const movedRows = () => prismaMock.workAsin.updateMany.mock.calls.filter((c) => c[0].data.workId !== undefined);

describe('persistDedupGroups: merge rule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('never absorbs an unchecked ASIN: two touched works with outside members do not merge', async () => {
    // W1 = {R1, v1}, W2 = {v1', v2 (out of view)}; the group is {R1, v1'}
    linkRows([
      { asin: 'R1', workId: 'W1' }, { asin: V1, workId: 'W1' },
      { asin: 'V1PRIME', workId: 'W2' }, { asin: V2, workId: 'W2' },
    ]);

    await persist([group(['R1', 'V1PRIME'])]);

    expect(movedRows()).toEqual([]);
    expect(prismaMock.work.deleteMany).not.toHaveBeenCalled();
  });

  it('merges works that lie wholly inside the group, moving by ASIN and deleting only empty works', async () => {
    linkRows([{ asin: 'A', workId: 'W1' }, { asin: 'B', workId: 'W2' }]);

    await persist([group(['A', 'B'])]);

    expect(prismaMock.workAsin.updateMany).toHaveBeenCalledWith({
      where: { asin: { in: ['A', 'B'] }, workId: { in: ['W2'] } },
      data: { workId: 'W1' },
    });
    expect(prismaMock.work.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['W2'] }, asins: { none: {} } } });
  });

  it('merges into the one work that holds outside members', async () => {
    linkRows([{ asin: 'A', workId: 'W1' }, { asin: 'B', workId: 'W2' }, { asin: 'OUT', workId: 'W2' }]);

    await persist([group(['A', 'B'])]);

    expect(prismaMock.workAsin.updateMany).toHaveBeenCalledWith({
      where: { asin: { in: ['A', 'B'] }, workId: { in: ['W1'] } },
      data: { workId: 'W2' },
    });
  });

  it('with two outside works and an unlinked canonical ASIN, writes nothing', async () => {
    linkRows([{ asin: 'B', workId: 'W1' }, { asin: 'X', workId: 'W1' }, { asin: 'C', workId: 'W2' }, { asin: 'Y', workId: 'W2' }]);

    await persist([group(['A', 'B', 'C'])]);

    expect(prismaMock.workAsin.createMany).not.toHaveBeenCalled();
    expect(movedRows()).toEqual([]);
  });

  it('with two outside works, links unlinked group ASINs to the canonical ASIN\'s work', async () => {
    linkRows([{ asin: 'A', workId: 'W1' }, { asin: 'X', workId: 'W1' }, { asin: 'C', workId: 'W2' }, { asin: 'Y', workId: 'W2' }]);

    await persist([group(['A', 'B', 'C'])]);

    expect(prismaMock.workAsin.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ workId: 'W1', asin: 'B', isCanonical: false, source: 'dedup_auto' })],
      skipDuplicates: true,
    });
    expect(movedRows()).toEqual([]);
  });

  it('creates a new work with createMany(skipDuplicates) and deletes it when every row was taken meanwhile', async () => {
    linkRows([]);
    prismaMock.work.create.mockResolvedValue({ id: 'NEW' });
    prismaMock.workAsin.createMany.mockResolvedValue({ count: 0 });

    await persist([group(['A', 'B'])]);

    expect(prismaMock.workAsin.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ workId: 'NEW', asin: 'A', isCanonical: true }),
        expect.objectContaining({ workId: 'NEW', asin: 'B', isCanonical: false }),
      ],
      skipDuplicates: true,
    });
    expect(prismaMock.work.deleteMany).toHaveBeenCalledWith({ where: { id: 'NEW', asins: { none: {} } } });
  });

  it('skips a group whose positions are not settled', async () => {
    await persist([group([V1, V2], { persistable: false })]);
    expect(prismaMock.workAsin.findMany).not.toHaveBeenCalled();
  });

  it('a failing group does not stop the next one', async () => {
    let calls = 0;
    prismaMock.workAsin.findMany.mockImplementation(async () => {
      calls++;
      if (calls === 1) throw new Error('P2002');
      return [];
    });
    prismaMock.work.create.mockResolvedValue({ id: 'NEW' });
    prismaMock.workAsin.createMany.mockResolvedValue({ count: 2 });

    await persist([group(['A', 'B']), group(['C', 'D'])]);

    expect(prismaMock.work.create).toHaveBeenCalledTimes(1);
  });
});

describe('collapseByExistingWorks: series volumes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  const vol = (asin: string, part?: string): AudibleAudiobook =>
    ({ asin, title: 'Die Tagebücher der Apothekerin', author: 'A', seriesAsin: SERIES, seriesPart: part });

  it('keeps vols 1-3 apart when one work links them, with one query and no writes', async () => {
    prismaMock.workAsin.findMany.mockResolvedValue([
      { asin: V1, workId: 'W', isCanonical: true }, { asin: V2, workId: 'W', isCanonical: false }, { asin: V3, workId: 'W', isCanonical: false },
    ]);
    const { collapseByExistingWorks } = await import('@/lib/services/works.service');

    const out = await collapseByExistingWorks([vol(V1, '1'), vol(V2, '2'), vol(V3, '3')]);

    expect(out.map((b) => b.asin)).toEqual([V1, V2, V3]);
    expect(prismaMock.workAsin.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.workAsin.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('still collapses a work whose positions are unknown', async () => {
    prismaMock.workAsin.findMany.mockResolvedValue([{ asin: V1, workId: 'W', isCanonical: true }, { asin: 'R1', workId: 'W', isCanonical: false }]);
    const { collapseByExistingWorks } = await import('@/lib/services/works.service');

    expect(await collapseByExistingWorks([vol(V1), vol('R1')])).toHaveLength(1);
  });

  it('splits on a bare trailing title number (display only)', async () => {
    prismaMock.workAsin.findMany.mockResolvedValue([{ asin: 'A', workId: 'W', isCanonical: true }, { asin: 'B', workId: 'W', isCanonical: false }]);
    const { collapseByExistingWorks } = await import('@/lib/services/works.service');

    const out = await collapseByExistingWorks([
      { asin: 'A', title: 'Title 4', author: 'A' },
      { asin: 'B', title: 'Title 5', author: 'A' },
    ]);
    expect(out).toHaveLength(2);
  });
});
