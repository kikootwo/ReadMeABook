/**
 * Component: Audible Integration Service (Web Scraping)
 * Documentation: documentation/integrations/audible.md
 */

import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import { RMABLogger } from '../utils/logger';
import { getConfigService } from '../services/config.service';
import { AudibleRegion, AUDIBLE_REGIONS, DEFAULT_AUDIBLE_REGION } from '../types/audible';
import {
  getLanguageForRegion,
  stripPrefixes,
  buildContainsSelector,
  extractByPatterns,
  isAcceptedLanguage,
  type LanguageConfig,
} from '../constants/language-config';
import {
  pickUserAgent,
  getBrowserHeaders,
  jitteredBackoff,
  AdaptivePacer,
  FetchResultMeta,
} from '../utils/scrape-resilience';

// Module-level logger
const logger = RMABLogger.create('Audible');

/**
 * Audible supports a pageSize query parameter (default ~20).
 * Using 50 significantly reduces the number of HTTP requests needed
 * for bulk operations like popular/new-release refreshes and search.
 */
const AUDIBLE_PAGE_SIZE = 50;

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
}

export interface AudibleSearchResult {
  query: string;
  results: AudibleAudiobook[];
  totalResults: number;
  page: number;
  hasMore: boolean;
}

export class AudibleService {
  private client!: AxiosInstance;
  private baseUrl: string = 'https://www.audible.com';
  private region: AudibleRegion = 'us';
  private initialized: boolean = false;
  private sessionUserAgent: string = '';
  private pacer: AdaptivePacer = new AdaptivePacer();

  constructor() {
    // Client will be created lazily on first use
  }

  /**
   * Get the current Audible base URL for the configured region
   */
  public getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Get the language config for the current region
   */
  private getLangConfig(): LanguageConfig {
    return getLanguageForRegion(this.region);
  }

  /**
   * Force re-initialization (used when region config changes)
   */
  public forceReinitialize(): void {
    logger.info('Force re-initializing AudibleService');
    this.initialized = false;
  }

  /**
   * Initialize service with configured region
   * Lazy initialization allows async config loading
   * Automatically re-initializes if region has changed
   */
  private async initialize(): Promise<void> {
    // If already initialized, check if region has changed
    if (this.initialized) {
      const configService = getConfigService();
      const currentRegion = await configService.getAudibleRegion();

      // If region changed, force re-initialization
      if (currentRegion !== this.region) {
        logger.info(`Region changed from ${this.region} to ${currentRegion}, re-initializing`);
        this.initialized = false;
      } else {
        return; // Region unchanged, use existing initialization
      }
    }

    try {
      const configService = getConfigService();
      this.region = await configService.getAudibleRegion();
      this.baseUrl = AUDIBLE_REGIONS[this.region].baseUrl;
      this.sessionUserAgent = pickUserAgent();
      this.pacer.reset();

      logger.info(`Initializing Audible service with region: ${this.region} (${this.baseUrl})`);

      // Get language config for the region
      const langConfig = getLanguageForRegion(this.region);

      // Create axios client with region-specific base URL and realistic browser headers
      this.client = axios.create({
        baseURL: this.baseUrl,
        timeout: 15000,
        headers: getBrowserHeaders(this.sessionUserAgent),
        params: {
          ipRedirectOverride: 'true', // Prevent IP-based region redirects
          language: langConfig.scraping.audibleLocaleParam, // Force locale (prevents IP-based language serving)
        },
      });

      this.initialized = true;
    } catch (error) {
      logger.error('Failed to initialize AudibleService', { error: error instanceof Error ? error.message : String(error) });
      // Fallback to default region
      this.region = DEFAULT_AUDIBLE_REGION;
      this.baseUrl = AUDIBLE_REGIONS[this.region].baseUrl;
      this.sessionUserAgent = pickUserAgent();
      this.pacer.reset();

      const fallbackLangConfig = getLanguageForRegion(this.region);

      this.client = axios.create({
        baseURL: this.baseUrl,
        timeout: 15000,
        headers: getBrowserHeaders(this.sessionUserAgent),
        params: {
          ipRedirectOverride: 'true',
          language: fallbackLangConfig.scraping.audibleLocaleParam,
        },
      });
      this.initialized = true;
    }
  }

  /**
   * Fetch with retry logic and jittered exponential backoff.
   * Returns the axios response plus metadata about retries encountered.
   */
  private async fetchWithRetry(
    url: string,
    config: any = {},
    maxRetries: number = 5
  ): Promise<{ data: any; meta: FetchResultMeta }> {
    let lastError: Error | null = null;
    let retriesUsed = 0;
    let encountered503 = false;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.client.get(url, config);
        return { data: response, meta: { retriesUsed, encountered503 } };
      } catch (error: any) {
        lastError = error;
        const status = error.response?.status;
        const isRetryable = !status || status === 503 || status === 429 || status >= 500;

        if (status === 503) encountered503 = true;

        // Don't retry on 404, 403, etc.
        if (!isRetryable) {
          throw error;
        }

        // Don't retry on last attempt
        if (attempt === maxRetries) {
          break;
        }

        retriesUsed++;

        // Jittered exponential backoff instead of predictable doubling
        const backoffMs = jitteredBackoff(attempt);
        logger.info(` Request failed (${status || 'network error'}), retrying in ${backoffMs}ms (attempt ${attempt + 1}/${maxRetries})...`);

        await this.delay(backoffMs);
      }
    }

    // All retries exhausted
    throw lastError || new Error('Request failed after retries');
  }

  /**
   * External API fetch with retry logic and exponential backoff
   * Used for Audnexus and other external APIs
   */
  private async externalFetchWithRetry(
    url: string,
    config: any = {},
    maxRetries: number = 3
  ): Promise<any> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await axios.get(url, config);
      } catch (error: any) {
        lastError = error;
        const status = error.response?.status;
        const isRetryable = !status || status === 503 || status === 429 || status >= 500;

        // Don't retry on 404, 403, etc.
        if (!isRetryable) {
          throw error;
        }

        // Don't retry on last attempt
        if (attempt === maxRetries) {
          break;
        }

        // Exponential backoff: 2^attempt * 1000ms (1s, 2s, 4s...)
        const backoffMs = Math.pow(2, attempt) * 1000;
        logger.info(` External API request failed (${status || 'network error'}), retrying in ${backoffMs}ms (attempt ${attempt + 1}/${maxRetries})...`);

        await this.delay(backoffMs);
      }
    }

    // All retries exhausted
    throw lastError || new Error('External API request failed after retries');
  }

  /**
   * Get popular audiobooks from best sellers (with pagination support)
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

        const { data: response, meta } = await this.fetchWithRetry('/adblbestsellers', {
          params: {
            ipRedirectOverride: 'true', // Explicitly include to prevent IP-based region redirects
            pageSize: AUDIBLE_PAGE_SIZE,
            ...(page > 1 ? { page } : {}),
          },
        });
        const $ = cheerio.load(response.data);

        let foundOnPage = 0;

        // Parse audiobook items from best sellers page
        $('.productListItem').each((index, element) => {
          if (audiobooks.length >= limit) return false;

          const $el = $(element);

          // Extract ASIN from data attribute or link - handle both /pd/ and /ac/ URLs
          const asin = $el.find('li').attr('data-asin') ||
                       $el.find('a').attr('href')?.match(/\/(?:pd|ac)\/[^\/]+\/([A-Z0-9]{10})/)?.[1] || '';

          if (!asin) return;

          // Skip duplicates
          if (audiobooks.some(book => book.asin === asin)) return;

          const title = $el.find('h3 a').text().trim() ||
                        $el.find('.bc-heading a').text().trim();

          const authorText = $el.find('.authorLabel').text().trim() ||
                             $el.find('.bc-size-small .bc-text-bold').first().text().trim();

          // Extract author ASIN from author link if available
          const authorHref = $el.find('a[href*="/author/"]').first().attr('href') || '';
          const authorAsinMatch = authorHref.match(/\/author\/[^\/]+\/([A-Z0-9]{10})/);

          const narratorText = $el.find('.narratorLabel').text().trim() ||
                               $el.find('.bc-size-small .bc-text-bold').eq(1).text().trim();

          const coverArtUrl = $el.find('img').attr('src') || '';

          const ratingText = $el.find('.ratingsLabel').text().trim();
          const rating = ratingText ? parseFloat(ratingText.split(' ')[0]) : undefined;

          const langConfig = this.getLangConfig();

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

        logger.info(` Found ${foundOnPage} audiobooks on page ${page}`);

        // If we got significantly fewer than requested, probably no more pages
        if (foundOnPage < AUDIBLE_PAGE_SIZE / 2) {
          logger.info(` Reached end of available pages`);
          break;
        }

        page++;

        // Adaptive delay between pages based on retry pressure
        if (page <= maxPages && audiobooks.length < limit) {
          await this.delay(this.pacer.reportPageResult(meta));
        }
      } catch (error) {
        logger.error(`Failed to fetch page ${page} of popular audiobooks`, {
          error: error instanceof Error ? error.message : String(error),
          collectedSoFar: audiobooks.length
        });
        // Stop pagination on error, but return what we collected
        break;
      }
    }

    logger.info(` Found ${audiobooks.length} popular audiobooks across ${page - 1} pages`);
    return audiobooks;
  }

  /**
   * Get new release audiobooks (with pagination support)
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

        const { data: response, meta } = await this.fetchWithRetry('/newreleases', {
          params: {
            ipRedirectOverride: 'true', // Explicitly include to prevent IP-based region redirects
            pageSize: AUDIBLE_PAGE_SIZE,
            ...(page > 1 ? { page } : {}),
          },
        });
        const $ = cheerio.load(response.data);

        let foundOnPage = 0;

        // Parse audiobook items from new releases page
        $('.productListItem').each((index, element) => {
          if (audiobooks.length >= limit) return false;

          const $el = $(element);

          // Extract ASIN from data attribute or link - handle both /pd/ and /ac/ URLs
          const asin = $el.find('li').attr('data-asin') ||
                       $el.find('a').attr('href')?.match(/\/(?:pd|ac)\/[^\/]+\/([A-Z0-9]{10})/)?.[1] || '';

          if (!asin) return;

          // Skip duplicates
          if (audiobooks.some(book => book.asin === asin)) return;

          const title = $el.find('h3 a').text().trim() ||
                        $el.find('.bc-heading a').text().trim();

          const authorText = $el.find('.authorLabel').text().trim() ||
                             $el.find('.bc-size-small .bc-text-bold').first().text().trim();

          // Extract author ASIN from author link if available
          const authorHref = $el.find('a[href*="/author/"]').first().attr('href') || '';
          const authorAsinMatch = authorHref.match(/\/author\/[^\/]+\/([A-Z0-9]{10})/);

          const narratorText = $el.find('.narratorLabel').text().trim();

          const coverArtUrl = $el.find('img').attr('src') || '';

          const ratingText = $el.find('.ratingsLabel').text().trim();
          const rating = ratingText ? parseFloat(ratingText.split(' ')[0]) : undefined;

          const langConfig = this.getLangConfig();

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

        logger.info(` Found ${foundOnPage} audiobooks on page ${page}`);

        // If we got significantly fewer than requested, probably no more pages
        if (foundOnPage < AUDIBLE_PAGE_SIZE / 2) {
          logger.info(` Reached end of available pages`);
          break;
        }

        page++;

        // Adaptive delay between pages based on retry pressure
        if (page <= maxPages && audiobooks.length < limit) {
          await this.delay(this.pacer.reportPageResult(meta));
        }
      } catch (error) {
        logger.error(`Failed to fetch page ${page} of new releases`, {
          error: error instanceof Error ? error.message : String(error),
          collectedSoFar: audiobooks.length
        });
        // Stop pagination on error, but return what we collected
        break;
      }
    }

    logger.info(` Found ${audiobooks.length} new releases across ${page - 1} pages`);
    return audiobooks;
  }

  /**
   * Search for audiobooks
   */
  async search(query: string, page: number = 1): Promise<AudibleSearchResult> {
    await this.initialize();

    try {
      logger.info(` Searching for "${query}"...`);

      const { data: response } = await this.fetchWithRetry('/search', {
        params: {
          ipRedirectOverride: 'true', // Explicitly include to prevent IP-based region redirects
          keywords: query,
          pageSize: AUDIBLE_PAGE_SIZE,
          page,
        },
      });

      const $ = cheerio.load(response.data);

      const audiobooks: AudibleAudiobook[] = [];

      // Parse search results - Audible uses s-result-item for search pages
      $('.s-result-item, .productListItem').each((index, element) => {
        const $el = $(element);

        // Extract ASIN from product detail link - handle both /pd/ and /ac/ URLs
        const asin = $el.find('li').attr('data-asin') ||
                     $el.find('a[href*="/pd/"]').attr('href')?.match(/\/pd\/[^\/]+\/([A-Z0-9]{10})/)?.[1] ||
                     $el.find('a[href*="/ac/"]').attr('href')?.match(/\/ac\/[^\/]+\/([A-Z0-9]{10})/)?.[1] ||
                     $el.find('a').attr('href')?.match(/\/(?:pd|ac)\/[^\/]+\/([A-Z0-9]{10})/)?.[1] || '';

        if (!asin) return;

        // Extract title from h2 tag (search results) or h3 (legacy)
        const title = $el.find('h2').first().text().trim() ||
                      $el.find('h3 a').text().trim() ||
                      $el.find('.bc-heading a').text().trim();

        // Extract author from author link
        const authorLink = $el.find('a[href*="/author/"]').first();
        const authorText = authorLink.text().trim() ||
                           $el.find('.authorLabel').text().trim() ||
                           $el.find('.bc-size-small .bc-text-bold').first().text().trim();

        // Extract author ASIN from author link href
        const authorHref = authorLink.attr('href') || '';
        const authorAsinMatch = authorHref.match(/\/author\/[^\/]+\/([A-Z0-9]{10})/);

        // Extract narrator from narrator search link
        const narratorText = $el.find('a[href*="searchNarrator="]').first().text().trim() ||
                             $el.find('.narratorLabel').text().trim();

        const coverArtUrl = $el.find('img').attr('src') || '';

        const langConfig = this.getLangConfig();

        // Extract runtime/duration
        const runtimeText = $el.find('.runtimeLabel').text().trim() ||
                           $el.find(buildContainsSelector('span', langConfig.scraping.lengthLabels)).text().trim();
        const durationMinutes = this.parseRuntime(runtimeText);

        // Extract rating
        const ratingText = $el.find('.ratingsLabel').text().trim() ||
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
      });

      // Try to extract total results count
      const resultsText = $('.resultsInfo').text().trim();
      const totalResults = parseInt(resultsText.match(/of ([\d,]+)/)?.[1]?.replace(/,/g, '') || '0');

      logger.info(` Found ${audiobooks.length} results for "${query}"`);

      return {
        query,
        results: audiobooks,
        totalResults,
        page,
        hasMore: audiobooks.length > 0 && totalResults > page * AUDIBLE_PAGE_SIZE,
      };
    } catch (error) {
      logger.error('Search failed', { error: error instanceof Error ? error.message : String(error) });
      return {
        query,
        results: [],
        totalResults: 0,
        page,
        hasMore: false,
      };
    }
  }

  /**
   * Search for all books by a specific author, validated by ASIN.
   * Uses Audible's searchAuthor parameter and paginates through all results.
   * Filters: (1) author link must contain the target ASIN, (2) language must be English.
   */
  async searchByAuthorAsin(authorName: string, authorAsin: string): Promise<AudibleAudiobook[]> {
    await this.initialize();

    const MAX_PAGES = 10;
    const allBooks: AudibleAudiobook[] = [];
    const seenAsins = new Set<string>();

    try {
      logger.info(`Searching books by author "${authorName}" (ASIN: ${authorAsin})...`);

      for (let page = 1; page <= MAX_PAGES; page++) {
        const { data: response, meta } = await this.fetchWithRetry('/search', {
          params: {
            ipRedirectOverride: 'true',
            searchAuthor: authorName,
            pageSize: AUDIBLE_PAGE_SIZE,
            page,
          },
        });

        const $ = cheerio.load(response.data);
        let pageResults = 0;

        $('.s-result-item, .productListItem').each((_index, element) => {
          const $el = $(element);

          // --- Language filter: require matching language for region ---
          const langConfig = this.getLangConfig();
          const langText = $el.find(buildContainsSelector('span', langConfig.scraping.languageLabels)).text().trim() ||
                           $el.find('.languageLabel').text().trim();
          // Extract language value (e.g. "Language: English" -> "English", "Sprache: Deutsch" -> "Deutsch")
          const langLabelPattern = new RegExp(`(?:${langConfig.scraping.languageLabels.map(l => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*(.+)`, 'i');
          const langMatch = langText.match(langLabelPattern);
          const language = langMatch?.[1]?.trim();
          if (!language || !isAcceptedLanguage(language, langConfig)) return;

          // --- Author ASIN filter: verify target ASIN in author links ---
          const authorLinks = $el.find('a[href*="/author/"]');
          let hasMatchingAuthor = false;
          authorLinks.each((_i, link) => {
            const href = $(link).attr('href') || '';
            const asinMatch = href.match(/\/author\/[^\/]+\/([A-Z0-9]{10})/);
            if (asinMatch && asinMatch[1] === authorAsin) {
              hasMatchingAuthor = true;
              return false; // break .each()
            }
          });
          if (!hasMatchingAuthor) return;

          // --- Extract book ASIN ---
          const bookAsin = $el.find('li').attr('data-asin') ||
                           $el.find('a[href*="/pd/"]').attr('href')?.match(/\/pd\/[^\/]+\/([A-Z0-9]{10})/)?.[1] ||
                           $el.find('a[href*="/ac/"]').attr('href')?.match(/\/ac\/[^\/]+\/([A-Z0-9]{10})/)?.[1] ||
                           $el.find('a').attr('href')?.match(/\/(?:pd|ac)\/[^\/]+\/([A-Z0-9]{10})/)?.[1] || '';
          if (!bookAsin || seenAsins.has(bookAsin)) return;
          seenAsins.add(bookAsin);

          // --- Parse book details ---
          const title = $el.find('h2').first().text().trim() ||
                        $el.find('h3 a').text().trim() ||
                        $el.find('.bc-heading a').text().trim();

          const authorText = $el.find('a[href*="/author/"]').first().text().trim() ||
                             $el.find('.authorLabel').text().trim() ||
                             $el.find('.bc-size-small .bc-text-bold').first().text().trim();

          const narratorText = $el.find('a[href*="searchNarrator="]').first().text().trim() ||
                               $el.find('.narratorLabel').text().trim();

          const coverArtUrl = $el.find('img').attr('src') || '';

          const runtimeText = $el.find('.runtimeLabel').text().trim() ||
                              $el.find(buildContainsSelector('span', langConfig.scraping.lengthLabels)).text().trim();
          const durationMinutes = this.parseRuntime(runtimeText);

          const ratingText = $el.find('.ratingsLabel').text().trim() ||
                             $el.find('.a-icon-star span').first().text().trim();
          const rating = ratingText ? parseFloat(ratingText.split(' ')[0]) : undefined;

          allBooks.push({
            asin: bookAsin,
            title,
            author: stripPrefixes(authorText, langConfig.scraping.authorPrefixes),
            authorAsin,
            narrator: stripPrefixes(narratorText, langConfig.scraping.narratorPrefixes),
            coverArtUrl: coverArtUrl.replace(/\._.*_\./, '._SL500_.'),
            durationMinutes,
            rating,
          });

          pageResults++;
        });

        // Check if there are more pages
        const resultsText = $('.resultsInfo').text().trim();
        const totalResults = parseInt(resultsText.match(/of ([\d,]+)/)?.[1]?.replace(/,/g, '') || '0');
        const hasMore = totalResults > page * AUDIBLE_PAGE_SIZE;

        logger.info(`Author books page ${page}: ${pageResults} valid results (${allBooks.length} total, ${totalResults} Audible total)`);

        if (!hasMore || pageResults === 0) break;

        // Pace between pages
        if (page < MAX_PAGES) {
          await this.delay(this.pacer.reportPageResult(meta));
        }
      }

      logger.info(`Author books search complete: "${authorName}" → ${allBooks.length} books`);
      return allBooks;
    } catch (error) {
      logger.error(`Author books search failed for "${authorName}"`, {
        error: error instanceof Error ? error.message : String(error),
        collectedSoFar: allBooks.length,
      });
      // Return what we collected before the error
      return allBooks;
    }
  }

  /**
   * Get detailed audiobook information
   * Primary: Audnexus API (reliable, structured data)
   * Fallback: Audible scraping
   */
  async getAudiobookDetails(asin: string): Promise<AudibleAudiobook | null> {
    await this.initialize();

    try {
      logger.info(` Fetching details for ASIN ${asin}...`);

      // Try Audnexus first (more reliable)
      const audnexusData = await this.fetchFromAudnexus(asin);
      if (audnexusData) {
        logger.info(` Successfully fetched from Audnexus for "${audnexusData.title}"`);
        return audnexusData;
      }

      logger.info(` Audnexus failed, falling back to Audible scraping...`);

      // Fallback to Audible scraping
      return await this.scrapeAudibleDetails(asin);
    } catch (error) {
      logger.error(`Failed to fetch details for ${asin}`, { error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  /**
   * Fetch audiobook details from Audnexus API
   */
  private async fetchFromAudnexus(asin: string): Promise<AudibleAudiobook | null> {
    try {
      const audnexusRegion = AUDIBLE_REGIONS[this.region].audnexusParam;
      logger.debug(`Fetching ASIN from Audnexus: ${asin} (region: ${audnexusRegion})`);

      const response = await this.externalFetchWithRetry(`https://api.audnex.us/books/${asin}`, {
        params: {
          region: audnexusRegion, // Pass region parameter to Audnexus
        },
        timeout: 10000,
        headers: {
          'User-Agent': 'ReadMeABook/1.0',
        },
      });

      const data = response.data;

      // Build result from Audnexus data
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
        genres: data.genres?.map((g: any) => typeof g === 'string' ? g : g.name).slice(0, 5) || undefined,
        series: data.seriesPrimary?.name || undefined,
        seriesPart: data.seriesPrimary?.position || undefined,
      };

      // Ensure cover art URL is high quality
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
        seriesPart: result.seriesPart
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

  /**
   * Scrape audiobook details from Audible (fallback method)
   */
  private async scrapeAudibleDetails(asin: string): Promise<AudibleAudiobook | null> {
    try {
      const { data: response } = await this.fetchWithRetry(`/pd/${asin}`, {
        params: {
          ipRedirectOverride: 'true', // Explicitly include to prevent IP-based region redirects
        },
      });
      const $ = cheerio.load(response.data);

      // Initialize result object
      let result: AudibleAudiobook = {
        asin,
        title: '',
        author: '',
        narrator: '',
        description: '',
        coverArtUrl: '',
      };

      // Debug: Save HTML in development
      const isDev = process.env.NODE_ENV === 'development';
      if (isDev) {
        const fs = require('fs');
        const path = require('path');
        const debugPath = path.join('/tmp', `audible-${asin}.html`);
        fs.writeFileSync(debugPath, response.data);
        logger.info(` Saved HTML to ${debugPath} for debugging`);
      }

      // Try to extract JSON-LD structured data first
      const jsonLdScripts = $('script[type="application/ld+json"]');
      logger.info(` Found ${jsonLdScripts.length} JSON-LD script tags`);

      jsonLdScripts.each((i, elem) => {
        try {
          const jsonData = JSON.parse($(elem).html() || '{}');
          logger.info(` JSON-LD ${i} type:`, jsonData['@type']);

          if (jsonData['@type'] === 'Book' || jsonData['@type'] === 'Audiobook' || jsonData['@type'] === 'Product') {
            logger.debug('Found valid JSON-LD structured data');

            if (jsonData.name) result.title = jsonData.name;

            if (jsonData.author) {
              result.author = Array.isArray(jsonData.author)
                ? jsonData.author.map((a: any) => a.name || a).join(', ')
                : jsonData.author?.name || jsonData.author || '';
            }

            if (jsonData.readBy) {
              result.narrator = Array.isArray(jsonData.readBy)
                ? jsonData.readBy.map((n: any) => n.name || n).join(', ')
                : jsonData.readBy?.name || jsonData.readBy || '';
            }

            if (jsonData.description) result.description = jsonData.description;
            if (jsonData.image) result.coverArtUrl = jsonData.image;
            if (jsonData.aggregateRating?.ratingValue) result.rating = jsonData.aggregateRating.ratingValue;
            if (jsonData.datePublished) result.releaseDate = jsonData.datePublished;

            if (jsonData.duration) {
              const durationMatch = jsonData.duration.match(/PT(\d+)H(\d+)M/);
              if (durationMatch) {
                result.durationMinutes = parseInt(durationMatch[1]) * 60 + parseInt(durationMatch[2]);
              }
            }
          }
        } catch (e) {
          logger.debug(`JSON-LD ${i} parsing failed`, { error: e instanceof Error ? e.message : String(e) });
        }
      });

      // Fallback to HTML parsing for any missing fields
      // Title - try multiple selectors
      if (!result.title) {
        result.title = $('h1.bc-heading').first().text().trim() ||
                      $('h1[class*="heading"]').first().text().trim() ||
                      $('.bc-container h1').first().text().trim() ||
                      $('h1').first().text().trim();
        logger.info(` Title from HTML: "${result.title}"`);
      }

      // Author - try multiple approaches (only in product details area)
      if (!result.author) {
        // Look specifically in the product details section, not the whole page
        const productSection = $('.bc-section, .product-top-section, [class*="product"]').first();
        const authors: string[] = [];

        // First try labeled author sections
        productSection.find('li.authorLabel a, span.authorLabel a, .authorLabel a').each((_, elem) => {
          const text = $(elem).text().trim();
          if (text && text.length > 0 && text.length < 80) {
            authors.push(text);
          }
        });

        // If no labeled authors, look for author links near the title (first 3 only to avoid recommendations)
        if (authors.length === 0) {
          $('a[href*="/author/"]').slice(0, 3).each((_, elem) => {
            const text = $(elem).text().trim();
            // Filter out navigation breadcrumbs and promotional text
            if (text && text.length > 1 && text.length < 80 &&
                !text.includes('›') && !text.includes('...') &&
                !text.toLowerCase().includes('more') && !text.toLowerCase().includes('see all')) {
              authors.push(text);
            }
          });
        }

        if (authors.length > 0) {
          // Deduplicate and limit to max 3 authors
          result.author = [...new Set(authors)].slice(0, 3).join(', ');
        }

        const authorLangConfig = this.getLangConfig();
        result.author = stripPrefixes(result.author, authorLangConfig.scraping.authorPrefixes);
        logger.info(` Author from HTML: "${result.author}"`);
      }

      // Author ASIN - extract from the first author link
      if (!result.authorAsin) {
        const firstAuthorHref = $('a[href*="/author/"]').first().attr('href') || '';
        const authorAsinMatch = firstAuthorHref.match(/\/author\/[^\/]+\/([A-Z0-9]{10})/);
        if (authorAsinMatch) {
          result.authorAsin = authorAsinMatch[1];
        }
      }

      // Narrator - try multiple approaches (only in product details area)
      if (!result.narrator) {
        // Look specifically in the product details section
        const productSection = $('.bc-section, .product-top-section, [class*="product"]').first();
        const narrators: string[] = [];

        // First try labeled narrator sections
        productSection.find('li.narratorLabel a, span.narratorLabel a, .narratorLabel a').each((_, elem) => {
          const text = $(elem).text().trim();
          if (text && text.length > 0 && text.length < 80) {
            narrators.push(text);
          }
        });

        // If no labeled narrators, look for narrator links (first 5 only)
        if (narrators.length === 0) {
          $('a[href*="/narrator/"]').slice(0, 5).each((_, elem) => {
            const text = $(elem).text().trim();
            if (text && text.length > 1 && text.length < 80 &&
                !text.includes('›') && !text.includes('...')) {
              narrators.push(text);
            }
          });
        }

        if (narrators.length > 0) {
          // Deduplicate and limit to reasonable count
          result.narrator = [...new Set(narrators)].slice(0, 5).join(', ');
        }

        if (result.narrator) {
          const detailLangConfig = this.getLangConfig();
          result.narrator = stripPrefixes(result.narrator, detailLangConfig.scraping.narratorPrefixes);
        }
        logger.info(` Narrator from HTML: "${result.narrator || ''}"`);
      }

      // Description - try multiple approaches with strict filtering
      if (!result.description) {
        const descLangConfig = this.getLangConfig();
        const excludePatterns = descLangConfig.scraping.descriptionExcludePatterns;

        const isValidDescription = (text: string): boolean => {
          if (!text || text.length < 50 || text.length > 5000) return false;
          // Reject if it contains promotional patterns
          for (const pattern of excludePatterns) {
            if (pattern.test(text)) return false;
          }
          return true;
        };

        // Try specific description selectors first
        const candidates = [
          $('.bc-expander-content').first().text().trim(),
          $('[class*="productPublisherSummary"]').first().text().trim(),
          $('[data-widget="publisherSummary"]').first().text().trim(),
          $('.bc-section p').first().text().trim(),
        ];

        // Find first valid candidate
        for (const candidate of candidates) {
          if (isValidDescription(candidate)) {
            result.description = candidate;
            break;
          }
        }

        // If still no description, search for valid paragraphs
        if (!result.description) {
          $('p, div[class*="description"]').each((_, elem) => {
            const text = $(elem).text().trim();
            if (isValidDescription(text) && text.length > (result.description?.length || 0)) {
              result.description = text;
            }
          });
        }

        logger.info(` Description length: ${result.description?.length || 0} chars`);
      }

      // Cover art - try multiple selectors
      if (!result.coverArtUrl) {
        result.coverArtUrl = $('img.bc-image-inset-border').attr('src') ||
                            $('img[class*="product-image"]').first().attr('src') ||
                            $('img[class*="cover"]').first().attr('src') ||
                            $('.bc-pub-detail-image img').attr('src') ||
                            $('img[src*="images-na.ssl-images-amazon.com"]').first().attr('src') ||
                            $('img[src*="m.media-amazon.com"]').first().attr('src') ||
                            '';
        if (result.coverArtUrl) {
          result.coverArtUrl = result.coverArtUrl.replace(/\._.*_\./, '._SL500_.');
        }
      }

      // Runtime/Duration - try multiple approaches
      if (!result.durationMinutes) {
        const rtLangConfig = this.getLangConfig();

        // Look for runtime text in various places
        const runtimeText =
          $('li.runtimeLabel span').text().trim() ||
          $('.runtimeLabel').text().trim() ||
          $(buildContainsSelector('span', rtLangConfig.scraping.lengthLabels)).parent().text().trim() ||
          $(buildContainsSelector('li', rtLangConfig.scraping.lengthLabels)).text().trim() ||
          (() => {
            // Look for any text matching duration pattern
            let found = '';
            $('li, span, div').each((_, elem) => {
              const text = $(elem).text().trim();
              if (text.match(rtLangConfig.scraping.durationDetectionPattern) && text.length < 100) {
                found = text;
                return false; // break
              }
            });
            return found;
          })();

        result.durationMinutes = this.parseRuntime(runtimeText);
        logger.info(` Duration from "${runtimeText}": ${result.durationMinutes} minutes`);
      }

      // Rating - try multiple approaches
      if (!result.rating) {
        const ratingLangConfig = this.getLangConfig();
        const ratingText =
          $('.ratingsLabel').text().trim() ||
          $('[class*="rating"]').first().text().trim() ||
          $(`span:contains("${ratingLangConfig.scraping.ratingTextSelector}")`).parent().text().trim() ||
          (() => {
            // Look for rating pattern using language-specific patterns
            let found = '';
            $('span, div').each((_, elem) => {
              const text = $(elem).text().trim();
              if (text.length < 50) {
                for (const pattern of ratingLangConfig.scraping.ratingPatterns) {
                  if (pattern.test(text)) {
                    found = text;
                    return false;
                  }
                }
              }
            });
            return found;
          })();

        if (ratingText) {
          let ratingValue: number | undefined;
          for (const pattern of ratingLangConfig.scraping.ratingPatterns) {
            const ratingMatch = ratingText.match(pattern);
            if (ratingMatch) {
              // Handle comma as decimal separator (e.g. "4,5" in German/Spanish)
              ratingValue = parseFloat(ratingMatch[1].replace(',', '.'));
              break;
            }
          }
          result.rating = ratingValue;
        }
        logger.info(` Rating from "${ratingText}": ${result.rating}`);
      }

      // Release date - try multiple selectors
      if (!result.releaseDate) {
        const rdLangConfig = this.getLangConfig();
        const releaseDateText =
          $(buildContainsSelector('li', rdLangConfig.scraping.releaseDateLabels)).text().trim() ||
          $(buildContainsSelector('span', rdLangConfig.scraping.releaseDateLabels)).parent().text().trim() ||
          $('[class*="release"]').text().trim();

        const dateMatch = extractByPatterns(releaseDateText, rdLangConfig.scraping.releaseDatePatterns) ||
                         releaseDateText.match(/(\w+ \d{1,2},? \d{4})/)?.[1];
        if (dateMatch) {
          result.releaseDate = dateMatch.trim();
        }
        logger.info(` Release date from "${releaseDateText}": ${result.releaseDate}`);
      }

      // Genres - try to extract categories
      const genres: string[] = [];
      $('a[href*="/cat/"]').each((_, el) => {
        const genre = $(el).text().trim();
        if (genre && !genres.includes(genre) && genre.length < 50 && genre.length > 2) {
          genres.push(genre);
        }
      });
      if (genres.length > 0) {
        result.genres = genres.slice(0, 5); // Limit to 5 genres
        logger.info(` Genres: ${result.genres.join(', ')}`);
      }

      logger.info(`Successfully fetched details for "${result.title}"`);
      logger.debug('Final result', {
        title: result.title,
        author: result.author,
        narrator: result.narrator,
        descLength: result.description?.length || 0,
        duration: result.durationMinutes,
        rating: result.rating,
        genreCount: result.genres?.length || 0
      });

      return result;
    } catch (error) {
      logger.error(`Failed to fetch details for ${asin}`, { error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  /**
   * Parse runtime text to minutes using language-specific patterns
   */
  private parseRuntime(runtimeText: string): number | undefined {
    if (!runtimeText) return undefined;

    const langConfig = this.getLangConfig();
    let totalMinutes = 0;

    // Try each hour pattern until one matches
    for (const pattern of langConfig.scraping.runtimeHourPatterns) {
      const match = runtimeText.match(pattern);
      if (match) {
        totalMinutes += parseInt(match[1]) * 60;
        break;
      }
    }

    // Try each minute pattern until one matches
    for (const pattern of langConfig.scraping.runtimeMinutePatterns) {
      const match = runtimeText.match(pattern);
      if (match) {
        totalMinutes += parseInt(match[1]);
        break;
      }
    }

    return totalMinutes > 0 ? totalMinutes : undefined;
  }

  /**
   * Get runtime (in minutes) for an audiobook by ASIN
   * Lightweight method for size validation during search
   * Returns null if not found or error
   */
  async getRuntime(asin: string): Promise<number | null> {
    try {
      // Use Audnexus API for fast, reliable runtime data
      const audnexusRegion = AUDIBLE_REGIONS[this.region].audnexusParam;

      const response = await this.externalFetchWithRetry(`https://api.audnex.us/books/${asin}`, {
        params: { region: audnexusRegion },
        timeout: 5000, // Quick timeout for search performance
        headers: { 'User-Agent': 'ReadMeABook/1.0' },
      });

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

  /**
   * Add delay between requests to respect rate limits
   */
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
let audibleService: AudibleService | null = null;

export function getAudibleService(): AudibleService {
  if (!audibleService) {
    audibleService = new AudibleService();
  }
  return audibleService;
}
