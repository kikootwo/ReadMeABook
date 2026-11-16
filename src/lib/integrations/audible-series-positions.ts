/**
 * Component: Audible Series Positions (fallback when a series page row has no label)
 * Documentation: documentation/integrations/audible.md
 *
 * Series page rows normally carry their position label (#599). Only when the local dedup
 * pass would merge a row that has none does one catalog batch call read the positions,
 * from the `series[]` entry of this very series (not the first entry). Outcomes are cached
 * for 24 h per region:ASIN; after a 429/5xx/timeout, lookups pause for 15 min. A failure
 * leaves positions unknown, which means no veto and no persist.
 */

import { getAudibleService, type AudibleAudiobook } from './audible.service';
import { deduplicateAndCollectGroups } from '../utils/deduplicate-audiobooks';
import { normalizePosition } from '../utils/series-volume';
import { RMABLogger } from '../utils/logger';
import {
  catalogBudget,
  isAbort,
  isTransient,
  SERIES_CACHE_MAX_ENTRIES,
  SERIES_CACHE_TTL_MS,
  SERIES_FILL_COOLDOWN_MS,
  type CatalogSeriesEntry,
  type FetchError,
} from './audible-series-fill';

const logger = RMABLogger.create('Audible.SeriesPositions');

const CATALOG_PRODUCTS = '/1.0/catalog/products';
const CHUNK_SIZE = 50;
/** One attempt within 3 s: the user may be waiting on the page */
const DEADLINE_MS = 3000;

let pausedUntil = 0;
/** region:ASIN -> normalized position (null: the catalog lists none for this series) */
const cache = new Map<string, { position: string | null; expiresAt: number }>();

function remember(key: string, position: string | null): void {
  cache.delete(key);
  cache.set(key, { position, expiresAt: Date.now() + SERIES_CACHE_TTL_MS });
  while (cache.size > SERIES_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function reason(error: FetchError): string {
  const status = error.response?.status;
  if (typeof status === 'number') return `HTTP ${status}`;
  if (isAbort(error)) return `timeout (${DEADLINE_MS / 1000} s)`;
  return typeof error.message === 'string' && error.message ? error.message : String(error);
}

/** Rows the local pass would merge although they have no position */
function mergeCandidates(rows: AudibleAudiobook[]): string[] {
  const positionless = new Set(rows.filter((r) => normalizePosition(r.seriesPart) === undefined).map((r) => r.asin));
  if (positionless.size === 0) return [];
  const { groups } = deduplicateAndCollectGroups(rows);
  return [...new Set(groups.flatMap((g) => g.allAsins.filter((asin) => positionless.has(asin))))];
}

/** One batch call for up to CHUNK_SIZE ASINs; throws on failure */
async function fetchPositions(asins: string[], seriesAsin: string, region: string): Promise<void> {
  const budget = catalogBudget(DEADLINE_MS);
  try {
    const { data: response } = await getAudibleService().fetch(
      CATALOG_PRODUCTS,
      {
        params: { asins: asins.join(','), num_results: asins.length, response_groups: 'series' },
        signal: budget.signal,
        timeout: DEADLINE_MS,
      },
      { catalog: true },
    );
    const products = (response?.data as { products?: Array<{ asin?: string; series?: CatalogSeriesEntry[] }> } | undefined)?.products;
    const byAsin = new Map((Array.isArray(products) ? products : []).map((p) => [p?.asin, p]));
    for (const asin of asins) {
      const entry = byAsin.get(asin)?.series?.find((s) => s?.asin === seriesAsin);
      remember(`${region}:${asin}`, normalizePosition(entry?.sequence) ?? null);
    }
  } finally {
    budget.done();
  }
}

/**
 * Fill missing positions on series page rows (all stamped with `seriesAsin`). Returns the
 * rows unchanged when every row has a label or no merge is proposed (no call). Never throws.
 */
export async function fillSeriesPositions(rows: AudibleAudiobook[], seriesAsin: string): Promise<AudibleAudiobook[]> {
  try {
    return await fill(rows, seriesAsin);
  } catch (error) {
    logger.warn(`Series positions for ${seriesAsin} skipped: ${error instanceof Error ? error.message : String(error)}`);
    return rows;
  }
}

async function fill(rows: AudibleAudiobook[], seriesAsin: string): Promise<AudibleAudiobook[]> {
  const candidates = mergeCandidates(rows);
  if (candidates.length === 0) return rows;

  const region = getAudibleService().getRegion();
  const missing = candidates.filter((asin) => !((cache.get(`${region}:${asin}`)?.expiresAt ?? 0) > Date.now()));

  if (missing.length > 0 && Date.now() < pausedUntil) {
    logger.debug(`Series positions for ${seriesAsin} skipped: Audible catalog lookups are paused`);
  } else {
    for (let i = 0; i < missing.length; i += CHUNK_SIZE) {
      try {
        await fetchPositions(missing.slice(i, i + CHUNK_SIZE), seriesAsin, region);
      } catch (caught) {
        const error = (caught ?? {}) as FetchError;
        if (isTransient(error)) {
          pausedUntil = Date.now() + SERIES_FILL_COOLDOWN_MS;
          logger.warn(`Series position lookups paused for 15 min after: ${reason(error)} (series ${seriesAsin})`);
          break;
        }
        logger.debug(`Series position lookup for ${seriesAsin} failed (${reason(error)}); positions stay unknown`);
      }
    }
  }

  const filled = new Set<string>();
  const out = rows.map((row) => {
    if (!candidates.includes(row.asin)) return row;
    const cached = cache.get(`${region}:${row.asin}`);
    if (!cached || cached.expiresAt <= Date.now() || cached.position === null) return row;
    filled.add(row.asin);
    return { ...row, seriesPart: cached.position };
  });
  logger.debug(`Series ${seriesAsin}: ${candidates.length} unlabelled rows proposed for a merge, ${filled.size} positions found`);
  return out;
}
