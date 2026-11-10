/**
 * Component: Library view text folding (pure; shared by the API engine and the Library page)
 * Documentation: documentation/features/library-view.md
 */

import { SORT_KEY_LENGTH } from './constants';

/** Case, diacritics and whitespace folded (search tokens, sort and group keys). */
export function fold(value: string | null | undefined): string {
  if (!value) return '';
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** A folded sort/group key, truncated so cursors stay small (the page splits author groups with it). */
export function sortKey(value: string | null | undefined): string {
  return fold(value).slice(0, SORT_KEY_LENGTH);
}
