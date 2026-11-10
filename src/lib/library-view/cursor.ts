/**
 * Component: Library view keyset cursor (opaque, strictly decoded)
 * Documentation: documentation/features/library-view.md
 *
 * A cursor is base64url JSON { v, s, o, g, f, k }: sort, order, group, a hash of the filters and the
 * last returned entry's sort tuple (ending with its id). Anything malformed is BadCursor; a valid
 * cursor issued for other sort/order/group/filters is StaleCursor.
 */

import { createHash } from 'crypto';
import { GROUP_MODES, MAX_CURSOR_LENGTH, SORT_KEYS, SORT_ORDERS } from './constants';
import type { LibraryGroupMode, LibrarySortKey, LibrarySortOrder } from './types';

export type SortValue = string | number | null;
export type SortTuple = SortValue[];

export interface CursorScope {
  sort: LibrarySortKey;
  order: LibrarySortOrder;
  group: LibraryGroupMode;
  filterHash: string;
}

export type CursorResult = { ok: true; tuple: SortTuple } | { ok: false; error: 'BadCursor' | 'StaleCursor' };

type Kind = 'string' | 'number' | 'numberOrNull' | 'id';

const ENTRY_ID = /^(req|lib)_[A-Za-z0-9-]{1,64}$/;
const FILTER_HASH = /^[0-9a-f]{16}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** The value kinds of a sort tuple for this sort (the last is always the entry id). */
export function tupleKinds(sort: LibrarySortKey, group: LibraryGroupMode): Kind[] {
  if (group === 'author') return ['string', 'string', 'id'];
  if (sort === 'title' || sort === 'author') return ['string', 'id'];
  if (sort === 'year' || sort === 'duration') return ['numberOrNull', 'id'];
  return ['number', 'id'];
}

function fits(value: unknown, kind: Kind): boolean {
  switch (kind) {
    case 'string':
      return typeof value === 'string' && value.length <= 512;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'numberOrNull':
      return value === null || (typeof value === 'number' && Number.isFinite(value));
    case 'id':
      return typeof value === 'string' && ENTRY_ID.test(value);
  }
}

/** A short stable hash of the normalized filters (sorted lists, folded q). */
export function filterHashOf(filters: unknown): string {
  return createHash('sha256').update(JSON.stringify(filters)).digest('hex').slice(0, 16);
}

export function encodeCursor(scope: CursorScope, tuple: SortTuple): string {
  const body = { v: 1, s: scope.sort, o: scope.order, g: scope.group, f: scope.filterHash, k: tuple };
  return Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string, expected: CursorScope): CursorResult {
  const bad: CursorResult = { ok: false, error: 'BadCursor' };
  if (!raw || raw.length > MAX_CURSOR_LENGTH || !BASE64URL.test(raw)) return bad;

  let body: unknown;
  try {
    body = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return bad;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad;
  const c = body as Record<string, unknown>;
  if (Object.keys(c).sort().join(',') !== 'f,g,k,o,s,v' || c.v !== 1) return bad;
  if (!(SORT_KEYS as readonly unknown[]).includes(c.s)) return bad;
  if (!(SORT_ORDERS as readonly unknown[]).includes(c.o)) return bad;
  if (!(GROUP_MODES as readonly unknown[]).includes(c.g)) return bad;
  if (typeof c.f !== 'string' || !FILTER_HASH.test(c.f)) return bad;

  const kinds = tupleKinds(c.s as LibrarySortKey, c.g as LibraryGroupMode);
  if (!Array.isArray(c.k) || c.k.length !== kinds.length) return bad;
  if (!c.k.every((value, i) => fits(value, kinds[i]))) return bad;

  if (c.s !== expected.sort || c.o !== expected.order || c.g !== expected.group || c.f !== expected.filterHash) {
    return { ok: false, error: 'StaleCursor' };
  }
  return { ok: true, tuple: c.k as SortTuple };
}
