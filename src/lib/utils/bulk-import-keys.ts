/**
 * Component: Bulk Import Grouping Keys
 * Documentation: documentation/features/bulk-import.md
 */

import type { AudioFileMetadata } from './bulk-import-scanner';

/** Grouping keys of discoveries without title tags start with this (unique per folder). */
export const UNGROUPED_PREFIX = '__ungrouped_';
/** The folder-level group of a folder's untagged files. */
export const UNGROUPED_FOLDER_KEY = `${UNGROUPED_PREFIX}folder`;

/**
 * Build a normalized grouping key from metadata.
 * Used to determine which files belong to the same book.
 * Returns null if metadata has no title (ungroupable by metadata).
 */
export function buildGroupingKey(metadata: AudioFileMetadata): string | null {
  if (!metadata.title) return null;

  const normalize = (s?: string) =>
    (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  return [
    normalize(metadata.title),
    normalize(metadata.author),
    normalize(metadata.narrator),
  ].join('|');
}
