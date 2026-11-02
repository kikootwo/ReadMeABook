/**
 * Component: Audiobookshelf item lookups for the delivered-request link (#284)
 * Documentation: documentation/fixes/file-hash-matching.md
 *
 * `GET /api/items/:id`, read for the item's files hash and `isMissing`. Three outcomes: the item,
 * `gone` (ABS answered 404) or `unknown` (any other error, or this run's budget is spent). Every
 * outcome is kept in a process-wide cache (an item 6 h, a failed read 1 h), so a request that never
 * links does not re-read the same items on every 5-minute run.
 */

import { generateFilesHash } from '@/lib/utils/files-hash';
import type { RMABLogger } from '@/lib/utils/logger';

/** At most this many ABS item fetches per run. */
export const LINK_HASH_LOOKUP_BUDGET = 50;
/** How long a read item (or a 404) is reused across runs. */
export const ITEM_CACHE_MS = 6 * 60 * 60 * 1000;
/** How long a failed read is reused across runs before the item is asked for again. */
export const ITEM_ERROR_CACHE_MS = 60 * 60 * 1000;

export interface ItemDetail {
  isMissing: boolean;
  /** files hash of the item's audio file names ('' when it lists none) */
  hash: string;
}

export type ItemLookup = ItemDetail | 'gone' | 'unknown';

interface CachedLookup {
  value: ItemDetail | 'gone' | 'error';
  expires: number;
}

export type ItemCache = Map<string, CachedLookup>;

/** The fields of ABS's GET /api/items/:id that the link reads. */
interface AbsItemFields {
  isMissing?: unknown;
  media?: { audioFiles?: { metadata?: { filename?: unknown } }[] };
}

type Logger = Pick<RMABLogger, 'info' | 'warn' | 'debug'>;

export interface LookupState {
  /** this run's outcomes (each item at most once per run) */
  run: Map<string, ItemLookup>;
  cache: ItemCache;
  now: () => number;
  lookups: number;
  budgetLogged: boolean;
  fetchItem: (id: string) => Promise<unknown>;
  logger: Logger;
}

const processCache: ItemCache = new Map();

/** The cache shared by every run of this process; expired entries are dropped. */
export function sharedItemCache(now = Date.now()): ItemCache {
  for (const [id, entry] of processCache) if (entry.expires <= now) processCache.delete(id);
  return processCache;
}

/** absRequest throws `ABS API error: <status> ...` on a non-2xx answer. */
function isNotFound(error: unknown): boolean {
  return error instanceof Error && /^ABS API error: 404\b/.test(error.message);
}

function toLookup(value: CachedLookup['value']): ItemLookup {
  return value === 'error' ? 'unknown' : value;
}

export async function lookupItem(id: string, state: LookupState): Promise<ItemLookup> {
  const seen = state.run.get(id);
  if (seen) return seen;
  const cached = state.cache.get(id);
  if (cached && cached.expires > state.now()) {
    const lookup = toLookup(cached.value);
    state.run.set(id, lookup);
    return lookup;
  }
  if (state.lookups >= LINK_HASH_LOOKUP_BUDGET) {
    if (!state.budgetLogged) {
      state.budgetLogged = true;
      state.logger.info(`Library link: ${LINK_HASH_LOOKUP_BUDGET} Audiobookshelf item lookups used for this run; the rest wait for the next one`);
    }
    return 'unknown'; // not cached: the next run has a fresh budget
  }
  state.lookups++;
  let value: CachedLookup['value'];
  try {
    const item = (await state.fetchItem(id)) as AbsItemFields | null;
    const names = (item?.media?.audioFiles ?? [])
      .map((f) => f?.metadata?.filename)
      .filter((name): name is string => typeof name === 'string' && name.length > 0);
    value = { isMissing: item?.isMissing === true, hash: generateFilesHash(names) };
  } catch (error) {
    if (isNotFound(error)) {
      value = 'gone';
    } else {
      value = 'error';
      state.logger.warn(`Library link: could not read Audiobookshelf item ${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  state.cache.set(id, { value, expires: state.now() + (value === 'error' ? ITEM_ERROR_CACHE_MS : ITEM_CACHE_MS) });
  const lookup = toLookup(value);
  state.run.set(id, lookup);
  return lookup;
}
