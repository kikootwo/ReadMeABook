/**
 * Component: Shared Torrent Guard
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * Several requests can share one torrent (e.g. re-requesting the same book).
 * Before a torrent is removed from the client, every caller (scheduled
 * seeding cleanup, request deletion) checks that no other active request
 * still uses it.
 */

import { prisma } from '../db';
import { torrentHashForms } from '../integrations/qbittorrent-ids';

export interface ActiveRequestRef {
  id: string;
  status: string;
}

/**
 * Active (not deleted) requests other than `requestId` whose selected
 * download is the torrent `torrentHash` (hex and base32 forms match each other). Empty when there is no hash.
 */
export async function otherActiveRequestsUsingTorrent(
  requestId: string,
  torrentHash: string | null | undefined
): Promise<ActiveRequestRef[]> {
  if (!torrentHash) return [];
  return prisma.request.findMany({
    where: {
      id: { not: requestId },
      deletedAt: null,
      downloadHistory: {
        some: {
          torrentHash: { in: torrentHashForms(torrentHash) },
          selected: true,
        },
      },
    },
    select: { id: true, status: true },
  });
}
