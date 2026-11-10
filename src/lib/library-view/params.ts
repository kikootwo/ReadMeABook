/**
 * Component: Library view query params (strict boundary validation)
 * Documentation: documentation/features/library-view.md
 */

import {
  DEFAULT_LIMIT,
  GROUP_MODES,
  MAX_LIMIT,
  MAX_QUERY_LENGTH,
  MAX_REQUESTED_BY,
  NATURAL_ORDER,
  SORT_KEYS,
  SORT_ORDERS,
  SOURCES,
  STATUS_GROUPS,
} from './constants';
import { decodeCursor, filterHashOf, type CursorScope, type SortTuple } from './cursor';
import { fold } from './merge';
import type { LibraryFilters, LibrarySortSpec } from './query';
import type { LibraryGroupMode, LibrarySortKey, LibrarySortOrder, LibrarySource, StatusGroup } from './types';

export interface FullModeParams {
  live: false;
  filters: LibraryFilters;
  spec: LibrarySortSpec;
  scope: CursorScope;
  cursorTuple: SortTuple | null;
  limit: number;
}

export type ParsedParams =
  | { ok: true; params: { live: true } | FullModeParams }
  | { ok: false; error: 'ValidationError' | 'BadCursor' | 'StaleCursor'; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class ParamError extends Error {}

function oneOf<T extends string>(value: string | null, allowed: readonly T[], name: string): T | null {
  if (value === null) return null;
  if (!(allowed as readonly string[]).includes(value)) throw new ParamError(`Invalid ${name}`);
  return value as T;
}

/** A csv of allowed values (deduplicated, sorted); empty items or more than `max` items → error. */
function csv<T extends string>(value: string | null, allowed: readonly T[], max: number, name: string): T[] | null {
  if (value === null) return null;
  const items = value.split(',');
  if (items.length > max) throw new ParamError(`Too many ${name} values (max ${max})`);
  for (const item of items) {
    if (!(allowed as readonly string[]).includes(item)) throw new ParamError(`Invalid ${name}`);
  }
  return [...new Set(items as T[])].sort();
}

function requesterIds(value: string | null): string[] | null {
  if (value === null) return null;
  const items = value.split(',');
  if (items.length > MAX_REQUESTED_BY) throw new ParamError(`Too many requestedBy values (max ${MAX_REQUESTED_BY})`);
  if (!items.every((id) => UUID.test(id))) throw new ParamError('Invalid requestedBy');
  return [...new Set(items.map((id) => id.toLowerCase()))].sort();
}

function limitOf(value: string | null): number {
  if (value === null) return DEFAULT_LIMIT;
  if (!/^\d{1,4}$/.test(value)) throw new ParamError('Invalid limit');
  const n = Number(value);
  if (n < 1 || n > MAX_LIMIT) throw new ParamError(`limit must be 1-${MAX_LIMIT}`);
  return n;
}

export function parseLibraryParams(search: URLSearchParams): ParsedParams {
  try {
    const live = search.get('live');
    if (live !== null) {
      if (live !== '1') throw new ParamError('Invalid live');
      return { ok: true, params: { live: true } };
    }

    const q = search.get('q');
    if (q !== null && q.length > MAX_QUERY_LENGTH) throw new ParamError(`q is longer than ${MAX_QUERY_LENGTH} characters`);
    const folded = fold(q);
    const tokens = folded ? folded.split(' ') : [];

    const status = csv<StatusGroup>(search.get('status'), STATUS_GROUPS, STATUS_GROUPS.length, 'status');
    const source = csv<LibrarySource>(search.get('source'), SOURCES, SOURCES.length, 'source');
    const requestedBy = requesterIds(search.get('requestedBy'));
    const hide = oneOf(search.get('hideAvailable'), ['true', 'false'] as const, 'hideAvailable');
    const group: LibraryGroupMode = oneOf(search.get('group'), GROUP_MODES, 'group') ?? 'none';
    const sortParam = oneOf<LibrarySortKey>(search.get('sort'), SORT_KEYS, 'sort');
    const orderParam = oneOf<LibrarySortOrder>(search.get('order'), SORT_ORDERS, 'order');
    const limit = limitOf(search.get('limit'));

    // group=author forces author asc, title asc
    const sort: LibrarySortKey = group === 'author' ? 'author' : sortParam ?? 'added';
    const order: LibrarySortOrder = group === 'author' ? 'asc' : orderParam ?? NATURAL_ORDER[sort];

    const filters: LibraryFilters = {
      tokens,
      status: status ? new Set(status) : null,
      source: source ? new Set(source) : null,
      requestedBy,
      hideAvailable: hide === 'true',
    };
    const filterHash = filterHashOf({ q: folded, status, source, requestedBy, hideAvailable: filters.hideAvailable });
    const scope: CursorScope = { sort, order, group, filterHash };

    let cursorTuple: SortTuple | null = null;
    const cursor = search.get('cursor');
    if (cursor !== null) {
      const decoded = decodeCursor(cursor, scope);
      if (!decoded.ok) {
        return {
          ok: false,
          error: decoded.error,
          message: decoded.error === 'StaleCursor'
            ? 'The cursor belongs to other filters or sort; start from the first page'
            : 'Invalid cursor',
        };
      }
      cursorTuple = decoded.tuple;
    }

    return { ok: true, params: { live: false, filters, spec: { sort, order, group }, scope, cursorTuple, limit } };
  } catch (error) {
    if (error instanceof ParamError) return { ok: false, error: 'ValidationError', message: error.message };
    throw error;
  }
}
