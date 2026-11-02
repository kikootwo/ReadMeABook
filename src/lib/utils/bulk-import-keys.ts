/**
 * Component: Bulk Import Grouping Keys
 * Documentation: documentation/features/bulk-import.md
 */

import type { AudioFileMetadata } from './bulk-import-scanner';
import { normalizeForMatching } from './match-normalize';

/** Grouping keys of discoveries without title tags start with this (unique per folder). */
export const UNGROUPED_PREFIX = '__ungrouped_';
/** The folder-level group of a folder's untagged files. */
export const UNGROUPED_FOLDER_KEY = `${UNGROUPED_PREFIX}folder`;
/**
 * Keys of files whose title tag has no letter or digit in any script (`' '`, `!!!`).
 * They keep author and narrator, but never merge across folders (unique per folder).
 */
export const NO_TITLE_PREFIX = `${UNGROUPED_PREFIX}notitle|`;

/** Letters, marks and digits of every script, case and accents folded; ASCII keeps exactly a-z0-9. */
const keyPart = (s?: string) => normalizeForMatching(s || '').replace(/[^\p{L}\p{M}\p{N}]/gu, '');

/**
 * Build a normalized grouping key (title|author|narrator) from metadata.
 * Used to determine which files belong to the same book.
 * Returns null if metadata has no title (ungroupable by metadata), and a
 * NO_TITLE_PREFIX key if the title has no letter or digit.
 */
export function buildGroupingKey(metadata: AudioFileMetadata): string | null {
  if (!metadata.title) return null;

  const title = keyPart(metadata.title);
  const people = `${keyPart(metadata.author)}|${keyPart(metadata.narrator)}`;
  return title ? `${title}|${people}` : `${NO_TITLE_PREFIX}${people}`;
}
