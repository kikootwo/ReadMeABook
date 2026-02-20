/**
 * Component: E-book Sidecar Service
 * Documentation: documentation/integrations/ebook-sidecar.md
 */

import axios, { AxiosError } from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs/promises';
import path from 'path';
import { RMABLogger } from '../utils/logger';

// Module-level logger (renamed to avoid shadowing function parameter 'logger')
const moduleLogger = RMABLogger.create('EbookScraper');

export interface EbookDownloadResult {
  success: boolean;
  filePath?: string;
  format?: string;
  error?: string;
}

const USER_AGENT = 'ReadMeABook/1.0 (Audiobook Automation)';
const REQUEST_DELAY_MS = 1500; // 1.5 second delay between requests
const DOWNLOAD_TIMEOUT_MS = 60000; // 60 seconds per download attempt
const MAX_SLOW_LINK_ATTEMPTS = 5;
const MAX_RETRIES = 3;
const FLARESOLVERR_TIMEOUT_MS = 60000; // 60 seconds for FlareSolverr requests

// In-memory cache for MD5 lookups (prevents re-scraping same ASIN)
const md5Cache = new Map<string, string | null>();

// FlareSolverr types
interface FlareSolverrRequest {
  cmd: 'request.get';
  url: string;
  maxTimeout: number;
}

interface FlareSolverrResponse {
  status: 'ok' | 'error';
  message: string;
  solution?: {
    url: string;
    status: number;
    headers: Record<string, string>;
    response: string;
    cookies: Array<{ name: string; value: string }>;
    userAgent: string;
  };
}

/**
 * Fetch HTML via FlareSolverr proxy (bypasses Cloudflare)
 */
async function fetchViaFlareSolverr(
  targetUrl: string,
  flaresolverrUrl: string,
  timeout: number = FLARESOLVERR_TIMEOUT_MS
): Promise<string> {
  const requestBody: FlareSolverrRequest = {
    cmd: 'request.get',
    url: targetUrl,
    maxTimeout: timeout,
  };

  const response = await axios.post<FlareSolverrResponse>(
    `${flaresolverrUrl}/v1`,
    requestBody,
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: timeout + 5000, // Extra buffer for FlareSolverr processing
    }
  );

  if (response.data.status !== 'ok' || !response.data.solution) {
    throw new Error(`FlareSolverr error: ${response.data.message}`);
  }

  if (response.data.solution.status >= 400) {
    throw new Error(`FlareSolverr returned HTTP ${response.data.solution.status}`);
  }

  return response.data.solution.response;
}

/**
 * Unified HTML fetch function - tries FlareSolverr if configured, falls back to direct
 */
async function fetchHtml(
  url: string,
  flaresolverrUrl?: string,
  logger?: RMABLogger
): Promise<string> {
  // Try FlareSolverr first if configured
  if (flaresolverrUrl) {
    try {
      moduleLogger.debug(`Using FlareSolverr for: ${url}`);
      const html = await fetchViaFlareSolverr(url, flaresolverrUrl);
      moduleLogger.debug(`FlareSolverr returned HTML length: ${html.length}`);
      return html;
    } catch (error) {
      await logger?.warn(
        `FlareSolverr failed, falling back to direct request: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
      moduleLogger.debug('FlareSolverr error', { error: error instanceof Error ? error.message : String(error) });
      // Fall through to direct request
    }
  }

  // Direct request (may fail with Cloudflare protection)
  moduleLogger.debug(`Using direct request for: ${url}`);
  const response = await retryRequest(() =>
    axios.get(url, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 30000,
    })
  );

  moduleLogger.debug(`Direct request returned data length: ${response.data?.length || 0}`);

  return response.data;
}

/**
 * Test FlareSolverr connection
 */
export async function testFlareSolverrConnection(
  flaresolverrUrl: string,
  baseUrl: string = 'https://annas-archive.li'
): Promise<{ success: boolean; message: string; responseTime?: number }> {
  const startTime = Date.now();

  try {
    // Test with a simple request to the configured Anna's Archive base URL
    const testUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const html = await fetchViaFlareSolverr(testUrl, flaresolverrUrl, 30000);
    const responseTime = Date.now() - startTime;

    // Verify we got valid HTML
    if (html && html.includes('Anna') && html.length > 1000) {
      return {
        success: true,
        message: `Connection successful (${responseTime}ms)`,
        responseTime,
      };
    }

    return {
      success: false,
      message: 'FlareSolverr returned invalid response',
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Main entry point: Download e-book from Anna's Archive by ASIN
 */
export async function downloadEbook(
  asin: string,
  title: string,
  author: string,
  targetDir: string,
  preferredFormat: string = 'epub',
  baseUrl: string = 'https://annas-archive.li',
  logger?: RMABLogger,
  flaresolverrUrl?: string,
  languageCode: string = 'en'
): Promise<EbookDownloadResult> {
  try {
    let md5: string | null = null;

    // Log FlareSolverr status
    if (flaresolverrUrl) {
      await logger?.info(`Using FlareSolverr at ${flaresolverrUrl}`);
    }

    // Step 1: Try ASIN search (exact match - best)
    if (asin) {
      await logger?.info(`Searching by ASIN: ${asin} (format: ${preferredFormat})...`);
      md5 = await searchByAsin(asin, preferredFormat, baseUrl, logger, flaresolverrUrl, languageCode);

      if (md5) {
        await logger?.info(`Found via ASIN: ${md5}`);
      } else {
        await logger?.info(`No results for ASIN, falling back to title + author search...`);
      }
    }

    // Step 2: Fallback to title + author search
    if (!md5) {
      await logger?.info(`Searching by title + author: "${title}" by ${author}...`);
      md5 = await searchByTitle(title, author, preferredFormat, baseUrl, logger, flaresolverrUrl, languageCode);

      if (md5) {
        await logger?.info(`Found via title search: ${md5}`);
      }
    }

    if (!md5) {
      return {
        success: false,
        error: 'No search results found (tried ASIN and title+author)',
      };
    }

    await logger?.info(`Found MD5: ${md5}`);

    // Step 3: Get slow download links (no waitlist only)
    const slowLinks = await getSlowDownloadLinks(md5, baseUrl, logger, flaresolverrUrl);

    if (slowLinks.length === 0) {
      return {
        success: false,
        error: 'No download links available',
      };
    }

    await logger?.info(`Found ${slowLinks.length} download link(s)`);

    // Step 4 & 5: Try each slow download link until one succeeds
    // Note: We determine the actual filename AFTER we know the real format from the download URL
    const attemptsLimit = Math.min(slowLinks.length, MAX_SLOW_LINK_ATTEMPTS);

    for (let i = 0; i < attemptsLimit; i++) {
      const slowLink = slowLinks[i];
      await logger?.info(`Attempting download link ${i + 1}/${attemptsLimit}...`);

      try {
        // Extract actual download URL from slow download page
        const extracted = await extractDownloadUrl(
          slowLink,
          baseUrl,
          preferredFormat,
          logger,
          flaresolverrUrl
        );

        if (!extracted) {
          await logger?.warn(`No download URL found on page ${i + 1}`);
          await delay(REQUEST_DELAY_MS);
          continue;
        }

        // Use the actual format from the download URL, not the preferred format
        const actualFormat = extracted.format;
        const sanitizedFilename = sanitizeEbookFilename(title, author, actualFormat);
        const targetPath = path.join(targetDir, sanitizedFilename);

        // Check if file already exists
        try {
          await fs.access(targetPath);
          await logger?.info(`E-book already exists: ${sanitizedFilename}`);
          return {
            success: true,
            filePath: targetPath,
            format: actualFormat,
          };
        } catch {
          // File doesn't exist, continue with download
        }

        await logger?.info(`Downloading from: ${new URL(extracted.url).host} (format: ${actualFormat})`);

        // Download file (direct - no FlareSolverr needed for file servers)
        const success = await downloadFile(extracted.url, targetPath, logger);

        if (success) {
          await logger?.info(`E-book downloaded successfully: ${sanitizedFilename}`);
          return {
            success: true,
            filePath: targetPath,
            format: actualFormat,
          };
        }

        await logger?.warn(`Download attempt ${i + 1} failed`);
        await delay(REQUEST_DELAY_MS);
      } catch (error) {
        await logger?.warn(
          `Download link ${i + 1} error: ${error instanceof Error ? error.message : 'Unknown'}`
        );
        await delay(REQUEST_DELAY_MS);
      }
    }

    return {
      success: false,
      error: `All ${attemptsLimit} download attempts failed`,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    await logger?.error(`E-book download error: ${errorMsg}`);
    return {
      success: false,
      error: errorMsg,
    };
  }
}

/**
 * Step 1: Search Anna's Archive by ASIN and extract MD5 hash
 * Exported for use by search-ebook processor
 */
export async function searchByAsin(
  asin: string,
  format: string,
  baseUrl: string,
  logger?: RMABLogger,
  flaresolverrUrl?: string,
  languageCode: string = 'en'
): Promise<string | null> {
  // Check cache first
  const cacheKey = `${asin}-${format}-${languageCode}`;
  if (md5Cache.has(cacheKey)) {
    const cached = md5Cache.get(cacheKey);
    if (cached) {
      await logger?.info(`Using cached MD5 for ASIN ${asin}`);
    }
    return cached ?? null; // Convert undefined to null
  }

  try {
    // Build search URL with ASIN and optional format filter
    const formatParam = format && format !== 'any' ? `ext=${format}&` : '';
    const searchUrl = `${baseUrl}/search?${formatParam}lang=${languageCode}&q=%22asin:${asin}%22`;

    moduleLogger.debug(`ASIN search URL: ${searchUrl}`);

    const html = await fetchHtml(searchUrl, flaresolverrUrl, logger);
    const $ = cheerio.load(html);

    // Exclude MD5 links from "Recent downloads" banner and "Partial matches" section
    // Only look for actual search result links
    const searchResultLinks = $('a[href*="/md5/"]').filter((i, elem) => {
      // Exclude links inside the recent downloads banner
      if ($(elem).closest('.js-recent-downloads-container').length > 0) {
        return false;
      }
      // Exclude links inside the partial matches section
      if ($(elem).closest('.js-partial-matches-show').length > 0) {
        return false;
      }
      return true;
    });

    // Debug logging for ASIN search
    const pageTitle = $('title').text();
    const allMd5Links = $('a[href*="/md5/"]').length;
    moduleLogger.debug('ASIN search results', {
      htmlLength: html.length,
      pageTitle,
      totalMd5Links: allMd5Links,
      searchResultLinks: searchResultLinks.length
    });

    // Extract MD5 from first search result link
    const firstResult = searchResultLinks.first();
    const href = firstResult.attr('href');

    if (firstResult.length > 0) {
      const resultText = firstResult.text().trim().substring(0, 100);
      const parentText = firstResult.parent().text().trim().substring(0, 100);
      moduleLogger.debug('First result details', { resultText, parentText });
    }

    if (!href) {
      await logger?.warn(`No search results found for ASIN: ${asin}`);
      md5Cache.set(cacheKey, null);
      return null;
    }

    // Extract MD5 from href (e.g., "/md5/3b6f9c0f..." -> "3b6f9c0f...")
    const md5Match = href.match(/\/md5\/([a-f0-9]+)/);
    const md5 = md5Match ? md5Match[1] : null;

    moduleLogger.debug(`Extracted MD5 from ASIN search: ${md5}`);

    // Cache result
    md5Cache.set(cacheKey, md5);

    await delay(REQUEST_DELAY_MS);
    return md5;
  } catch (error) {
    await logger?.error(
      `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    md5Cache.set(cacheKey, null);
    return null;
  }
}

/**
 * Search Anna's Archive by title and author (fallback method)
 * Exported for use by search-ebook processor
 */
export async function searchByTitle(
  title: string,
  author: string,
  format: string,
  baseUrl: string,
  logger?: RMABLogger,
  flaresolverrUrl?: string,
  languageCode: string = 'en'
): Promise<string | null> {
  // Check cache first
  const cacheKey = `title-${title}-${author}-${format}-${languageCode}`.toLowerCase();
  if (md5Cache.has(cacheKey)) {
    const cached = md5Cache.get(cacheKey);
    if (cached) {
      await logger?.info(`Using cached MD5 for title search`);
    }
    return cached ?? null;
  }

  try {
    // Build search URL using specific term types for author and title (more accurate than raw query)
    const encodedAuthor = encodeURIComponent(author);
    const encodedTitle = encodeURIComponent(title);

    // Use Anna's Archive advanced search with specific term types
    let searchUrl = `${baseUrl}/search?termtype_1=author&termval_1=${encodedAuthor}&termtype_2=title&termval_2=${encodedTitle}`;

    // Add format filter if not 'any'
    if (format && format !== 'any') {
      searchUrl += `&ext=${format}`;
    }

    // Add content type filters (books only, all fiction/nonfiction/unknown)
    searchUrl += '&content=book_nonfiction&content=book_fiction&content=book_unknown';

    // Add language filter
    searchUrl += `&lang=${languageCode}`;

    // Empty raw query (we're using specific terms instead)
    searchUrl += '&q=';

    moduleLogger.debug(`Title search URL: ${searchUrl}`);

    const html = await fetchHtml(searchUrl, flaresolverrUrl, logger);
    const $ = cheerio.load(html);

    // Exclude MD5 links from "Recent downloads" banner and "Partial matches" section
    const searchResultLinks = $('a[href*="/md5/"]').filter((i, elem) => {
      // Exclude links inside the recent downloads banner
      if ($(elem).closest('.js-recent-downloads-container').length > 0) {
        return false;
      }
      // Exclude links inside the partial matches section
      if ($(elem).closest('.js-partial-matches-show').length > 0) {
        return false;
      }
      return true;
    });

    const allMd5Links = $('a[href*="/md5/"]').length;
    moduleLogger.debug('Title search results', { totalMd5Links: allMd5Links, searchResultLinks: searchResultLinks.length });

    // Extract MD5 from first search result link
    const firstResult = searchResultLinks.first();
    const href = firstResult.attr('href');

    if (!href) {
      await logger?.warn(`No search results found for title: "${title}" by ${author}`);
      md5Cache.set(cacheKey, null);
      return null;
    }

    // Extract MD5 from href
    const md5Match = href.match(/\/md5\/([a-f0-9]+)/);
    const md5 = md5Match ? md5Match[1] : null;

    // Cache result
    md5Cache.set(cacheKey, md5);

    await delay(REQUEST_DELAY_MS);
    return md5;
  } catch (error) {
    await logger?.error(
      `Title search failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    md5Cache.set(cacheKey, null);
    return null;
  }
}

/**
 * Step 3: Get slow download links from MD5 page (no waitlist only)
 * Exported for use by search-ebook processor
 */
export async function getSlowDownloadLinks(
  md5: string,
  baseUrl: string,
  logger?: RMABLogger,
  flaresolverrUrl?: string
): Promise<string[]> {
  try {
    const md5Url = `${baseUrl}/md5/${md5}`;

    moduleLogger.debug(`Fetching MD5 page: ${md5Url}`);

    const html = await fetchHtml(md5Url, flaresolverrUrl, logger);

    moduleLogger.debug('MD5 page HTML', { length: html.length, preview: html.substring(0, 500) });
    // Check if we got a Cloudflare challenge page
    if (html.includes('challenge-running') || html.includes('cf-browser-verification')) {
      moduleLogger.warn('Appears to be Cloudflare challenge page');
    }

    const $ = cheerio.load(html);
    const slowLinks: string[] = [];

    // Debug: count all links
    const allLinks = $('a').length;
    const slowDownloadLinks = $('a[href*="/slow_download/"]').length;
    const slowDownloadLinksAlt = $('a[href*="slow_download"]').length;
    moduleLogger.debug('Link counts on page', { allLinks, slowDownloadLinks, slowDownloadLinksAlt });

    // Log all href patterns to see what we're dealing with
    const hrefPatterns: string[] = [];
    $('a[href]').each((i, elem) => {
      const href = $(elem).attr('href') || '';
      if (href.includes('download') || href.includes('slow')) {
        hrefPatterns.push(href.substring(0, 100));
      }
    });
    if (hrefPatterns.length > 0) {
      moduleLogger.debug('Download-related hrefs found', { hrefs: hrefPatterns.slice(0, 10) });
    }

    // Find all slow download links
    $('a[href*="/slow_download/"]').each((i, elem) => {
      const linkText = $(elem).text().toLowerCase();
      // Check parent element text too - "no waitlist" may be outside the <a> tag
      // e.g., <li><a>Slow Partner Server #5</a> (no waitlist, but can be very slow)</li>
      const parentText = $(elem).parent().text().toLowerCase();

      const href = $(elem).attr('href');
      moduleLogger.debug('Found slow_download link', { href, linkText: linkText.substring(0, 30), parentText: parentText.substring(0, 60) });

      // Check for "no waitlist" in either the link text or parent text
      if (linkText.includes('no waitlist') || parentText.includes('no waitlist')) {
        if (href) {
          // Convert relative URL to absolute
          const fullUrl = href.startsWith('http') ? href : `${baseUrl}${href}`;
          slowLinks.push(fullUrl);
          moduleLogger.debug(`Added slow link (no waitlist): ${fullUrl}`);
        }
      }
    });

    moduleLogger.debug(`Total slow links found: ${slowLinks.length}`);

    await delay(REQUEST_DELAY_MS);
    return slowLinks;
  } catch (error) {
    await logger?.error(
      `Failed to get slow links: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    moduleLogger.debug('Error getting slow links', { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

export interface ExtractedDownload {
  url: string;
  format: string;
}

/**
 * Step 4: Extract actual download URL from slow download page
 * IMPORTANT: Supports dynamic file formats (not hardcoded to .epub)
 * Returns both URL and detected format
 * Exported for use by direct-download processor
 */
export async function extractDownloadUrl(
  slowDownloadUrl: string,
  baseUrl: string,
  format: string,
  logger?: RMABLogger,
  flaresolverrUrl?: string
): Promise<ExtractedDownload | null> {
  try {
    const html = await fetchHtml(slowDownloadUrl, flaresolverrUrl, logger);
    const $ = cheerio.load(html);

    // Build regex pattern based on format
    // If format is 'any', match any common e-book extension
    let pattern: RegExp;
    if (format === 'any') {
      pattern = /(https?:\/\/[^\s]+\.(epub|pdf|mobi|azw3|djvu|fb2))/i;
    } else {
      pattern = new RegExp(`(https?:\\/\\/[^\\s]+\\.${format})`, 'i');
    }

    let downloadUrl: string | null = null;
    let detectedFormat: string | null = null;

    // Method 1: Search in pre/code blocks first (most reliable)
    $('pre, code').each((i, elem) => {
      const text = $(elem).text();
      const match = text.match(pattern);
      if (match) {
        downloadUrl = match[1];
        // Extract format from URL
        const formatMatch = downloadUrl.match(/\.(epub|pdf|mobi|azw3|djvu|fb2)$/i);
        detectedFormat = formatMatch ? formatMatch[1].toLowerCase() : null;
        return false; // Break loop
      }
    });

    // Method 2: Search entire body text as fallback
    if (!downloadUrl) {
      const bodyText = $('body').text();
      const match = bodyText.match(pattern);
      if (match) {
        downloadUrl = match[1];
        // Extract format from URL
        const formatMatch = downloadUrl.match(/\.(epub|pdf|mobi|azw3|djvu|fb2)$/i);
        detectedFormat = formatMatch ? formatMatch[1].toLowerCase() : null;
      }
    }

    await delay(REQUEST_DELAY_MS);

    if (!downloadUrl || !detectedFormat) {
      return null;
    }

    return { url: downloadUrl, format: detectedFormat };
  } catch (error) {
    await logger?.error(
      `Failed to extract download URL: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    return null;
  }
}

/**
 * Step 5: Download file from URL with streaming (handles large files)
 */
async function downloadFile(
  url: string,
  targetPath: string,
  logger?: RMABLogger
): Promise<boolean> {
  try {
    const response = await axios.get(url, {
      responseType: 'stream',
      timeout: DOWNLOAD_TIMEOUT_MS,
      headers: { 'User-Agent': USER_AGENT },
      maxRedirects: 5,
    });

    // Stream to file
    const writer = require('fs').createWriteStream(targetPath);

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        writer.close();
        resolve(true);
      });

      writer.on('error', (error: Error) => {
        writer.close();
        // Clean up partial file
        fs.unlink(targetPath).catch(() => {});
        reject(error);
      });

      // Set timeout
      const timeout = setTimeout(() => {
        writer.close();
        fs.unlink(targetPath).catch(() => {});
        reject(new Error('Download timeout'));
      }, DOWNLOAD_TIMEOUT_MS);

      writer.on('finish', () => clearTimeout(timeout));
      writer.on('error', () => clearTimeout(timeout));
    });
  } catch (error) {
    // Clean up partial file
    try {
      await fs.unlink(targetPath);
    } catch {}

    await logger?.error(
      `Download failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    return false;
  }
}

/**
 * Sanitize filename for e-book
 * Format: "[Title] - [Author].[format]"
 * Note: format should be the actual detected format (e.g., 'pdf', 'epub'), not 'any'
 */
function sanitizeEbookFilename(title: string, author: string, format: string): string {
  const sanitize = (str: string): string => {
    return str
      .replace(/[<>:"/\\|?*]/g, '') // Remove invalid chars
      .replace(/\s+/g, ' ') // Collapse spaces
      .trim()
      .slice(0, 100); // Limit length
  };

  const cleanTitle = sanitize(title);
  const cleanAuthor = sanitize(author);
  // Use the actual format passed in (should already be the detected format from URL)
  const cleanFormat = format.toLowerCase();

  return `${cleanTitle} - ${cleanAuthor}.${cleanFormat}`;
}

/**
 * Retry HTTP request with exponential backoff
 */
async function retryRequest<T>(
  requestFn: () => Promise<T>,
  retries: number = MAX_RETRIES
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await requestFn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');

      // Only retry on 5xx errors or network errors
      const isRetryable =
        error instanceof AxiosError &&
        (error.code === 'ECONNRESET' ||
          error.code === 'ETIMEDOUT' ||
          (error.response && error.response.status >= 500));

      if (!isRetryable || attempt === retries - 1) {
        throw lastError;
      }

      // Exponential backoff: 1s, 2s, 4s
      const delayMs = 1000 * Math.pow(2, attempt);
      await delay(delayMs);
    }
  }

  throw lastError || new Error('Request failed after retries');
}

/**
 * Delay helper
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Clear MD5 cache (useful for testing)
 */
export function clearMd5Cache(): void {
  md5Cache.clear();
}
