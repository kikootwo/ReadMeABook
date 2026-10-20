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

const LIMIT_FIELDS = ['seedingTimeMinutes', 'ratioLimit'] as const;

/**
 * Validation error for an indexer's seeding limits, or null when valid.
 * A limit may be missing (defaults to 0); when present it must be a finite
 * number >= 0.
 */
export function invalidIndexerLimit(input: Record<string, unknown>): string | null {
  for (const field of LIMIT_FIELDS) {
    const value = input[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      const name = typeof input.name === 'string' ? input.name : `indexer ${String(input.id)}`;
      return `${name}: ${field} must be a number of 0 or more`;
    }
  }
  return null;
}
