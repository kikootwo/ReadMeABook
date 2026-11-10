/**
 * Component: Library route test seed (one stack, canaries planted in server-only fields)
 * Documentation: documentation/features/library-view.md
 *
 * The mocked Prisma returns server-only columns even though the loader never selects them, so a
 * serializer that spread a record would leak them; the tests assert none ever appears.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { vi } from 'vitest';
import { NextRequest } from 'next/server';
import { USERS, request, row } from './fixtures';

let installs = 0;

export const CANARY = {
  absFolder: '/audiobookshelf/media/CANARY-abs-folder/Book',
  placedEbook: '/media/ebooks/CANARY-placed-ebook.epub',
  bypass: 'asin_match:awaiting_approval',
  rawLibraryAsin: 'B0RAWCANRY',
  error: 'CANARY download failed: tracker said no',
  adminPath: '/media/audiobooks/CANARY-admin-path/Book',
  requestedCover: 'https://img.example/CANARY-requested-edition.jpg',
};

export const DAVE = { id: '00000000-0000-4000-8000-00000000a0d0', role: 'user' };
export const VIEWERS = {
  admin: { id: USERS.admin.id, role: 'admin' },
  alice: { id: USERS.alice.id, role: 'user' },
  bob: { id: USERS.bob.id, role: 'user' },
  other: DAVE,
};

/** Followed book, followed book with a legacy cover, a scan-only book; requests in each group. */
export function seedStack() {
  const follow = row({ plexGuid: 'abs-follow', asin: 'B0LIBRARY1', title: 'Library Edition', cachedLibraryCoverPath: '/app/cache/library/0123456789abcdef-B0LIBRARY1.jpg', duration: BigInt(7_200_000) });
  const legacy = row({ plexGuid: 'abs-legacy', asin: 'B0ROWASIN2', title: 'Legacy Cover Book', cachedLibraryCoverPath: '/app/cache/library/0123456789abcdef.jpg' });
  const noCover = row({ plexGuid: 'abs-nocover', asin: 'B0ROWASIN3', title: 'No Cover Book' });
  const scan = row({ plexGuid: 'abs-scan', asin: 'B0SCANONLY', title: 'Scan Only Book', cachedLibraryCoverPath: '/app/cache/library/fedcba9876543210-B0SCANONLY.jpg' });
  const rows = [follow, legacy, noCover, scan].map((r) => ({ ...r, filePath: CANARY.absFolder, thumbUrl: 'http://plex/thumb?X-Plex-Token=CANARY' }));

  const serverOnly = { placedEbookFiles: [{ path: CANARY.placedEbook }], approvalBypassedBy: CANARY.bypass, customSearchTerms: 'CANARY terms', ebookAutoRetryCount: 3 };
  const aliceFollowed = request({
    status: 'available', user: USERS.alice, completedAt: new Date('2026-03-01T00:00:00Z'),
    audiobook: { audibleAsin: 'B0REQUEST1', absItemId: 'abs-follow', libraryAsin: 'B0LIBRARY1', coverArtUrl: CANARY.requestedCover },
  });
  const aliceLegacy = request({
    status: 'available', user: USERS.alice,
    audiobook: { audibleAsin: 'B0REQUEST2', absItemId: 'abs-legacy', libraryAsin: CANARY.rawLibraryAsin, coverArtUrl: CANARY.requestedCover },
  });
  const bobNoCover = request({
    status: 'available', user: USERS.bob,
    audiobook: { audibleAsin: 'B0REQUEST3', absItemId: 'abs-nocover', libraryAsin: 'B0ROWASIN3', coverArtUrl: CANARY.requestedCover },
  });
  const bobFailed = request({ status: 'failed', user: USERS.bob, errorMessage: CANARY.error, audiobook: { title: 'Failed Book', audibleAsin: 'B0FAILED01' } });
  const carolPending = request({ status: 'downloading', progress: 42, user: USERS.goneCarol, audiobook: { title: 'Gone Carol Book', audibleAsin: 'B0PENDING1' } });
  const aliceApproval = request({ status: 'awaiting_approval', user: USERS.alice, audiobook: { title: 'Asked Book' } });
  const bobRelease = request({ status: 'awaiting_release', user: USERS.bob, releaseDate: new Date('2027-01-01'), audiobook: { title: 'Future Book' } });
  const aliceDenied = request({ status: 'denied', user: USERS.alice, audiobook: { title: 'Denied Book' } });

  const requests = [aliceFollowed, aliceLegacy, bobNoCover, bobFailed, carolPending, aliceApproval, bobRelease, aliceDenied].map((r) => ({
    ...r,
    ...serverOnly,
    audiobook: { ...r.audiobook, fileFormat: 'epub', filePath: CANARY.adminPath },
  }));

  return { rows, requests, ids: { aliceFollowed, aliceLegacy, bobNoCover, bobFailed, carolPending, follow, scan } };
}

type Mock = ReturnType<typeof vi.fn>;
export interface Mocks {
  prisma: Record<string, any>;
  config: { getBackendMode: Mock; get: Mock; getPlexConfig: Mock };
}

/** Wire the mocks for one stack (mockReset clears implementations before each test). */
export function installStack(m: Mocks, stack = seedStack(), opts: { libraryId?: string | null; ebookSources?: boolean } = {}) {
  const libraryId = opts.libraryId === undefined ? 'abs-lib-1' : opts.libraryId;
  m.config.getBackendMode.mockResolvedValue('audiobookshelf');
  m.config.get.mockImplementation(async (key: string) => {
    if (key === 'audiobookshelf.library_id') return libraryId;
    if (key === 'audiobookshelf.ebook_library_id') return 'abs-ebook-lib';
    if (key === 'ebook_indexer_search_enabled') return opts.ebookSources === false ? 'false' : 'true';
    return null;
  });
  // A new row version per install: the snapshot cache (module state) never carries rows across tests.
  m.prisma.plexLibrary.aggregate ??= vi.fn();
  m.prisma.plexLibrary.aggregate.mockResolvedValue({ _count: { _all: stack.rows.length }, _max: { updatedAt: new Date(++installs) } });
  m.prisma.plexLibrary.findMany.mockResolvedValue(stack.rows);
  m.prisma.request.findMany.mockImplementation(async (args: any) => {
    if (args?.where?.type === 'ebook') return [];
    return stack.requests;
  });
  m.prisma.audibleCache.findMany.mockResolvedValue([
    { asin: 'B0REQUEST3', coverArtUrl: CANARY.requestedCover, durationMinutes: 60 },
    { asin: 'B0FAILED01', coverArtUrl: 'https://img.example/failed.jpg', durationMinutes: 300 },
  ]);
  m.prisma.downloadHistory.findMany.mockResolvedValue([
    { requestId: stack.ids.aliceFollowed.id, torrentSizeBytes: BigInt(9_000_000_000) },
    { requestId: stack.ids.aliceFollowed.id, torrentSizeBytes: BigInt(1) },
    { requestId: stack.ids.bobFailed.id, torrentSizeBytes: BigInt(123) },
  ]);
  m.prisma.audiobook.findMany.mockImplementation(async (args: any) =>
    stack.requests.filter((r) => args.where.id.in.includes(r.audiobookId)).map((r) => ({ id: r.audiobookId, filePath: CANARY.adminPath }))
  );
  return stack;
}

export function get(qs = '', viewer: { id: string; role: string } = VIEWERS.admin, requireAuthMock?: Mock) {
  if (requireAuthMock) {
    requireAuthMock.mockImplementation(async (req: any, handler: any) => {
      req.user = { ...viewer, sub: viewer.id };
      return handler(req);
    });
  }
  return new NextRequest(`http://localhost/api/library${qs ? `?${qs}` : ''}`);
}
