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

/** What a download records about the indexer it came from. */
export interface IndexerRef {
  indexerId?: number | null;
  indexerName?: string | null;
}

export interface IndexerConfigMatch<T> {
  config: T | undefined;
  /** How the config was found; null when it was not. */
  matchedBy: 'id' | 'name' | null;
}

/**
 * Lookup over the saved `prowlarr_indexers` list. Matches by Prowlarr indexer
 * id first (stable across renames in Prowlarr), then by exact name for
 * downloads recorded without an id, or whose id is no longer configured.
 */
export function createIndexerConfigLookup<T extends { id?: unknown; name?: unknown }>(
  indexers: readonly T[]
): (ref: IndexerRef) => IndexerConfigMatch<T> {
  const byId = new Map<number, T>();
  const byName = new Map<string, T>();
  for (const indexer of indexers) {
    if (typeof indexer.id === 'number' && !byId.has(indexer.id)) byId.set(indexer.id, indexer);
    if (typeof indexer.name === 'string' && !byName.has(indexer.name)) byName.set(indexer.name, indexer);
  }
  return ({ indexerId, indexerName }) => {
    if (typeof indexerId === 'number') {
      const config = byId.get(indexerId);
      if (config) return { config, matchedBy: 'id' };
    }
    if (indexerName) {
      const config = byName.get(indexerName);
      if (config) return { config, matchedBy: 'name' };
    }
    return { config: undefined, matchedBy: null };
  };
}

/** One-off lookup (see createIndexerConfigLookup). */
export function findIndexerConfig<T extends { id?: unknown; name?: unknown }>(
  indexers: readonly T[],
  ref: IndexerRef
): IndexerConfigMatch<T> {
  return createIndexerConfigLookup(indexers)(ref);
}
