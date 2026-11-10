/**
 * Component: Library view snapshot cache (Load 1: content-keyed, stale while rebuilding, one build per library)
 * Documentation: documentation/features/library-view.md
 *
 * Holds the prepared rows (indexes plus scan-only entries) of the active library, keyed by backend
 * and library id, with the content version (libraryRowsVersion) read before its rows loaded. When
 * the version moves, callers keep getting the current snapshot while ONE rebuild per library runs;
 * a viewer can therefore see library rows up to one rebuild old. A write that lands during a rebuild
 * moves the version again, so the next call starts the rebuild that sees it. Only a library with no
 * snapshot yet (first call, library switch) waits for its build. Holds no request or viewer data.
 */

import { RMABLogger } from '@/lib/utils/logger';
import { libraryRowsVersion, loadLibraryRows } from './loader';
import { prepareLibrary, type PreparedLibrary } from './merge';

const logger = RMABLogger.create('LibraryView.Snapshot');

const EMPTY: PreparedLibrary = prepareLibrary([]);

interface Slot {
  library: string;
  version: string;
  prepared: PreparedLibrary;
}

let slot: Slot | null = null;
/** The library most recently asked for; only its builds may take the slot. */
let current: string | null = null;
const building = new Map<string, Promise<PreparedLibrary>>();

/** Start (or join) the one build for this library. `version` was read before the rows load. */
function rebuild(library: string, libraryId: string, version: string): Promise<PreparedLibrary> {
  const running = building.get(library);
  if (running) return running;
  const promise = loadLibraryRows(libraryId)
    .then((rows) => {
      const prepared = prepareLibrary(rows);
      if (current === library) {
        slot = { library, version, prepared };
        logger.debug('Library snapshot rebuilt', { libraryId, rows: rows.length });
      }
      return prepared;
    })
    .finally(() => {
      if (building.get(library) === promise) building.delete(library);
    });
  building.set(library, promise);
  return promise;
}

/** The prepared rows for the active library (see the header for the staleness bound). */
export async function getPreparedLibrary(backend: string, libraryId: string | null): Promise<PreparedLibrary> {
  if (!libraryId) return EMPTY;
  const library = `${backend}|${libraryId}`;
  current = library;
  const version = await libraryRowsVersion(libraryId);
  if (slot && slot.library === library) {
    if (slot.version !== version) {
      rebuild(library, libraryId, version).catch((error) => {
        logger.warn('Library snapshot rebuild failed; serving the previous snapshot', {
          libraryId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
    return slot.prepared;
  }
  return rebuild(library, libraryId, version);
}

/** Drop the cached snapshot (tests; at runtime the version decides). */
export function resetLibrarySnapshot(): void {
  slot = null;
  current = null;
  building.clear();
}
