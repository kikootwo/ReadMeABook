/**
 * Component: Saved Indexer Config Normalizer
 * Documentation: documentation/settings-pages.md
 *
 * One mapping for the per-indexer settings stored in `prowlarr_indexers`.
 * Every place that reads, rebuilds or saves those settings (the settings page,
 * GET and PUT /api/admin/settings/prowlarr/indexers, setup completion) goes
 * through toSavedIndexerConfig(), so a field added here round-trips everywhere.
 */

import { DEFAULT_AUDIOBOOK_CATEGORIES, DEFAULT_EBOOK_CATEGORIES } from './torrent-categories';

export const DEFAULT_INDEXER_PRIORITY = 10;

/** Per-indexer settings as persisted in the `prowlarr_indexers` config key. */
export interface SavedIndexerConfig {
  id: number;
  name: string;
  protocol: string;
  priority: number;
  rssEnabled: boolean;
  audiobookCategories: number[];
  ebookCategories: number[];
  seedingTimeMinutes?: number; // Torrents only (0 = no time requirement)
  ratioLimit?: number; // Torrents only (0 = no ratio requirement)
  removeAfterProcessing?: boolean; // Usenet only
}

/** Anything carrying indexer settings: a saved entry, an API payload, UI state. */
export interface IndexerConfigInput {
  id: number;
  name: string;
  protocol: string;
  priority?: number;
  rssEnabled?: boolean;
  audiobookCategories?: number[];
  ebookCategories?: number[];
  categories?: number[]; // Legacy single list, migrated to audiobookCategories
  seedingTimeMinutes?: number;
  ratioLimit?: number;
  removeAfterProcessing?: boolean;
}

export function isTorrentProtocol(protocol: string | undefined | null): boolean {
  return protocol?.toLowerCase() === 'torrent';
}

/**
 * Builds the persisted shape from any indexer settings object.
 * Keeps every per-indexer field for the indexer's protocol and drops
 * UI-only fields (enabled, isAdded, privacy, supportsRss).
 */
export function toSavedIndexerConfig(input: IndexerConfigInput): SavedIndexerConfig {
  const config: SavedIndexerConfig = {
    id: input.id,
    name: input.name,
    protocol: input.protocol,
    priority: input.priority || DEFAULT_INDEXER_PRIORITY,
    rssEnabled: input.rssEnabled === true,
    audiobookCategories:
      input.audiobookCategories || input.categories || [...DEFAULT_AUDIOBOOK_CATEGORIES],
    ebookCategories: input.ebookCategories || [...DEFAULT_EBOOK_CATEGORIES],
  };

  if (isTorrentProtocol(input.protocol)) {
    config.seedingTimeMinutes = input.seedingTimeMinutes ?? 0;
    config.ratioLimit = input.ratioLimit ?? 0;
  } else {
    config.removeAfterProcessing = input.removeAfterProcessing ?? true;
  }

  return config;
}

/**
 * Parse the saved `prowlarr_indexers` value. Returns null when it is not a
 * JSON array: callers must then leave downloads alone rather than treat every
 * indexer as unconfigured (which would mean "seed forever" and drop records).
 */
export function parseSavedIndexers(raw: string | null | undefined): unknown[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** What a download records about the indexer it came from. */
export interface IndexerRef {
  indexerId?: number | null;
  indexerName?: string | null;
  /** The download's protocol (from its client type); an id match of another protocol is ignored. */
  protocol?: string | null;
}

export interface IndexerConfigMatch<T> {
  config: T | undefined;
  /** How the config was found; null when it was not. */
  matchedBy: 'id' | 'name' | null;
  /**
   * Set when the recorded id pointed at a different indexer and was not used:
   * 'name-conflict' (the recorded name is another configured indexer) or
   * 'protocol-mismatch' (the id is now an indexer of another protocol).
   */
  idIgnored?: 'name-conflict' | 'protocol-mismatch';
}

type IndexerLike = { id?: unknown; name?: unknown; protocol?: unknown };

const sameProtocol = (config: IndexerLike, protocol: string | null | undefined) =>
  !protocol || typeof config.protocol !== 'string' || config.protocol.toLowerCase() === protocol.toLowerCase();

/**
 * Lookup over the saved `prowlarr_indexers` list for a download.
 *
 * - The Prowlarr indexer id is preferred: it survives a rename in Prowlarr.
 * - But Prowlarr ids are reused (a rebuilt or replaced Prowlarr numbers from
 *   1 again), so the id is not used when the recorded name is a DIFFERENT
 *   configured indexer (the name wins), or when the id now belongs to an
 *   indexer of another protocol.
 * - Downloads without an id, or whose id is not configured, match by exact name.
 *
 * An id reused while the indexer it meant is gone (no name match) still
 * matches by id: that cannot be told apart from a rename.
 */
export function createIndexerConfigLookup<T extends IndexerLike>(
  indexers: readonly T[]
): (ref: IndexerRef) => IndexerConfigMatch<T> {
  const byId = new Map<number, T>();
  const byName = new Map<string, T>();
  for (const indexer of indexers) {
    if (!indexer || typeof indexer !== 'object') continue;
    if (typeof indexer.id === 'number' && !byId.has(indexer.id)) byId.set(indexer.id, indexer);
    if (typeof indexer.name === 'string' && !byName.has(indexer.name)) byName.set(indexer.name, indexer);
  }
  return ({ indexerId, indexerName, protocol }) => {
    const byNameMatch = indexerName ? byName.get(indexerName) : undefined;
    const byIdMatch = typeof indexerId === 'number' ? byId.get(indexerId) : undefined;
    let idIgnored: IndexerConfigMatch<T>['idIgnored'];

    if (byIdMatch) {
      if (!sameProtocol(byIdMatch, protocol)) {
        idIgnored = 'protocol-mismatch';
      } else if (byNameMatch && byNameMatch !== byIdMatch && byIdMatch.name !== indexerName) {
        // The id's indexer has another name and the recorded name is a different indexer: a reused id.
        // (Two saved entries sharing the recorded name are not a conflict: the id picks between them.)
        idIgnored = 'name-conflict';
      } else {
        return { config: byIdMatch, matchedBy: 'id' };
      }
    }
    // Name matching is unchanged from before ids were used: protocol is not checked
    if (byNameMatch) {
      return { config: byNameMatch, matchedBy: 'name', ...(idIgnored ? { idIgnored } : {}) };
    }
    return { config: undefined, matchedBy: null, ...(idIgnored ? { idIgnored } : {}) };
  };
}

/** One-off lookup (see createIndexerConfigLookup). */
export function findIndexerConfig<T extends IndexerLike>(
  indexers: readonly T[],
  ref: IndexerRef
): IndexerConfigMatch<T> {
  return createIndexerConfigLookup(indexers)(ref);
}

/** Warning text for a download whose recorded id was not used, or null. */
export function describeIgnoredIndexerId(ref: IndexerRef, match: IndexerConfigMatch<unknown>): string | null {
  if (!match.idIgnored) return null;
  const why = match.idIgnored === 'name-conflict'
    ? `belongs to another configured indexer than "${ref.indexerName}"`
    : `is now an indexer of another protocol than this ${ref.protocol} download`;
  return `Indexer id ${ref.indexerId} recorded for "${ref.indexerName}" ${why} (Prowlarr ids are reused after a rebuild); `
    + (match.matchedBy === 'name' ? 'using the settings matched by name' : 'no settings matched, treated as unlimited');
}
