/**
 * Component: Library Placement Settings (file placement + metadata mode, Audiobookshelf only)
 * Documentation: documentation/features/library-placement.md
 *
 * One set of rules for the settings API, the Paths tab and the organize job. The Paths tab
 * bundles this for the browser, so it must not import node modules.
 */

export type FilePlacement = 'copy' | 'hardlink' | 'hardlink_only';
export type MetadataMode = 'tags' | 'opf' | 'none';
export type BackendMode = 'plex' | 'audiobookshelf';

export const FILE_PLACEMENT_KEY = 'audiobook_file_placement';
export const METADATA_OPF_KEY = 'metadata_opf_enabled';
/** The last book copied because a hard link was not possible ({ title, reason, at }); cleared by a later linked book. */
export const LINK_FALLBACK_KEY = 'audiobook_link_fallback_last';

export const FILE_PLACEMENTS: readonly FilePlacement[] = ['copy', 'hardlink', 'hardlink_only'];

export const FILE_PLACEMENT_LABELS: Record<FilePlacement, string> = {
  copy: 'Copy',
  hardlink: 'Hard link (copy if not possible)',
  hardlink_only: "Hard link only (don't import if not possible)",
};

export const METADATA_MODE_LABELS: Record<MetadataMode, string> = {
  tags: 'Tags in the audio files',
  opf: 'OPF file (metadata.opf)',
  none: 'None (leave files as they are)',
};

export const LINK_NEEDS_OPF_OR_NONE = 'Hard links need Metadata set to OPF file or None.';
export const LINK_NEEDS_MERGE_OFF = 'Turn off chapter merge to use hard links.';

/** The Paths page's one line under disabled hard-link options: only what is missing. */
export function linkBlockedReason(tagging: boolean, merge: boolean): string | null {
  if (tagging && merge) return 'Hard links need Metadata set to OPF file or None, and chapter merge off.';
  if (tagging) return LINK_NEEDS_OPF_OR_NONE;
  return merge ? LINK_NEEDS_MERGE_OFF : null;
}

/** Stored value → placement; absent, unknown or unreadable is today's copy. */
export function parseFilePlacement(value: unknown): FilePlacement {
  return typeof value === 'string' && (FILE_PLACEMENTS as readonly string[]).includes(value) ? (value as FilePlacement) : 'copy';
}

export function isFilePlacement(value: unknown): value is FilePlacement {
  return typeof value === 'string' && (FILE_PLACEMENTS as readonly string[]).includes(value);
}

export function isLinkPlacement(placement: FilePlacement | undefined): boolean {
  return placement === 'hardlink' || placement === 'hardlink_only';
}

/**
 * The Metadata choice the stored keys mean. Tagging wins over OPF, so a pair the
 * Audiobookshelf radio cannot show (both true, e.g. after ticking tagging in Plex
 * mode) reads as Tags everywhere: on the Paths tab and in the organize job.
 */
export function metadataModeOf(tagging: boolean, opf: boolean): MetadataMode {
  if (tagging) return 'tags';
  return opf ? 'opf' : 'none';
}

export interface PlacementState {
  backendMode: BackendMode | string | undefined;
  placement: FilePlacement;
  tagging: boolean;
  merge: boolean;
}

/**
 * Why this combination can't be saved, or null. Audiobookshelf mode only: in Plex
 * mode placement and OPF are hidden and unused, so nothing a Plex admin can see is
 * ever refused because of them.
 */
export function placementConflict(state: PlacementState): string | null {
  if (state.backendMode !== 'audiobookshelf' || !isLinkPlacement(state.placement)) return null;
  if (state.tagging) return LINK_NEEDS_OPF_OR_NONE;
  if (state.merge) return LINK_NEEDS_MERGE_OFF;
  return null;
}

export interface StoredLibrarySettings {
  backendMode: BackendMode | string | undefined;
  placement: FilePlacement;
  tagging: boolean;
  opf: boolean;
}

export interface EffectiveLibrarySettings {
  placement: FilePlacement;
  /** Write tags into the library copies. */
  tagging: boolean;
  /** Write metadata.opf into the book folder. */
  opf: boolean;
  /** What the stored settings asked for that this import does not do, for the job log. */
  notes: string[];
}

/**
 * What one import does. Plex: copy, tags per the tagging key, no OPF. Audiobookshelf:
 * the Metadata mode, and with a hard-link placement no tags (a stored conflict is
 * logged and imported as Metadata None; the organizer also skips merge for links).
 */
export function effectiveLibrarySettings(stored: StoredLibrarySettings): EffectiveLibrarySettings {
  if (stored.backendMode !== 'audiobookshelf') {
    return { placement: 'copy', tagging: stored.tagging, opf: false, notes: [] };
  }
  const mode = metadataModeOf(stored.tagging, stored.opf);
  if (isLinkPlacement(stored.placement) && mode === 'tags') {
    return {
      placement: stored.placement,
      tagging: false,
      opf: false,
      notes: ['Metadata tags are not written to linked books (File placement is a hard link); importing without tags'],
    };
  }
  return { placement: stored.placement, tagging: mode === 'tags', opf: mode === 'opf', notes: [] };
}

export interface LinkFallbackNote {
  title: string;
  reason: string;
  at: string;
}

/** The stored fallback marker, or null when absent or not readable as one. */
export function parseLinkFallbackNote(value: unknown): LinkFallbackNote | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<LinkFallbackNote>;
    if (typeof parsed.title !== 'string' || typeof parsed.reason !== 'string' || typeof parsed.at !== 'string') return null;
    return { title: parsed.title, reason: parsed.reason, at: parsed.at };
  } catch {
    return null;
  }
}
