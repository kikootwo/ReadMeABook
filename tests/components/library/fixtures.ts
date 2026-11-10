/**
 * Component: Library page test fixtures (items and responses as GET /api/library returns them)
 * Documentation: documentation/features/library-view.md
 */

import type { LibraryItem, LibraryResponse } from '@/lib/library-view/types';

export const ADMIN_VIEWER = { isAdmin: true, canFetchEbook: true } as const;
export const USER_VIEWER = { isAdmin: false } as const;

export function item(overrides: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id: 'req_book-1',
    title: 'Dune',
    author: 'Frank Herbert',
    narrator: 'Scott Brick',
    series: null,
    seriesPart: null,
    year: 1965,
    durationMinutes: 724,
    coverUrl: null,
    inLibrary: false,
    source: 'rmab',
    addedAt: '2026-11-01T10:00:00.000Z',
    status: 'failed',
    statusGroup: 'problem',
    progress: null,
    releaseDate: null,
    request: {
      id: 'request-1',
      requestedBy: { id: 'user-1', username: 'alice' },
      isMine: false,
      createdAt: '2026-11-01T10:00:00.000Z',
    },
    canSeeRequestDetails: false,
    ...overrides,
  };
}

/** A scan-only library book. */
export function scanItem(overrides: Partial<LibraryItem> = {}): LibraryItem {
  return item({
    id: 'lib_row-1',
    title: 'Hyperion',
    author: 'Dan Simmons',
    inLibrary: true,
    source: 'scan',
    status: 'available',
    statusGroup: 'available',
    request: null,
    ...overrides,
  });
}

export function response(items: LibraryItem[], overrides: Partial<LibraryResponse> = {}): LibraryResponse {
  return {
    items,
    nextCursor: null,
    matched: items.length,
    stats: { total: items.length, available: 0, onTheWay: 0, needsALook: 0 },
    facets: {
      status: { available: 0, on_the_way: 0, needs_approval: 0, awaiting_release: 0, problem: 0, denied: 0 },
      source: { scan: 0, rmab: items.length },
      requestedBy: [{ userId: 'user-1', username: 'alice', count: 1 }],
    },
    groups: null,
    viewer: { isAdmin: false },
    backend: 'audiobookshelf',
    libraryConfigured: true,
    ...overrides,
  };
}
