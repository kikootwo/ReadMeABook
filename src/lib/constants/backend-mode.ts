/**
 * Component: Library Backend Modes
 * Documentation: documentation/features/audiosilo-integration.md
 *
 * The media servers ReadMeABook can run against, and the few per-backend differences
 * that callers need (which config key holds the library id, where a library item's id is stored).
 */

export type BackendMode = 'plex' | 'audiobookshelf' | 'audiosilo';

export const BACKEND_MODES: readonly BackendMode[] = ['plex', 'audiobookshelf', 'audiosilo'];

export function isBackendMode(value: unknown): value is BackendMode {
  return typeof value === 'string' && (BACKEND_MODES as readonly string[]).includes(value);
}

export function backendLabel(mode: BackendMode): string {
  if (mode === 'plex') return 'Plex';
  if (mode === 'audiosilo') return 'AudioSilo';
  return 'Audiobookshelf';
}

/**
 * Every backend except Plex keeps its item id in `audiobooks.abs_item_id`.
 * The column name predates AudioSilo: for AudioSilo it holds the book's library-relative path.
 */
export function usesItemIdColumn(mode: BackendMode): boolean {
  return mode !== 'plex';
}

/** Configuration key that holds the id of the audiobook library for a backend. */
export function libraryIdConfigKey(mode: BackendMode): string {
  if (mode === 'plex') return 'plex_audiobook_library_id';
  return `${mode}.library_id`;
}

/** Configuration key for "trigger a library scan after each import". */
export function triggerScanConfigKey(mode: BackendMode): string {
  return mode === 'plex' ? 'plex.trigger_scan_after_import' : `${mode}.trigger_scan_after_import`;
}
