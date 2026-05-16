/**
 * Component: Audible Integration Service
 * Documentation: documentation/integrations/audible.md
 */

import axios, { AxiosInstance } from 'axios';
import { RMAB_USER_AGENT } from '../utils/user-agent';
import * as cheerio from 'cheerio';
import { RMABLogger } from '../utils/logger';
import { getConfigService } from '../services/config.service';
import { AudibleRegion, AUDIBLE_REGIONS, DEFAULT_AUDIBLE_REGION } from '../types/audible';
import {
  getLanguageForRegion,
  isAcceptedLanguage,
  stripPrefixes,
  buildContainsSelector,
  type LanguageConfig,
} from '../constants/language-config';
import {
  pickUserAgent,
  getBrowserHeaders,
  jitteredBackoff,
  AdaptivePacer,
  FetchResultMeta,
} from '../utils/scrape-resilience';
import { parseRuntime as parseRuntimeUtil } from '../utils/parse-runtime';
import { extractAllNarrators } from '../utils/extract-narrator';

const logger = RMABLogger.create('Audible');

const AUDIBLE_PAGE_SIZE = 50;

const CATALOG_RESPONSE_GROUPS =
  'contributors,product_desc,product_attrs,product_extended_attrs,media,rating,series,category_ladders,product_details';

// Retry/backoff knobs for HTML scraping (nightly refresh job only).
// Healthy users still finish quickly — per-page success returns on attempt 0
// with a 2-4s inter-page delay. Struggling users grind through 503 storms
// patiently: up to ~12 retries per request, with each backoff capped at 3 min.
const HTML_MAX_RETRIES = 12;
const HTML_MAX_BACKOFF_MS = 180_000;

export interface AudibleAudiobook {
  asin: string;
  title: string;
  author: string;
  authorAsin?: string;
  narrator?: string;
  description?: string;
  coverArtUrl?: string;
  durationMinutes?: number;
  releaseDate?: string;
  rating?: number;
  genres?: string[];
  series?: string;
  seriesPart?: string;
  seriesAsin?: string;
  language?: string;
  formatType?: string;
  publisherName?: string;
}

export interface AudibleSearchResult {
  query: string;
  results: AudibleAudiobook[];
  totalResults: number;
  page: number;
  hasMore: boolean;
}

export interface AuthorBooksResult {
  books: AudibleAudiobook[];
  hasMore: boolean;
  page: number;
  totalResults: number;
}

interface CatalogProductAuthor {
  asin?: string;
  name: string;
}

interface CatalogProductNarrator {
  name: string;
}

interface CatalogProductSeries {
  asin?: string;
  title?: string;
  sequence?: string;
}

interface CatalogProductLadderNode {
  name: string;
}

interface CatalogProductLadder {
  ladder: CatalogProductLadderNode[];
}

interface CatalogProduct {
  asin: string;
  title?: string;
  authors?: CatalogProductAuthor[];
  narrators?: CatalogProductNarrator[];
  publisher_summary?: string;
  merchandising_summary?: string;
  product_images?: Record<string, string>;
  runtime_length_min?: number;
  release_date?: string;
  language?: string;
  format_type?: string;
  publisher_name?: string;
  rating?: {
    overall_distribution?: {
      display_stars?: number;
    };
  };
  category_ladders?: CatalogProductLadder[];
  series?: CatalogProductSeries[];
}

interface CatalogProductsResponse {
  products: CatalogProduct[];
  total_results?: number;
}

interface CatalogProductResponse {
  product: CatalogProduct;
}

interface CatalogCategoriesResponse {
  categories?: Array<{ id: string; name: string }>;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mapCatalogProduct(product: CatalogProduct): AudibleAudiobook {
  const author = product.authors?.map((a) => a.name).join(', ') ?? '';
  const authorAsin = product.authors?.[0]?.asin ?? undefined;
  const narrator =
    product.narrators && product.narrators.length > 0
      ? product.narrators.map((n) => n.name).join(', ')
      : undefined;

  const rawDescription = product.publisher_summary ?? product.merchandising_summary;
  const description = rawDescription ? stripHtml(rawDescription) : undefined;

  const coverArtUrl = product.product_images?.['500'] ?? undefined;

  const genreNames =
    product.category_ladders?.flatMap((ladder) =>
      ladder.ladder.map((node) => node.name),
    ) ?? [];
  const genres =
    genreNames.length > 0
      ? [...new Set(genreNames)].slice(0, 5)
      : undefined;

  let series: string | undefined;
  let seriesPart: string | undefined;
  let seriesAsin: string | undefined;

  if (product.series && product.series.length > 0) {
    const preferred =
      product.series.find((s) => s.sequence && s.sequence.trim() !== '') ??
      product.series[0];

    series = preferred.title ?? undefined;
    seriesAsin = preferred.asin ?? undefined;

    if (preferred.sequence && preferred.sequence.trim() !== '') {
      const digitMatch = preferred.sequence.match(/\d+(?:\.\d+)?/);
      seriesPart = digitMatch ? digitMatch[0] : preferred.sequence;
    }
  }

  return {
    asin: product.asin,
    title: product.title ?? '',
    author,
    authorAsin,
    narrator,
    description,
    coverArtUrl,
    durationMinutes: product.runtime_length_min ?? undefined,
    releaseDate: product.release_date ?? undefined,
    rating: product.rating?.overall_distribution?.display_stars ?? undefined,
    genres,
    series,
    seriesPart,
    seriesAsin,
    language: product.language ?? undefined,
    formatType: product.format_type ?? undefined,
    publisherName: product.publisher_name ?? undefined,
  };
}

export class AudibleService {
  private htmlClient!: AxiosInstance;
  private apiClient!: AxiosInstance;
  private baseUrl: string = 'https://www.audible.com';
  private region: AudibleRegion = 'us';
  private initialized: boolean = false;
  private sessionUserAgent: string = '';
  private pacer: AdaptivePacer = new AdaptivePacer();

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public getRegion(): AudibleRegion {
    return this.region;
  }

  public async fetch(url: string, config: any = {}): Promise<{ data: any; meta: FetchResultMeta }> {
    await this.initialize();
    return this.fetchWithRetry(url, config);
  }

  public forceReinitialize(): void {
    logger.info('Force re-initializing AudibleService');
    this.initialized = false;
  }

  private async initialize(): Promise<void> {
    if (this.initialized) {
      const configService = getConfigService();
      const currentRegion = await configService.getAudibleRegion();

      if (currentRegion !== this.region) {
        logger.info(`Region changed from ${this.region} to ${currentRegion}, re-initializing`);
        this.initialized = false;
      } else {
        return;
      }
    }

    try {
      const configService = getConfigService();
      this.region = await configService.getAudibleRegion();
      const regionConfig = AUDIBLE_REGIONS[this.region];
      this.baseUrl = regionConfig.baseUrl;
      this.sessionUserAgent = pickUserAgent();
      this.pacer.reset();

      logger.info(`Initializing Audible service with region: ${this.region} (${this.baseUrl})`);

      const langConfig = getLanguageForRegion(this.region);

      this.htmlClient = axios.create({
        baseURL: regionConfig.baseUrl,
        timeout: 15000,
        headers: getBrowserHeaders(this.sessionUserAgent),
        params: {
          ipRedirectOverride: 'true',
          language: langConfig.scraping.audibleLocaleParam,
        },
      });

      this.apiClient = axios.create({
        baseURL: regionConfig.apiBaseUrl,
        timeout: 10000,
        headers: {
          Accept: 'application/json',
          'User-Agent': RMAB_USER_AGENT,
        },
      });

      this.initialized = true;
    } catch (error) {
      logger.error('Failed to initialize AudibleService', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.region = DEFAULT_AUDIBLE_REGION;
      const fallbackConfig = AUDIBLE_REGIONS[this.region];
      this.baseUrl = fallbackConfig.baseUrl;
      this.sessionUserAgent = pickUserAgent();
      this.pacer.reset();

      const fallbackLangConfig = getLanguageForRegion(this.region);

      this.htmlClient = axios.create({
        baseURL: fallbackConfig.baseUrl,
        timeout: 15000,
        headers: getBrowserHeaders(this.sessionUserAgent),
        params: {
          ipRedirectOverride: 'true',
          language: fallbackLangConfig.scraping.audibleLocaleParam,
        },
      });

      this.apiClient = axios.create({
        baseURL: fallbackConfig.apiBaseUrl,
        timeout: 10000,
        headers: {
          Accept: 'application/json',
          'User-Agent': RMAB_USER_AGENT,
        },
      });

      this.initialized = true;
    }
  }

  private async fetchWithRetry(
    url: string,
    config: any = {},
    maxRetries: number = 5,
    client: AxiosInstance = this.htmlClient,
    maxBackoffMs: number = Number.POSITIVE_INFINITY,
  ): Promise<{ data: any; meta: FetchResultMeta }> {
    let lastError: Error | null = null;
    let retriesUsed = 0;
    let encountered503 = false;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await client.get(url, config);
        return { data: response, meta: { retriesUsed, encountered503 } };
      } catch (error: any) {
        lastError = error;
        const status = error.response?.status;
        const isRetryable = !status || status === 503 || status === 429 || status >= 500;

        if (status === 503) encountered503 = true;

        if (!isRetryable) {
          throw error;
        }

        if (attempt === maxRetries) {
          break;
        }

        retriesUsed++;

        const backoffMs = jitteredBackoff(attempt, 1000, maxBackoffMs);
        logger.info(
          ` Request failed (${status || 'network error'}), retrying in ${backoffMs}ms (attempt ${attempt + 1}/${maxRetries})...`,
        );

        await this.delay(backoffMs);
      }
    }

    throw lastError || new Error('Request failed after retries');
  }

  private async externalFetchWithRetry(
    url: string,
    config: any = {},
    maxRetries: number = 3,
  ): Promise<any> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await axios.get(url, config);
      } catch (error: any) {
        lastError = error;
        const status = error.response?.status;
        const isRetryable = !status || status === 503 || status === 429 || status >= 500;

        if (!isRetryable) {
          throw error;
        }

        if (status === 500) {
          const message = error.response?.data?.message || '';
          if (message.includes('Release date is in the future')) {
            logger.info(` External API returned non-retryable error: ${message}`);
            throw error;
          }
        }

        if (attempt === maxRetries) {
          break;
        }

        const backoffMs = Math.pow(2, attempt) * 1000;
        logger.info(
          ` External API request failed (${status || 'network error'}), retrying in ${backoffMs}ms (attempt ${attempt + 1}/${maxRetries})...`,
        );

        await this.delay(backoffMs);
      }
    }

    throw lastError || new Error('External API request failed after retries');
  }

  /**
   * Popular audiobooks from Audible's curated /adblbestsellers HTML page.
   * Uses HTML scraping (not the catalog API) because the API's BestSellers sort
   * is a right-now velocity rank that surfaces launch-day shovelware and preorders;
   * the HTML page reflects Audible's editorial curation.
   */
  async getPopularAudiobooks(limit: number = 20): Promise<AudibleAudiobook[]> {
    await this.initialize();

    logger.info(` Fetching popular audiobooks (limit: ${limit})...`);

    const audiobooks: AudibleAudiobook[] = [];
    let page = 1;
    const maxPages = Math.ceil(limit / AUDIBLE_PAGE_SIZE);

    this.pacer.reset();

    while (audiobooks.length < limit && page <= maxPages) {
      try {
        logger.info(` Fetching page ${page}/${maxPages}...`);

        const { data: response, meta } = await this.fetchWithRetry(
          '/adblbestsellers',
          {
            params: {
              ipRedirectOverride: 'true',
              pageSize: AUDIBLE_PAGE_SIZE,
              ...(page > 1 ? { page } : {}),
            },
          },
          HTML_MAX_RETRIES,
          this.htmlClient,
          HTML_MAX_BACKOFF_MS,
        );

        const foundOnPage = this.parseProductListItems(
          response.data,
          audiobooks,
          limit,
        );

        logger.info(` Found ${foundOnPage} audiobooks on page ${page}`);

        if (foundOnPage < AUDIBLE_PAGE_SIZE / 2) {
          logger.info(` Reached end of available pages`);
          break;
        }

        page++;

        if (page <= maxPages && audiobooks.length < limit) {
          await this.delay(this.pacer.reportPageResult(meta));
        }
      } catch (error) {
        logger.error(`Failed to fetch page ${page} of popular audiobooks`, {
          error: error instanceof Error ? error.message : String(error),
          collectedSoFar: audiobooks.length,
        });
        break;
      }
    }

    logger.info(` Found ${audiobooks.length} popular audiobooks across ${page - 1} pages`);
    return audiobooks;
  }

  /**
   * New release audiobooks from Audible's curated /newreleases HTML page.
   * Uses HTML scraping (not the catalog API) because the API's -ReleaseDate sort
   * returns 100% future preorders with no released-only filter available.
   */
  async getNewReleases(limit: number = 20): Promise<AudibleAudiobook[]> {
    await this.initialize();

    logger.info(` Fetching new releases (limit: ${limit})...`);

    const audiobooks: AudibleAudiobook[] = [];
    let page = 1;
    const maxPages = Math.ceil(limit / AUDIBLE_PAGE_SIZE);

    this.pacer.reset();

    while (audiobooks.length < limit && page <= maxPages) {
      try {
        logger.info(` Fetching page ${page}/${maxPages}...`);

        const { data: response, meta } = await this.fetchWithRetry(
          '/newreleases',
          {
            params: {
              ipRedirectOverride: 'true',
              pageSize: AUDIBLE_PAGE_SIZE,
              ...(page > 1 ? { page } : {}),
            },
          },
          HTML_MAX_RETRIES,
          this.htmlClient,
          HTML_MAX_BACKOFF_MS,
        );

        const foundOnPage = this.parseProductListItems(
          response.data,
          audiobooks,
          limit,
        );

        logger.info(` Found ${foundOnPage} audiobooks on page ${page}`);

        if (foundOnPage < AUDIBLE_PAGE_SIZE / 2) {
          logger.info(` Reached end of available pages`);
          break;
        }

        page++;

        if (page <= maxPages && audiobooks.length < limit) {
          await this.delay(this.pacer.reportPageResult(meta));
        }
      } catch (error) {
        logger.error(`Failed to fetch page ${page} of new releases`, {
          error: error instanceof Error ? error.message : String(error),
          collectedSoFar: audiobooks.length,
        });
        break;
      }
    }

    logger.info(` Found ${audiobooks.length} new releases across ${page - 1} pages`);
    return audiobooks;
  }

  async search(query: string, page: number = 1): Promise<AudibleSearchResult> {
    await this.initialize();

    try {
      logger.info(` Searching for "${query}"...`);

      const { data: response } = await this.fetchWithRetry(
        '/1.0/catalog/products',
        {
          params: {
            keywords: query,
            num_results: AUDIBLE_PAGE_SIZE,
            page: page - 1,
            response_groups: CATALOG_RESPONSE_GROUPS,
          },
        },
        5,
        this.apiClient,
      );

      const envelope: CatalogProductsResponse = response.data;
      const products = envelope.products ?? [];
      const totalResults = envelope.total_results ?? 0;

      const results = products.map(mapCatalogProduct);

      logger.info(` Found ${results.length} results for "${query}"`);

      return {
        query,
        results,
        totalResults,
        page,
        hasMore:
          results.length > 0 &&
          (totalResults > 0
            ? totalResults > page * AUDIBLE_PAGE_SIZE
            : results.length >= AUDIBLE_PAGE_SIZE),
      };
    } catch (error) {
      logger.error('Search failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { query, results: [], totalResults: 0, page, hasMore: false };
    }
  }

  /**
   * The catalog API `author=` param takes an author name (not ASIN), so we filter
   * client-side by checking that at least one author entry matches the target ASIN.
   */
  async searchByAuthorAsin(
    authorName: string,
    authorAsin: string,
    page: number = 1,
  ): Promise<AuthorBooksResult> {
    await this.initialize();

    const langConfig = getLanguageForRegion(this.region);
    const books: AudibleAudiobook[] = [];

    try {
      logger.info(`Searching books by author "${authorName}" (ASIN: ${authorAsin}), page ${page}...`);

      const { data: response } = await this.fetchWithRetry(
        '/1.0/catalog/products',
        {
          params: {
            author: authorName,
            num_results: AUDIBLE_PAGE_SIZE,
            page: page - 1,
            response_groups: CATALOG_RESPONSE_GROUPS,
          },
        },
        5,
        this.apiClient,
      );

      const envelope: CatalogProductsResponse = response.data;
      const products = envelope.products ?? [];
      const totalResults = envelope.total_results ?? 0;

      for (const product of products) {
        const authorMatch = product.authors?.some((a) => a.asin === authorAsin) ?? false;
        if (!authorMatch) continue;

        const langMatch = product.language
          ? isAcceptedLanguage(product.language, langConfig)
          : false;
        if (!langMatch) continue;

        books.push(mapCatalogProduct(product));
      }

      const hasMore =
        books.length > 0 &&
        (totalResults > 0
          ? totalResults > page * AUDIBLE_PAGE_SIZE
          : products.length >= AUDIBLE_PAGE_SIZE);

      logger.info(
        `Author books page ${page}: ${books.length} valid results (${totalResults} Audible total)`,
      );
      return { books, hasMore, page, totalResults };
    } catch (error) {
      logger.error(`Author books search failed for "${authorName}"`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return { books, hasMore: false, page, totalResults: 0 };
    }
  }

  async getAudiobookDetails(asin: string): Promise<AudibleAudiobook | null> {
    await this.initialize();

    try {
      logger.info(` Fetching details for ASIN ${asin}...`);

      const audnexusData = await this.fetchFromAudnexus(asin);
      if (audnexusData) {
        logger.info(` Successfully fetched from Audnexus for "${audnexusData.title}"`);
        return audnexusData;
      }

      logger.info(` Audnexus failed, falling back to Audible catalog API...`);

      return await this.fetchAudibleDetailsFromApi(asin);
    } catch (error) {
      logger.error(`Failed to fetch details for ${asin}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async fetchFromAudnexus(asin: string): Promise<AudibleAudiobook | null> {
    try {
      const audnexusRegion = AUDIBLE_REGIONS[this.region].audnexusParam;
      logger.debug(`Fetching ASIN from Audnexus: ${asin} (region: ${audnexusRegion})`);

      const response = await this.externalFetchWithRetry(
        `https://api.audnex.us/books/${asin}`,
        {
          params: { region: audnexusRegion },
          timeout: 10000,
          headers: { 'User-Agent': 'ReadMeABook/1.0' },
        },
      );

      const data = response.data;

      const result: AudibleAudiobook = {
        asin,
        title: data.title || '',
        author: data.authors?.map((a: any) => a.name).join(', ') || '',
        authorAsin: data.authors?.[0]?.asin || undefined,
        narrator: data.narrators?.map((n: any) => n.name).join(', ') || '',
        description: data.description || data.summary || '',
        coverArtUrl: data.image || '',
        durationMinutes: data.runtimeLengthMin ? parseInt(data.runtimeLengthMin) : undefined,
        releaseDate: data.releaseDate || undefined,
        rating: data.rating ? parseFloat(data.rating) : undefined,
        genres: data.genres?.map((g: any) => (typeof g === 'string' ? g : g.name)).slice(0, 5) || undefined,
        series: data.seriesPrimary?.name || undefined,
        seriesPart: data.seriesPrimary?.position || undefined,
        seriesAsin: data.seriesPrimary?.asin || undefined,
        language: data.language || undefined,
        formatType: data.formatType || undefined,
        publisherName: data.publisherName || undefined,
      };

      if (result.coverArtUrl && !result.coverArtUrl.includes('_SL500_')) {
        result.coverArtUrl = result.coverArtUrl.replace(/\._.*_\./, '._SL500_.');
      }

      logger.debug('Audnexus success', {
        title: result.title,
        author: result.author,
        narrator: result.narrator,
        descLength: result.description?.length || 0,
        duration: result.durationMinutes,
        rating: result.rating,
        genreCount: result.genres?.length || 0,
        series: result.series,
        seriesPart: result.seriesPart,
        seriesAsin: result.seriesAsin,
      });

      return result;
    } catch (error: any) {
      if (error.response?.status === 404) {
        logger.debug(`Book not found (404) on Audnexus for ASIN ${asin}`);
      } else {
        logger.warn(`Error fetching from Audnexus for ASIN ${asin}`, { error: error.message });
      }
      return null;
    }
  }

  private async fetchAudibleDetailsFromApi(asin: string): Promise<AudibleAudiobook | null> {
    try {
      const { data: response } = await this.fetchWithRetry(
        `/1.0/catalog/products/${asin}`,
        { params: { response_groups: CATALOG_RESPONSE_GROUPS } },
        5,
        this.apiClient,
      );

      const envelope: CatalogProductResponse = response.data;
      const product = envelope.product;

      // The API returns HTTP 200 with a stub object for invalid ASINs;
      // a missing title is the reliable signal that the ASIN is unrecognised.
      if (!product?.title) {
        logger.debug(`Catalog API returned stub for ASIN ${asin} (no title)`);
        return null;
      }

      return mapCatalogProduct(product);
    } catch (error) {
      logger.error(`Catalog API details fetch failed for ${asin}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async getRuntime(asin: string): Promise<number | null> {
    try {
      const audnexusRegion = AUDIBLE_REGIONS[this.region].audnexusParam;

      const response = await this.externalFetchWithRetry(
        `https://api.audnex.us/books/${asin}`,
        {
          params: { region: audnexusRegion },
          timeout: 5000,
          headers: { 'User-Agent': 'ReadMeABook/1.0' },
        },
      );

      const runtimeMin = response.data?.runtimeLengthMin;
      if (runtimeMin) {
        return parseInt(runtimeMin);
      }

      return null;
    } catch (error: any) {
      if (error.response?.status !== 404) {
        logger.debug(`Runtime fetch failed for ASIN ${asin}: ${error.message}`);
      }
      return null;
    }
  }

  async getCategories(): Promise<{ id: string; name: string }[]> {
    await this.initialize();

    logger.info('Fetching Audible categories...');

    try {
      const { data: response } = await this.fetchWithRetry(
        '/1.0/catalog/categories',
        {},
        5,
        this.apiClient,
      );

      const envelope: CatalogCategoriesResponse = response.data;
      const categories = (envelope.categories ?? []).map((c) => ({
        id: c.id,
        name: c.name,
      }));

      logger.info(`Found ${categories.length} top-level categories`);
      return categories;
    } catch (error) {
      logger.error('Failed to fetch categories', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Category audiobooks from Audible's HTML /search?node=<categoryId> page,
   * sorted by popularity-rank. Uses HTML scraping (not the catalog API) so
   * results match Audible's curated category-storefront ordering.
   */
  async getCategoryBooks(categoryId: string, limit: number = 200): Promise<AudibleAudiobook[]> {
    await this.initialize();

    logger.info(`Fetching category books for node ${categoryId} (limit: ${limit})...`);

    const audiobooks: AudibleAudiobook[] = [];
    let page = 1;
    const maxPages = Math.ceil(limit / AUDIBLE_PAGE_SIZE);

    this.pacer.reset();

    while (audiobooks.length < limit && page <= maxPages) {
      try {
        const { data: response, meta } = await this.fetchWithRetry(
          '/search',
          {
            params: {
              ipRedirectOverride: 'true',
              node: categoryId,
              pageSize: AUDIBLE_PAGE_SIZE,
              sort: 'popularity-rank',
              ...(page > 1 ? { page } : {}),
            },
          },
          HTML_MAX_RETRIES,
          this.htmlClient,
          HTML_MAX_BACKOFF_MS,
        );

        const foundOnPage = this.parseSearchResultItems(
          response.data,
          audiobooks,
          limit,
        );

        logger.info(`Category ${categoryId}: found ${foundOnPage} books on page ${page}`);

        if (foundOnPage < AUDIBLE_PAGE_SIZE / 2) break;

        page++;

        if (page <= maxPages && audiobooks.length < limit) {
          await this.delay(this.pacer.reportPageResult(meta));
        }
      } catch (error) {
        logger.error(`Failed to fetch category ${categoryId} page ${page}`, {
          error: error instanceof Error ? error.message : String(error),
          collectedSoFar: audiobooks.length,
        });
        break;
      }
    }

    logger.info(
      `Category ${categoryId}: collected ${audiobooks.length} books across ${page - 1} pages`,
    );
    return audiobooks;
  }

  private getLangConfig(): LanguageConfig {
    return getLanguageForRegion(this.region);
  }

  private parseRuntime(runtimeText: string): number | undefined {
    return parseRuntimeUtil(runtimeText, this.getLangConfig());
  }

  /**
   * Parse the `.productListItem` blocks used by /adblbestsellers and /newreleases.
   * Pushes matched books into `audiobooks` (skipping duplicates and respecting `limit`)
   * and returns the count parsed from this page.
   */
  private parseProductListItems(
    html: string,
    audiobooks: AudibleAudiobook[],
    limit: number,
  ): number {
    const $ = cheerio.load(html);
    const langConfig = this.getLangConfig();
    let foundOnPage = 0;

    $('.productListItem').each((_index, element) => {
      if (audiobooks.length >= limit) return false;

      const $el = $(element);

      const asin =
        $el.find('li').attr('data-asin') ||
        $el.find('a').attr('href')?.match(/\/(?:pd|ac)\/[^\/]+\/([A-Z0-9]{10})/)?.[1] ||
        '';
      if (!asin) return;
      if (audiobooks.some((book) => book.asin === asin)) return;

      const title =
        $el.find('h3 a').text().trim() ||
        $el.find('.bc-heading a').text().trim();

      const authorText =
        $el.find('.authorLabel').text().trim() ||
        $el.find('.bc-size-small .bc-text-bold').first().text().trim();

      const authorHref = $el.find('a[href*="/author/"]').first().attr('href') || '';
      const authorAsinMatch = authorHref.match(/\/author\/[^\/]+\/([A-Z0-9]{10})/);

      // Narrator — capture all narrator links (multi-narrator productions are common);
      // fall back to .narratorLabel text, then to the bc-text-bold sibling for layouts
      // that omit both anchor links and the .narratorLabel span.
      const narratorText =
        extractAllNarrators($, $el) ||
        $el.find('.bc-size-small .bc-text-bold').eq(1).text().trim();

      const coverArtUrl = $el.find('img').attr('src') || '';

      const ratingText = $el.find('.ratingsLabel').text().trim();
      const rating = ratingText ? parseFloat(ratingText.split(' ')[0]) : undefined;

      audiobooks.push({
        asin,
        title,
        author: stripPrefixes(authorText, langConfig.scraping.authorPrefixes),
        authorAsin: authorAsinMatch?.[1] || undefined,
        narrator: stripPrefixes(narratorText, langConfig.scraping.narratorPrefixes),
        coverArtUrl: coverArtUrl.replace(/\._.*_\./, '._SL500_.'),
        rating,
      });

      foundOnPage++;
    });

    return foundOnPage;
  }

  /**
   * Parse the `.s-result-item` / `.productListItem` blocks used by
   * /search?node=<categoryId>. Pushes matched books into `audiobooks`
   * (skipping duplicates and respecting `limit`) and returns the count parsed
   * from this page.
   */
  private parseSearchResultItems(
    html: string,
    audiobooks: AudibleAudiobook[],
    limit: number,
  ): number {
    const $ = cheerio.load(html);
    const langConfig = this.getLangConfig();
    let foundOnPage = 0;

    $('.s-result-item, .productListItem').each((_index, element) => {
      if (audiobooks.length >= limit) return false;

      const $el = $(element);

      const asin =
        $el.find('li').attr('data-asin') ||
        $el.find('a').attr('href')?.match(/\/(?:pd|ac)\/[^\/]+\/([A-Z0-9]{10})/)?.[1] ||
        '';
      if (!asin) return;
      if (audiobooks.some((b) => b.asin === asin)) return;

      const title =
        $el.find('h2').first().text().trim() ||
        $el.find('h3 a').text().trim() ||
        $el.find('.bc-heading a').text().trim();

      const authorLink = $el.find('a[href*="/author/"]').first();
      const authorText =
        authorLink.text().trim() ||
        $el.find('.authorLabel').text().trim();
      const authorHref = authorLink.attr('href') || '';
      const authorAsinMatch = authorHref.match(/\/author\/[^\/]+\/([A-Z0-9]{10})/);

      // Narrator — capture all narrator links (multi-narrator productions are common)
      const narratorText = extractAllNarrators($, $el);

      const coverArtUrl = $el.find('img').attr('src') || '';

      const runtimeText =
        $el.find('.runtimeLabel').text().trim() ||
        $el.find(buildContainsSelector('span', langConfig.scraping.lengthLabels)).text().trim();
      const durationMinutes = this.parseRuntime(runtimeText);

      const ratingText =
        $el.find('.ratingsLabel').text().trim() ||
        $el.find('.a-icon-star span').first().text().trim();
      const rating = ratingText ? parseFloat(ratingText.split(' ')[0]) : undefined;

      audiobooks.push({
        asin,
        title,
        author: stripPrefixes(authorText, langConfig.scraping.authorPrefixes),
        authorAsin: authorAsinMatch?.[1] || undefined,
        narrator: stripPrefixes(narratorText, langConfig.scraping.narratorPrefixes),
        coverArtUrl: coverArtUrl.replace(/\._.*_\./, '._SL500_.'),
        durationMinutes,
        rating,
      });

      foundOnPage++;
    });

    return foundOnPage;
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

let audibleService: AudibleService | null = null;

export function getAudibleService(): AudibleService {
  if (!audibleService) {
    audibleService = new AudibleService();
  }
  return audibleService;
}
