/**
 * Component: Audible Series Positions (fallback when a series page row has no label)
 * Documentation: documentation/integrations/audible.md
 *
 * Only when local dedup would merge a row without a position label (#599): one catalog
 * batch call reads the `series[]` entry of this very series. 24 h cache per region:ASIN,
 * 15 min pause after a 429/5xx/timeout; a failure leaves positions unknown (no veto, no persist).
 */

import { getAudibleService, type AudibleAudiobook } from './audible.service';
import { deduplicateAndCollectGroups } from '../utils/deduplicate-audiobooks';
import { normalizePosition } from '../utils/series-volume';
import { RMABLogger } from '../utils/logger';
import {
  catalogBudget, isAbort, isTransient, SERIES_CACHE_MAX_ENTRIES, SERIES_CACHE_TTL_MS, SERIES_FILL_COOLDOWN_MS,
  type CatalogSeriesEntry, type FetchError,
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

function cached(key: string): { position: string | null } | undefined {
  const hit = cache.get(key);
  return hit && hit.expiresAt > Date.now() ? hit : undefined;
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
    const params = { asins: asins.join(','), num_results: asins.length, response_groups: 'series' };
    const { data: response } = await getAudibleService().fetch(
      CATALOG_PRODUCTS, { params, signal: budget.signal, timeout: DEADLINE_MS }, { catalog: true });
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

async function fill(rows: AudibleAudiobook[], seriesAsin: string): Promise<AudibleAudiobook[]> {
  const candidates = mergeCandidates(rows);
  if (candidates.length === 0) return rows;

  const region = getAudibleService().getRegion();
  const missing = candidates.filter((asin) => !cached(`${region}:${asin}`));
  if (missing.length > 0 && Date.now() < pausedUntil) {
    logger.debug(`Series positions for ${seriesAsin} skipped: Audible catalog lookups are paused`);
  } else {
    for (let i = 0; i < missing.length; i += CHUNK_SIZE) {
      try {
        await fetchPositions(missing.slice(i, i + CHUNK_SIZE), seriesAsin, region);
      } catch (caught) {
        const error = (caught ?? {}) as FetchError;
        if (!isTransient(error)) {
          logger.debug(`Series position lookup for ${seriesAsin} failed (${reason(error)}); positions stay unknown`);
          continue;
        }
        pausedUntil = Date.now() + SERIES_FILL_COOLDOWN_MS;
        logger.warn(`Series position lookups paused for 15 min after: ${reason(error)} (series ${seriesAsin})`);
        break;
      }
    }
  }

  let found = 0;
  const out = rows.map((row) => {
    const position = candidates.includes(row.asin) ? cached(`${region}:${row.asin}`)?.position : null;
    if (!position) return row;
    found++;
    return { ...row, seriesPart: position };
  });
  logger.debug(`Series ${seriesAsin}: ${candidates.length} unlabelled rows proposed for a merge, ${found} positions found`);
  return out;
}

/**
 * Fill missing positions on series page rows (all stamped with `seriesAsin`). No call when
 * every row has a label or no merge is proposed. Never throws.
 */
export async function fillSeriesPositions(rows: AudibleAudiobook[], seriesAsin: string): Promise<AudibleAudiobook[]> {
  try {
    return await fill(rows, seriesAsin);
  } catch (error) {
    logger.warn(`Series positions for ${seriesAsin} skipped: ${error instanceof Error ? error.message : String(error)}`);
    return rows;
  }
}
