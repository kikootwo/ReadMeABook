/**
 * Component: Library view snapshot cache (Load 1, version-keyed, single slot)
 * Documentation: documentation/features/library-view.md
 *
 * Holds the prepared rows (indexes plus scan-only entries) of the active library. Key: backend,
 * library id and libraryRowsVersion (count + max updated_at), read before the rows load so a write
 * that lands mid-load forces a rebuild on the next call. Requests (Load 2) are never cached.
 */

import { RMABLogger } from '@/lib/utils/logger';
import { SNAPSHOT_MAX_AGE_MS } from './constants';
import { libraryRowsVersion, loadLibraryRows } from './loader';
import { prepareLibrary, type PreparedLibrary } from './merge';

const logger = RMABLogger.create('LibraryView.Snapshot');

const EMPTY: PreparedLibrary = prepareLibrary([]);

interface Slot {
  key: string;
  builtAt: number;
  prepared: PreparedLibrary;
}

let slot: Slot | null = null;
let inflight: { key: string; build: number; promise: Promise<PreparedLibrary> } | null = null;
let builds = 0;

/** The prepared library rows for the active library; concurrent misses on one key share a build. */
export async function getPreparedLibrary(backend: string, libraryId: string | null): Promise<PreparedLibrary> {
  if (!libraryId) return EMPTY;
  const key = `${backend}|${libraryId}|${await libraryRowsVersion(libraryId)}`;
  if (slot && slot.key === key && Date.now() - slot.builtAt < SNAPSHOT_MAX_AGE_MS) return slot.prepared;
  if (inflight && inflight.key === key) return inflight.promise;

  const build = ++builds;
  const promise = loadLibraryRows(libraryId).then((rows) => {
    const prepared = prepareLibrary(rows);
    // A build started later for a newer key owns the slot; an older one finishing late does not.
    if (inflight?.build === build) {
      slot = { key, builtAt: Date.now(), prepared };
      inflight = null;
      logger.debug('Library snapshot rebuilt', { libraryId, rows: rows.length });
    }
    return prepared;
  });
  inflight = { key, build, promise };
  promise.catch(() => {
    if (inflight?.build === build) inflight = null;
  });
  return promise;
}

/** Drop the cached snapshot (tests; never needed at runtime since the version key decides). */
export function resetLibrarySnapshot(): void {
  slot = null;
  inflight = null;
}
