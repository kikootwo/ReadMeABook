/**
 * Component: Library view types (API contract for the Library page)
 * Documentation: documentation/features/library-view.md
 */

import type { GROUP_MODES, SORT_KEYS, SORT_ORDERS, SOURCES, STATUS_GROUPS } from './constants';
import type { BackendMode } from '@/lib/constants/backend-mode';

export type StatusGroup = (typeof STATUS_GROUPS)[number];
export type LibrarySource = (typeof SOURCES)[number];
export type LibrarySortKey = (typeof SORT_KEYS)[number];
export type LibrarySortOrder = (typeof SORT_ORDERS)[number];
export type LibraryGroupMode = (typeof GROUP_MODES)[number];

// ---------------------------------------------------------------------------
// Response shapes (exported for the UI)
// ---------------------------------------------------------------------------

export interface LibraryItemRequest {
  id: string;
  requestedBy: { id: string; username: string };
  isMine: boolean;
  createdAt: string;
  /** Admin or requester only; key omitted otherwise. */
  completedAt?: string | null;
  /** Admin or requester only; key omitted otherwise. */
  errorMessage?: string | null;
  /** Admin or requester only (latest selected download, bytes as a string); key omitted otherwise. */
  downloadSizeBytes?: string | null;
}

export interface LibraryItem {
  /** `req_<audiobookId>` | `lib_<plexLibraryId>`; stable for life. */
  id: string;
  title: string;
  author: string;
  narrator: string | null;
  series: string | null;
  seriesPart: string | null;
  year: number | null;
  durationMinutes: number | null;
  coverUrl: string | null;
  inLibrary: boolean;
  source: LibrarySource;
  /** ISO sort basis: library added_at (fallback row created_at), else request createdAt. */
  addedAt: string;
  /** `available` when in the library, else the primary request status. */
  status: string;
  statusGroup: StatusGroup;
  progress: number | null;
  releaseDate: string | null;
  request: LibraryItemRequest | null;
  /** Has a request and the viewer is admin or its requester. UI hint only. */
  canSeeRequestDetails: boolean;
  /** Admins only (audiobooks.file_path under the ebook rule, else null); key omitted otherwise. */
  path?: string | null;
}

export interface RequestedByFacet {
  userId: string;
  username: string;
  count: number;
  /** Present (true) only for a soft-deleted account. */
  deleted?: true;
}

export interface LibraryResponse {
  items: LibraryItem[];
  nextCursor: string | null;
  /** Entries after all filters. */
  matched: number;
  /** Unfiltered. */
  stats: { total: number; available: number; onTheWay: number; needsALook: number };
  /** Disjunctive: each facet ignores its own filter; hideAvailable and q apply to all. */
  facets: {
    status: Record<StatusGroup, number>;
    source: Record<LibrarySource, number>;
    requestedBy: RequestedByFacet[];
  };
  /** group=author only. */
  groups: { key: string; label: string; count: number }[] | null;
  viewer: { isAdmin: boolean; canFetchEbook?: boolean };
  backend: BackendMode;
  libraryConfigured: boolean;
}

export interface LibraryLiveItem {
  id: string;
  status: string;
  progress: number;
  updatedAt: string;
}

export interface LibraryLiveResponse {
  items: LibraryLiveItem[];
  refreshMs: number;
}

// ---------------------------------------------------------------------------
// Engine shapes (server only)
// ---------------------------------------------------------------------------

export interface LibraryRowRecord {
  id: string;
  plexGuid: string;
  title: string;
  author: string;
  narrator: string | null;
  duration: bigint | null;
  year: number | null;
  asin: string | null;
  addedAt: Date | null;
  createdAt: Date;
  cachedLibraryCoverPath: string | null;
}

export interface RequestRecord {
  id: string;
  audiobookId: string;
  type: string;
  status: string;
  progress: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  releaseDate: Date | null;
  errorMessage: string | null;
  deletedAt: Date | null;
  user: { id: string; plexUsername: string; deletedAt: Date | null };
  audiobook: {
    id: string;
    audibleAsin: string | null;
    title: string;
    author: string;
    narrator: string | null;
    series: string | null;
    seriesPart: string | null;
    year: number | null;
    plexGuid: string | null;
    absItemId: string | null;
    libraryAsin: string | null;
    coverArtUrl: string | null;
  };
}

/** One merged book (pre-serialization). Holds server-only fields; only serialize.ts maps it out. */
export interface LibraryEntry {
  id: string;
  title: string;
  author: string;
  narrator: string | null;
  series: string | null;
  seriesPart: string | null;
  year: number | null;
  durationMinutes: number | null;
  inLibrary: boolean;
  source: LibrarySource;
  addedAtMs: number;
  status: string;
  statusGroup: StatusGroup;
  progress: number | null;
  releaseDate: Date | null;
  row: LibraryRowRecord | null;
  primary: RequestRecord | null;
  /** Folded search text: every public title/author/narrator/series value. */
  haystack: string;
  /** Folded author (sort and group key). */
  authorKey: string;
  titleKey: string;
}

/** Per-page enrichment results, keyed by entry id. */
export interface PageEnrichment {
  covers: Map<string, string | null>;
  sizes: Map<string, string | null>;
  paths: Map<string, string | null>;
}

export interface LibraryViewer {
  id: string;
  isAdmin: boolean;
}
