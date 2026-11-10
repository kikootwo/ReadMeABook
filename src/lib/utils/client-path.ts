/**
 * Component: Download Client Paths (as the client sees them)
 * Documentation: documentation/phase3/file-organization.md
 *
 * Job and category folders a usenet client reports may come from another OS, so they are compared
 * as text: one separator style, `.` and `..` resolved, no trailing separator, a drive-letter path
 * in lower case. Only an absolute path (`/`, a drive letter or UNC) can be compared at all.
 */

import * as path from 'path';

/** True for `/x`, `C:\x` or `C:/x`, and `\\server\share` */
export function isAbsoluteClientPath(p: string): boolean {
  return /^(\/|[a-zA-Z]:\/)/.test(p.trim().replace(/\\/g, '/'));
}

export function normalizeClientPath(p: string): string {
  const unified = p.trim().replace(/\\/g, '/');
  let normalized = path.posix.normalize(unified);
  if (unified.startsWith('//')) normalized = `/${normalized}`; // UNC keeps its double slash
  if (!/^(\/+|[a-zA-Z]:\/)$/.test(normalized)) normalized = normalized.replace(/\/+$/, '');
  return /^[a-zA-Z]:/.test(normalized) ? normalized.toLowerCase() : normalized;
}
