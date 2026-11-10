/**
 * Component: Library view serializer (the single gating choke point)
 * Documentation: documentation/features/library-view.md
 *
 * Builds every response field explicitly (never spreads an engine or Prisma object). Gated keys are
 * omitted, not nulled: completedAt/errorMessage/downloadSizeBytes for admin or requester, path and
 * viewer.canFetchEbook for admins.
 */

import type {
  LibraryEntry,
  LibraryItem,
  LibraryItemRequest,
  LibraryViewer,
  PageEnrichment,
} from './types';

function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

export function serializeItem(entry: LibraryEntry, viewer: LibraryViewer, enrichment: PageEnrichment): LibraryItem {
  const primary = entry.primary;
  const isMine = !!primary && primary.user.id === viewer.id;
  const gated = viewer.isAdmin || isMine;

  let request: LibraryItemRequest | null = null;
  if (primary) {
    request = {
      id: primary.id,
      requestedBy: { id: primary.user.id, username: primary.user.plexUsername },
      isMine,
      createdAt: primary.createdAt.toISOString(),
    };
    if (gated) {
      request.completedAt = iso(primary.completedAt);
      request.errorMessage = primary.errorMessage ?? null;
      request.downloadSizeBytes = enrichment.sizes.get(entry.id) ?? null;
    }
  }

  const item: LibraryItem = {
    id: entry.id,
    title: entry.title,
    author: entry.author,
    narrator: entry.narrator,
    series: entry.series,
    seriesPart: entry.seriesPart,
    year: entry.year,
    durationMinutes: entry.durationMinutes,
    coverUrl: enrichment.covers.get(entry.id) ?? null,
    inLibrary: entry.inLibrary,
    source: entry.source,
    addedAt: new Date(entry.addedAtMs).toISOString(),
    status: entry.status,
    statusGroup: entry.statusGroup,
    progress: entry.progress,
    releaseDate: iso(entry.releaseDate),
    request,
    canSeeRequestDetails: !!primary && gated,
  };
  if (viewer.isAdmin) item.path = enrichment.paths.get(entry.id) ?? null;
  return item;
}
