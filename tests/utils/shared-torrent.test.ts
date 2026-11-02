/**
 * Component: Shared Torrent Guard Tests (#460)
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * The guard must see another active request's row for the same torrent whatever letter case
 * either row stores the hash in. `findMany` here evaluates the guard's `where` over fixture rows
 * with PostgreSQL's default case-sensitive `in`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

async function otherActiveRequestsUsingTorrent(requestId: string, hash: string | null) {
  const guard = await import('@/lib/utils/shared-torrent');
  return guard.otherActiveRequestsUsingTorrent(requestId, hash);
}

const HEX = '0123456789abcdef0123456789abcdef01234567';
const B32 = 'AERUKZ4JVPG66AJDIVTYTK6N54ASGRLH';

interface FixtureRequest {
  id: string;
  status: string;
  deletedAt: Date | null;
  downloadHistory: { torrentHash: string; selected: boolean }[];
}

let requests: FixtureRequest[] = [];

beforeEach(() => {
  requests = [];
  prismaMock.request.findMany.mockImplementation(async ({ where }) => {
    const { torrentHash, selected } = where.downloadHistory.some;
    return requests
      .filter((r) => r.id !== where.id.not && r.deletedAt === where.deletedAt)
      .filter((r) => r.downloadHistory.some((h) => h.selected === selected && torrentHash.in.includes(h.torrentHash)))
      .map(({ id, status }) => ({ id, status }));
  });
});

function request(id: string, torrentHash: string, fields: Partial<FixtureRequest> = {}): FixtureRequest {
  return { id, status: 'downloaded', deletedAt: null, downloadHistory: [{ torrentHash, selected: true }], ...fields };
}

describe('otherActiveRequestsUsingTorrent', () => {
  it.each([
    ['lower-case hex', 'upper-case hex', HEX, HEX.toUpperCase()],
    ['upper-case hex', 'lower-case hex', HEX.toUpperCase(), HEX],
    ['lower-case hex', 'upper-case base32', HEX, B32],
    ['lower-case hex', 'lower-case base32', HEX, B32.toLowerCase()],
    ['upper-case base32', 'lower-case base32', B32, B32.toLowerCase()],
    ['lower-case base32', 'upper-case hex', B32.toLowerCase(), HEX.toUpperCase()],
  ])('a row stored as %s sees an active request whose row is %s', async (_a, _b, hashA, hashB) => {
    requests = [request('req-a', hashA, { deletedAt: new Date() }), request('req-b', hashB)];
    await expect(otherActiveRequestsUsingTorrent('req-a', hashA)).resolves.toEqual([{ id: 'req-b', status: 'downloaded' }]);
  });

  it('still ignores deleted requests, unselected rows, other torrents and the request itself', async () => {
    requests = [
      request('req-a', HEX),
      request('req-deleted', HEX.toUpperCase(), { deletedAt: new Date() }),
      request('req-unselected', HEX.toUpperCase(), { downloadHistory: [{ torrentHash: HEX.toUpperCase(), selected: false }] }),
      request('req-other', 'f'.repeat(40)),
    ];
    await expect(otherActiveRequestsUsingTorrent('req-a', HEX)).resolves.toEqual([]);
    await expect(otherActiveRequestsUsingTorrent('req-a', null)).resolves.toEqual([]);
  });
});
