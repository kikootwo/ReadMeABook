/**
 * Component: Audible Series Fill (catalog series for books Audnexus lists without one)
 * Documentation: documentation/integrations/audible.md
 */

import type { AudibleAudiobook } from './audible.service';
import type { RMABLogger } from '../utils/logger';

export interface CatalogSeriesEntry {
  asin?: string;
  title?: string;
  sequence?: string;
}

type SeriesFields = Pick<AudibleAudiobook, 'series' | 'seriesPart' | 'seriesAsin'>;

/**
 * The series of a catalog product: the first entry with a non-empty sequence, else the
 * first entry. One rule for search, author books, the details fallback and the fill.
 */
export function pickCatalogSeries(entries: CatalogSeriesEntry[] | undefined): SeriesFields {
  let series: string | undefined;
  let seriesPart: string | undefined;
  let seriesAsin: string | undefined;

  if (entries && entries.length > 0) {
    const preferred = entries.find((s) => s.sequence && s.sequence.trim() !== '') ?? entries[0];

    series = preferred.title ?? undefined;
    seriesAsin = preferred.asin ?? undefined;

    if (preferred.sequence && preferred.sequence.trim() !== '') {
      const digitMatch = preferred.sequence.match(/\d+(?:\.\d+)?/);
      seriesPart = digitMatch ? digitMatch[0] : preferred.sequence;
    }
  }

  return { series, seriesPart, seriesAsin };
}

/** How a catalog details fetch retries and fails. */
export interface CatalogFetchProfile {
  maxRetries: number;
  /** Hard per-request deadline: axios `timeout` plus an abort signal (the timeout alone starts only once connected) */
  deadlineMs?: number;
  /** 'log': log at error and return null; 'throw': the caller handles the failure */
  onFailure: 'log' | 'throw';
}

/** Details fallback when Audnexus fails: full retries, failures logged. */
export const DETAILS_FALLBACK_PROFILE: CatalogFetchProfile = { maxRetries: 5, onFailure: 'log' };
/** Series fill: one attempt within 5 s; a transient failure closes the fill gate. */
export const SERIES_FILL_PROFILE: CatalogFetchProfile = { maxRetries: 0, deadlineMs: 5000, onFailure: 'throw' };

/** Request config for the profile's deadline (a fresh signal per call). */
export function catalogDeadline(profile: CatalogFetchProfile): { timeout?: number; signal?: AbortSignal } {
  return profile.deadlineMs ? { timeout: profile.deadlineMs, signal: AbortSignal.timeout(profile.deadlineMs) } : {};
}

/** One deadline shared by every attempt of a call. */
export interface CatalogBudget {
  signal: AbortSignal;
  /** Time left before the deadline, for each attempt's axios `timeout` */
  remainingMs(): number;
  /** Clears the deadline timer once the call has settled */
  done(): void;
}

/**
 * Unlike catalogDeadline, the budget spans retries: the second attempt only gets the
 * time the first one left. The deadline is a plain timer, so tests can drive it.
 */
export function catalogBudget(deadlineMs: number): CatalogBudget {
  const controller = new AbortController();
  const endsAt = Date.now() + deadlineMs;
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  return {
    signal: controller.signal,
    remainingMs: () => Math.max(0, endsAt - Date.now()),
    done: () => clearTimeout(timer),
  };
}

export const SERIES_FILL_COOLDOWN_MS = 15 * 60 * 1000;
export const SERIES_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const SERIES_CACHE_MAX_ENTRIES = 2000;

interface CachedOutcome {
  /** null: the catalog answered with no usable series */
  fields: SeriesFields | null;
  expiresAt: number;
}

export interface FetchError {
  response?: { status?: number };
  code?: unknown;
  name?: unknown;
  isAxiosError?: unknown;
  message?: unknown;
}

const ABORT_CODES = new Set(['ERR_CANCELED', 'ECONNABORTED', 'ETIMEDOUT']);
const ABORT_NAMES = new Set(['CanceledError', 'TimeoutError', 'AbortError']);

/** An abort or a timeout: the request was cut off, it did not fail on its own */
export function isAbort(error: FetchError): boolean {
  return ABORT_CODES.has(error.code as string) || ABORT_NAMES.has(error.name as string);
}

/**
 * Transient: a 429, a 401/403 (blocked), a 5xx, no response (network error) or an
 * abort/timeout. These pause the fill; anything else (another 4xx, a malformed product)
 * is that ASIN's outcome.
 */
function isTransient(error: FetchError): boolean {
  const status = error.response?.status;
  if (typeof status === 'number') return status === 429 || status === 401 || status === 403 || status >= 500;
  return isAbort(error) || error.isAxiosError === true || typeof error.code === 'string';
}

function failureReason(error: FetchError): string {
  const status = error.response?.status;
  if (typeof status === 'number') return `HTTP ${status}`;
  if (isAbort(error)) return `timeout (${(SERIES_FILL_PROFILE.deadlineMs ?? 0) / 1000} s)`;
  return typeof error.message === 'string' && error.message ? error.message : String(error);
}

/**
 * Fills the series of an Audnexus result that has none from the Audible catalog (same
 * ASIN and region). Outcomes are cached for 24 h; after a transient failure, fills pause
 * for 15 min. The details are always returned; a skipped or failed fill leaves the series empty.
 */
export class SeriesFill {
  private pausedUntil = 0;
  private readonly cache = new Map<string, CachedOutcome>();

  constructor(private readonly logger: RMABLogger) {}

  async fill(
    details: AudibleAudiobook,
    region: string,
    loadCatalog: () => Promise<AudibleAudiobook | null>,
  ): Promise<AudibleAudiobook> {
    if (details.series) return details;

    const key = `${region}:${details.asin}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.fields ? { ...details, ...cached.fields } : details;
    }

    if (Date.now() < this.pausedUntil) {
      this.logger.debug(`Series lookup for ${details.asin} skipped: Audible catalog lookups are paused`);
      return details;
    }

    let product: AudibleAudiobook | null;
    try {
      product = await loadCatalog();
    } catch (caught) {
      const error = (caught ?? {}) as FetchError;
      if (!isTransient(error)) {
        this.logger.debug(`Audible catalog series lookup for ${details.asin} failed (${failureReason(error)}); treated as no series`);
        this.remember(key, null);
        return details;
      }
      if (Date.now() >= this.pausedUntil) {
        this.logger.warn(`Series lookups from the Audible catalog paused for 15 min after: ${failureReason(error)} on ${details.asin}`);
      }
      this.pausedUntil = Date.now() + SERIES_FILL_COOLDOWN_MS;
      return details;
    }

    // All three fields from the chosen entry, and only when it has a name
    const fields: SeriesFields | null =
      typeof product?.series === 'string' && product.series.trim() !== ''
        ? { series: product.series, seriesPart: product.seriesPart, seriesAsin: product.seriesAsin }
        : null;
    if (product && !fields) this.logger.debug(`Audible catalog lists no series for ${details.asin}`);
    this.remember(key, fields);

    if (!fields) return details;
    this.logger.info(
      `Series "${fields.series}"${fields.seriesPart ? ` #${fields.seriesPart}` : ''} for ${details.asin} from the Audible catalog (Audnexus had none)`,
    );
    return { ...details, ...fields };
  }

  private remember(key: string, fields: SeriesFields | null): void {
    this.cache.delete(key);
    this.cache.set(key, { fields, expiresAt: Date.now() + SERIES_CACHE_TTL_MS });
    while (this.cache.size > SERIES_CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}
