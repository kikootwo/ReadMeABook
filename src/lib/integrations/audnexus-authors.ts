/**
 * Component: Audnexus Author API Integration
 * Documentation: documentation/integrations/audible.md
 *
 * Shared utilities for fetching author data from the Audnexus API.
 * Used by author search, author detail, and similar authors routes.
 */

import axios from 'axios';
import { RMAB_USER_AGENT } from '@/lib/utils/user-agent';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('Audnexus.Authors');

const AUDNEXUS_BASE = 'https://api.audnex.us';
const AUDNEXUS_TIMEOUT = 10000;
const AUDNEXUS_HEADERS = { 'User-Agent': RMAB_USER_AGENT };

export interface AudnexusAuthorSearch {
  asin: string;
  name: string;
}

export interface AudnexusAuthorGenre {
  asin: string;
  name: string;
  type: string;
}

export interface AudnexusAuthorSimilar {
  asin: string;
  name: string;
}

export interface AudnexusAuthorDetail {
  asin: string;
  name: string;
  description?: string;
  image?: string;
  region: string;
  genres?: AudnexusAuthorGenre[];
  similar?: AudnexusAuthorSimilar[];
}

/**
 * Fetch with retry and exponential backoff for Audnexus API
 */
export async function audnexusFetchWithRetry(url: string, params: Record<string, string>, maxRetries = 3): Promise<any> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await axios.get(url, {
        params,
        timeout: AUDNEXUS_TIMEOUT,
        headers: AUDNEXUS_HEADERS,
      });
    } catch (error: any) {
      lastError = error;
      const status = error.response?.status;
      const isRetryable = !status || status === 503 || status === 429 || status >= 500;

      if (!isRetryable) throw error;
      if (attempt === maxRetries) break;

      const backoffMs = Math.pow(2, attempt) * 1000;
      logger.info(`Audnexus request failed (${status || 'network error'}), retrying in ${backoffMs}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }

  throw lastError || new Error('Audnexus request failed after retries');
}

/**
 * Search authors via Audnexus and return deduplicated results
 */
export async function searchAuthors(name: string, region: string): Promise<AudnexusAuthorSearch[]> {
  const response = await audnexusFetchWithRetry(`${AUDNEXUS_BASE}/authors`, { region, name });
  const results: AudnexusAuthorSearch[] = response.data;

  const seen = new Set<string>();
  return results.filter(author => {
    if (seen.has(author.asin)) return false;
    seen.add(author.asin);
    return true;
  });
}

/**
 * Fetch full author details from Audnexus
 */
export async function fetchAuthorDetail(asin: string, region: string): Promise<AudnexusAuthorDetail | null> {
  try {
    const response = await audnexusFetchWithRetry(`${AUDNEXUS_BASE}/authors/${asin}`, { region });
    return response.data;
  } catch (error: any) {
    if (error.response?.status === 404) {
      logger.debug(`Author not found on Audnexus: ${asin}`);
    } else {
      logger.warn(`Failed to fetch author detail: ${asin}`, { error: error.message });
    }
    return null;
  }
}
