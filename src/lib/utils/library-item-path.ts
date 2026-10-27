/**
 * Component: Library item paths (RMAB folder vs. Audiobookshelf item path)
 * Documentation: documentation/fixes/file-hash-matching.md
 *
 * One rule for comparing an RMAB book folder with an ABS item's `path`/`relPath`, shared by the
 * request delete (is the ABS item inside the removed folder?) and the delivered-request link (#284).
 */

import * as path from 'path';
import { canonicalPath } from './delete-guard';
import { normalizePath } from './cleanup-helpers';

/** A path as compared with an ABS item path: Unicode NFC, forward slashes, no trailing '/'. */
export function normalizeItemPath(p: string): string {
  return normalizePath(p.normalize('NFC'));
}

/** An ABS `relPath` as compared: normalized, without a leading '/'. */
export function normalizeRelPath(p: string): string {
  return normalizeItemPath(p).replace(/^\/+/, '');
}

/**
 * A canonical `folder` relative to a canonical `dir`, normalized.
 * Null when the folder is the dir itself (empty) or lies outside it (starts with `..`).
 */
export function relativeInside(canonicalFolder: string, canonicalDir: string): string | null {
  const relative = path.posix.relative(canonicalDir, canonicalFolder);
  if (!relative) return null;
  const rel = normalizeItemPath(relative);
  if (!rel || rel === '.' || rel.startsWith('..')) return null;
  return rel;
}

/** `folder` relative to `mediaDir` (both canonicalized first); see relativeInside. */
export async function libraryRelativePath(folder: string, mediaDir: string): Promise<string | null> {
  return relativeInside(await canonicalPath(folder), await canonicalPath(mediaDir));
}
