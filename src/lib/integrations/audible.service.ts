/**
 * Component: Audible Integration Service
 * Documentation: documentation/integrations/audible.md
 */

import axios, { AxiosInstance } from 'axios';
import { RMABLogger } from '../utils/logger';
import { getConfigService } from '../services/config.service';
import { AudibleRegion, AUDIBLE_REGIONS, DEFAULT_AUDIBLE_REGION } from '../types/audible';
import {
  getLanguageForRegion,
  isAcceptedLanguage,
} from '../constants/language-config';
import {
  pickUserAgent,
  getBrowserHeaders,
  jitteredBackoff,
  randomDelay,
  AdaptivePacer,
  FetchResultMeta,
} from '../utils/scrape-resilience';

const logger = RMABLogger.create('Audible');

const AUDIBLE_PAGE_SIZE = 50;

const CATALOG_RESPONSE_GROUPS =
  'contributors,product_desc,product_attrs,product_extended_attrs,media,rating,series,category_ladders,product_details';

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
          'User-Agent': 'ReadMeABook/1.0',
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
          'User-Agent': 'ReadMeABook/1.0',
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

        const backoffMs = jitteredBackoff(attempt);
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
          '/1.0/catalog/products',
          {
            params: {
              products_sort_by: 'BestSellers',
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
          if (audiobooks.length >= limit) break;
          if (audiobooks.some((b) => b.asin === product.asin)) continue;
          audiobooks.push(mapCatalogProduct(product));
        }

        logger.info(` Found ${products.length} audiobooks on page ${page}`);

        const hasMore =
          totalResults > 0
            ? totalResults > page * AUDIBLE_PAGE_SIZE
            : products.length >= AUDIBLE_PAGE_SIZE;

        if (!hasMore) break;

        page++;

        if (page <= maxPages && audiobooks.length < limit) {
          await this.delay(this.apiPageDelay(meta));
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
          '/1.0/catalog/products',
          {
            params: {
              products_sort_by: '-ReleaseDate',
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
          if (audiobooks.length >= limit) break;
          if (audiobooks.some((b) => b.asin === product.asin)) continue;
          audiobooks.push(mapCatalogProduct(product));
        }

        logger.info(` Found ${products.length} audiobooks on page ${page}`);

        const hasMore =
          totalResults > 0
            ? totalResults > page * AUDIBLE_PAGE_SIZE
            : products.length >= AUDIBLE_PAGE_SIZE;

        if (!hasMore) break;

        page++;

        if (page <= maxPages && audiobooks.length < limit) {
          await this.delay(this.apiPageDelay(meta));
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
          '/1.0/catalog/products',
          {
            params: {
              category_id: categoryId,
              products_sort_by: 'BestSellers',
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
          if (audiobooks.length >= limit) break;
          if (audiobooks.some((b) => b.asin === product.asin)) continue;
          audiobooks.push(mapCatalogProduct(product));
        }

        logger.info(`Category ${categoryId}: found ${products.length} books on page ${page}`);

        const hasMore =
          totalResults > 0
            ? totalResults > page * AUDIBLE_PAGE_SIZE
            : products.length >= AUDIBLE_PAGE_SIZE;

        if (!hasMore) break;

        page++;

        if (page <= maxPages && audiobooks.length < limit) {
          await this.delay(this.apiPageDelay(meta));
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

  private apiPageDelay(meta: FetchResultMeta): number {
    if (meta.retriesUsed > 0) {
      return this.pacer.reportPageResult(meta);
    }
    this.pacer.reportPageResult(meta);
    return randomDelay(500, 1500);
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
