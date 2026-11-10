/**
 * Component: Shared Torrent Guard Tests (#460, #545)
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * - The queries see another request's row for the same torrent whatever letter case either row stores
 *   the hash in (`findMany` evaluates the `where` with PostgreSQL's default case-sensitive `in`).
 * - `holdOf()`: the shared-torrent table, every state with every ownership of the other request's row.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { evaluateSeeding } from '@/lib/utils/seeding-policy';
import type { HoldCheck, HoldKind, TorrentUser } from '@/lib/utils/shared-torrent';

const prismaMock = createPrismaMock();
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

const guard = () => import('@/lib/utils/shared-torrent');

const HEX = '0123456789abcdef0123456789abcdef01234567';
const B32 = 'AERUKZ4JVPG66AJDIVTYTK6N54ASGRLH';

interface FixtureRequest {
  id: string;
  status: string;
  deletedAt: Date | null;
  downloadHistory: { id: string; torrentHash: string; selected: boolean; downloadStatus?: string | null }[];
}

let requests: FixtureRequest[] = [];

function answerFromFixtures() {
  prismaMock.request.findMany.mockImplementation(async ({ where }) => {
    const { torrentHash, selected } = where.downloadHistory.some;
    const deleted = where.deletedAt !== null;
    return requests
      .filter((r) => r.id !== where.id.not && (r.deletedAt !== null) === deleted)
      .filter((r) => r.downloadHistory.some((h) => h.selected === selected && torrentHash.in.includes(h.torrentHash)))
      .map(({ id }) => id);
  });
}

function request(id: string, torrentHash: string, fields: Partial<FixtureRequest> = {}): FixtureRequest {
  return { id, status: 'downloaded', deletedAt: null, downloadHistory: [{ id: `dh-${id}`, torrentHash, selected: true }], ...fields };
}

beforeEach(() => {
  requests = [];
  answerFromFixtures();
});

describe.each([
  ['otherActiveRequestsSharingTorrent', false],
  ['softDeletedHoldersOfTorrent', true],
] as const)('%s', (name, deleted) => {
  const query = async (requestId: string, hash: string | null) => (await guard())[name](requestId, hash);
  const other = (hash: string) => request('req-b', hash, deleted ? { deletedAt: new Date() } : {});

  it.each([
    ['lower-case hex', 'upper-case hex', HEX, HEX.toUpperCase()],
    ['upper-case hex', 'lower-case hex', HEX.toUpperCase(), HEX],
    ['lower-case hex', 'upper-case base32', HEX, B32],
    ['lower-case hex', 'lower-case base32', HEX, B32.toLowerCase()],
    ['upper-case base32', 'lower-case base32', B32, B32.toLowerCase()],
    ['lower-case base32', 'upper-case hex', B32.toLowerCase(), HEX.toUpperCase()],
  ])('a row stored as %s sees the other request whose row is %s', async (_a, _b, hashA, hashB) => {
    requests = [request('req-a', hashA, { deletedAt: new Date() }), other(hashB)];
    await expect(query('req-a', hashA)).resolves.toEqual(['req-b']);
  });

  it('ignores unselected rows, other torrents and the request itself; nothing without a hash', async () => {
    requests = [
      request('req-a', HEX),
      request('req-unselected', HEX, { deletedAt: deleted ? new Date() : null, downloadHistory: [{ id: 'dh-u', torrentHash: HEX, selected: false }] }),
      request('req-other', 'f'.repeat(40), { deletedAt: deleted ? new Date() : null }),
    ];
    await expect(query('req-a', HEX)).resolves.toEqual([]);
    await expect(query('req-a', null)).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------
// holdOf: the table (request-deletion.md#shared-torrent-holds)
// ---------------------------------------------------------------------------------------------------

const CREATED_AT = new Date('2026-10-01T12:00:00Z');
const ADDED_AT = new Date(CREATED_AT.getTime() + 60 * 1000);
const HOUR = 60 * 60 * 1000;
// 40 minutes seeded: Fast (30 min) met, Slow (600 min) not, Unlimited (no rule) forever
const RULES: Record<string, { seedingTimeMinutes: number } | undefined> = { Fast: { seedingTimeMinutes: 30 }, Slow: { seedingTimeMinutes: 600 } };
const ANSWER = { seedingTime: 40 * 60, ratio: 0 };
const IMPORTED = { status: 'completed', filePath: '/library/Book', completedAt: new Date('2026-10-01T13:00:00Z') };

const VARIANTS: Record<string, Record<string, unknown>> = {
  'added by RMAB': { addedByRmab: true },
  'legacy row inside the window': { addedByRmab: null },
  'legacy row outside the window': { addedByRmab: null, createdAt: new Date(ADDED_AT.getTime() - 2 * HOUR) },
  'taken over': { addedByRmab: false },
  'recorded for another client': { addedByRmab: true, downloadClient: 'transmission' },
};
const OWNS = new Set(['added by RMAB', 'legacy row inside the window']);

type Kind = HoldKind | null;
interface State {
  name: string;
  user: Partial<TorrentUser>;
  row: Record<string, unknown>;
  /** [partial torrent, finished torrent] when the row owns it, and when it does not */
  owned: [Kind, Kind];
  notOwned: [Kind, Kind];
  /** Finished torrent, row recorded for another client, when it differs from `notOwned` */
  otherClient?: Kind;
}

const ACTIVE_FINISHED = { type: 'audiobook', status: 'available', audiobook: IMPORTED };
const NONE: [Kind, Kind] = [null, null];
const STATES: State[] = [
  { name: '1 active, not finished (downloading)', user: { status: 'downloading' }, row: { indexerName: 'Fast' }, owned: ['active', 'active'], notOwned: ['until_met', 'until_met'] },
  { name: '2 active, failed', user: { status: 'failed' }, row: { indexerName: 'Fast' }, owned: ['active', 'active'], notOwned: ['until_met', 'until_met'] },
  { name: '3 finished, own rule not met', user: ACTIVE_FINISHED, row: { indexerName: 'Slow' }, owned: ['active', 'active'], notOwned: ['until_met', 'until_met'] },
  { name: '3 finished, unlimited', user: ACTIVE_FINISHED, row: { indexerName: 'Unlimited' }, owned: ['active', 'active'], notOwned: ['until_met', 'until_met'] },
  { name: '3 finished, no RMAB import since', user: { ...ACTIVE_FINISHED, audiobook: null }, row: { indexerName: 'Fast' }, owned: ['active', 'active'], notOwned: ['until_met', 'until_met'] },
  { name: '4 finished, imported, own rule met', user: ACTIVE_FINISHED, row: { indexerName: 'Fast' }, owned: ['active', null], notOwned: ['until_met', null], otherClient: 'until_met' },
  { name: '5 deleted, own rule not met', user: { deleted: true }, row: { indexerName: 'Slow' }, owned: [null, 'until_met'], notOwned: NONE },
  { name: '6 deleted, own rule met', user: { deleted: true }, row: { indexerName: 'Fast' }, owned: NONE, notOwned: NONE },
  { name: '8 deleted, unlimited', user: { deleted: true }, row: { indexerName: 'Unlimited' }, owned: NONE, notOwned: NONE },
  { name: '11 cancelled, own rule not met', user: { status: 'cancelled' }, row: { indexerName: 'Slow' }, owned: [null, 'until_met'], notOwned: NONE },
  { name: '12 cancelled, unlimited', user: { status: 'cancelled' }, row: { indexerName: 'Unlimited' }, owned: [null, 'forever'], notOwned: NONE },
  { name: '13 cancelled, own rule met', user: { status: 'cancelled' }, row: { indexerName: 'Fast' }, owned: NONE, notOwned: NONE },
  { name: '14 active, every row removed', user: { status: 'downloading' }, row: { indexerName: 'Fast', downloadStatus: 'removed' }, owned: NONE, notOwned: NONE },
  { name: '14 deleted, every row removed', user: { deleted: true }, row: { indexerName: 'Slow', downloadStatus: 'removed' }, owned: NONE, notOwned: NONE },
  { name: '14 cancelled, every row removed', user: { status: 'cancelled' }, row: { indexerName: 'Slow', downloadStatus: 'removed' }, owned: NONE, notOwned: NONE },
];

const CASES = STATES.flatMap((state) => Object.keys(VARIANTS).flatMap((variant) => {
  const expected = OWNS.has(variant) ? state.owned : state.notOwned;
  const finished = variant === 'recorded for another client' && state.otherClient !== undefined ? state.otherClient : expected[1];
  return [
    [state.name, variant, 'partial', expected[0]] as const,
    [state.name, variant, 'finished', finished] as const,
  ];
}));

function user(state: State, variant: string): TorrentUser {
  return {
    id: 'req-b', type: 'audiobook', status: 'downloading', audiobook: null, deleted: false, ...state.user,
    downloadHistory: [{
      id: 'dh-b', indexerId: null, indexerName: null, downloadClient: 'qbittorrent', createdAt: CREATED_AT, downloadStatus: 'completed',
      ...VARIANTS[variant], ...state.row,
    } as TorrentUser['downloadHistory'][number]],
  };
}

const check = (finished: boolean): HoldCheck => ({
  clientType: 'qbittorrent',
  addedAt: ADDED_AT,
  seeding: finished ? (row) => evaluateSeeding(RULES[row.indexerName ?? ''], ANSWER) : null,
});

describe('holdOf', () => {
  it.each(CASES)('%s, row %s, %s torrent: %s', async (stateName, variant, torrent, expected) => {
    const { holdOf } = await guard();
    const state = STATES.find((s) => s.name === stateName)!;
    const hold = holdOf(user(state, variant), check(torrent === 'finished'));
    expect(hold?.kind ?? null).toBe(expected);
    if (hold) expect(hold).toMatchObject({ requestId: 'req-b', reason: expect.any(String) });
  });

  it('a request with one live row among removed ones is judged by the live row', async () => {
    const { holdOf } = await guard();
    const mixed = user(STATES[0], 'added by RMAB');
    mixed.downloadHistory = [{ ...mixed.downloadHistory[0], id: 'dh-gone', downloadStatus: 'removed' }, mixed.downloadHistory[0]];
    expect(holdOf(mixed, check(false))?.kind).toBe('active');
  });

  it('a deleted request with an owned row not met keeps it, whatever its other rows say', async () => {
    const { holdOf } = await guard();
    const holder = user(STATES[6], 'added by RMAB');
    holder.downloadHistory = [{ ...holder.downloadHistory[0], id: 'dh-taken', addedByRmab: false, indexerName: 'Fast' }, holder.downloadHistory[0]];
    expect(holdOf(holder, check(true))?.kind).toBe('until_met');
  });
});

describe('torrentHolds', () => {
  const sibling = { id: 'req-b', status: 'downloading', type: 'audiobook', audiobook: null, downloadHistory: [{ id: 'dh-b', indexerId: 1, indexerName: 'Slow', downloadClient: 'qbittorrent', createdAt: CREATED_AT, downloadStatus: 'downloading', addedByRmab: true }] };
  const holder = { id: 'req-c', downloadHistory: [{ id: 'dh-c', indexerId: 2, indexerName: 'Slow', downloadClient: 'qbittorrent', createdAt: CREATED_AT, downloadStatus: 'completed', addedByRmab: true }] };

  beforeEach(() => {
    prismaMock.request.findMany.mockImplementation(async ({ where }) => (where.deletedAt === null ? [sibling] : [holder]));
  });

  it('reads deleted requests only for a finished torrent', async () => {
    const { torrentHolds } = await guard();
    expect(await torrentHolds('req-a', HEX, check(false))).toEqual([{ requestId: 'req-b', kind: 'active', reason: 'audiobook downloading' }]);
    expect(prismaMock.request.findMany).toHaveBeenCalledTimes(1);

    const holds = await torrentHolds('req-a', HEX, check(true));
    expect(holds.map((h) => [h.requestId, h.kind])).toEqual([['req-b', 'active'], ['req-c', 'until_met']]);
    expect(prismaMock.request.findMany).toHaveBeenCalledTimes(3);
  });

  it('nothing without a hash', async () => {
    const { torrentHolds } = await guard();
    expect(await torrentHolds('req-a', null, check(true))).toEqual([]);
    expect(prismaMock.request.findMany).not.toHaveBeenCalled();
  });
});

describe('markOtherRowsRemoved', () => {
  it.each([
    ['qbittorrent', { OR: [{ downloadClient: null }, { downloadClient: '' }, { downloadClient: 'qbittorrent' }] }],
    ['transmission', { downloadClient: 'transmission' }],
  ])('marks the other requests\' selected live rows for the hash recorded for %s', async (clientType, client) => {
    const { markOtherRowsRemoved } = await guard();
    prismaMock.downloadHistory.updateMany.mockResolvedValue({ count: 2 });
    await expect(markOtherRowsRemoved('req-a', HEX, clientType)).resolves.toBe(2);
    expect(prismaMock.downloadHistory.updateMany).toHaveBeenCalledWith({
      where: {
        requestId: { not: 'req-a' },
        selected: true,
        torrentHash: { in: expect.arrayContaining([HEX, HEX.toUpperCase(), B32]) },
        AND: [{ OR: [{ downloadStatus: null }, { downloadStatus: { not: 'removed' } }] }, client],
      },
      data: { downloadStatus: 'removed' },
    });
  });

  it('nothing without a hash', async () => {
    const { markOtherRowsRemoved } = await guard();
    await expect(markOtherRowsRemoved('req-a', null, 'qbittorrent')).resolves.toBe(0);
    expect(prismaMock.downloadHistory.updateMany).not.toHaveBeenCalled();
  });
});

describe('clearlyPartial', () => {
  it.each([
    ['downloading at 40%', { status: 'downloading', progress: 0.4 }, null, true],
    ['paused at 10%', { status: 'paused', progress: 0.1 }, 'downloading', true],
    ['seeding', { status: 'seeding', progress: 1 }, null, false],
    ['downloading at 100%', { status: 'downloading', progress: 1 }, null, false],
    ['a recheck at 40% (checking)', { status: 'checking', progress: 0.4 }, null, false],
    ['failed at 40%', { status: 'failed', progress: 0.4 }, null, false],
    ['downloading at 40% with a completed time', { status: 'downloading', progress: 0.4, completedAt: new Date() }, null, false],
    ['downloading at 40%, row recorded completed', { status: 'downloading', progress: 0.4 }, 'completed', false],
  ])('%s: %s', async (_label, info, rowStatus, expected) => {
    const { clearlyPartial } = await guard();
    expect(clearlyPartial(info, rowStatus)).toBe(expected);
  });
});
