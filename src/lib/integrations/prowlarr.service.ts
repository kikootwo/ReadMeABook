/**
 * Component: Prowlarr Integration Service
 * Documentation: documentation/phase3/prowlarr.md
 */

import axios, { AxiosInstance } from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { DOWNLOAD_CLIENT_TIMEOUT } from '../constants/download-timeouts';
import { TorrentResult } from '../utils/ranking-algorithm';
import { RMABLogger } from '../utils/logger';

// Module-level logger
const logger = RMABLogger.create('Prowlarr');

export interface SearchFilters {
  category?: number; // Deprecated: use categories instead
  categories?: number[]; // Array of category IDs to search
  minSeeders?: number;
  maxResults?: number;
  indexerIds?: number[];
}

export interface IndexerCategory {
  id: number;
  name: string;
}

export interface Indexer {
  id: number;
  name: string;
  enable: boolean;
  protocol: string;
  priority: number;
  capabilities?: {
    supportsRss?: boolean;
    categories?: IndexerCategory[];
  };
  fields?: Array<{
    name: string;
    value: any;
  }>;
}

export interface IndexerStats {
  indexers: Array<{
    indexerId: number;
    indexerName: string;
    numberOfQueries: number;
    numberOfGrabs: number;
    numberOfFailedQueries: number;
    averageResponseTime: number;
  }>;
}

interface ProwlarrSearchResult {
  guid: string;
  indexer: string;
  indexerId?: number;
  title: string;
  size: number;
  seeders?: number;     // Optional for NZB/Usenet results
  leechers?: number;    // Optional for NZB/Usenet results
  publishDate: string;
  downloadUrl?: string;  // Torrent file download URL (most indexers)
  magnetUrl?: string;    // Magnet link (public trackers like TPB)
  infoUrl?: string;      // Link to indexer's info page
  infoHash?: string;
  categories?: number[];
  downloadVolumeFactor?: number;
  uploadVolumeFactor?: number;
  indexerFlags?: string[] | number[];  // Can be string names or numeric IDs
  protocol?: string;  // 'torrent' or 'usenet' - provided by Prowlarr API
  [key: string]: any;  // Allow any additional fields from Prowlarr API
}

export class ProwlarrService {
  private client: AxiosInstance;
  private baseUrl: string;
  private apiKey: string;
  private defaultCategory = 3030; // Audiobooks category

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = apiKey;

    this.client = axios.create({
      baseURL: `${this.baseUrl}/api/v1`,
      headers: {
        'X-Api-Key': this.apiKey,
      },
      timeout: DOWNLOAD_CLIENT_TIMEOUT,
      paramsSerializer: {
        serialize: (params) => {
          // Custom serializer to handle arrays correctly for Prowlarr API
          // indexerIds=[1,2,3] should become indexerIds=1&indexerIds=2&indexerIds=3
          const parts: string[] = [];
          for (const [key, value] of Object.entries(params)) {
            if (Array.isArray(value)) {
              value.forEach(v => parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`));
            } else if (value !== undefined && value !== null) {
              parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
            }
          }
          return parts.join('&');
        },
      },
    });

    // Debug interceptor to log actual outgoing requests
    this.client.interceptors.request.use((config) => {
      logger.debug(`Actual request: ${config.method?.toUpperCase()} ${config.baseURL}${config.url}`, { params: config.params });
      return config;
    });
  }

  /**
   * Search for audiobooks across configured indexers
   * If indexerIds is provided, only searches those indexers
   */
  async search(
    query: string,
    filters?: SearchFilters
  ): Promise<TorrentResult[]> {
    try {
      // Determine which categories to search
      // Priority: filters.categories > filters.category > defaultCategory
      let categoriesToSearch: number[];
      if (filters?.categories && filters.categories.length > 0) {
        categoriesToSearch = filters.categories;
      } else if (filters?.category) {
        categoriesToSearch = [filters.category];
      } else {
        categoriesToSearch = [this.defaultCategory];
      }

      const params: Record<string, any> = {
        query,
        type: 'search',
        limit: 100, // Maximum results to return from Prowlarr
        extended: 1, // Enable searching in tags, labels, and metadata
        categories: categoriesToSearch, // Will be serialized as categories=3030&categories=3040 etc
      };

      // Filter by specific indexers if provided
      if (filters?.indexerIds && filters.indexerIds.length > 0) {
        params.indexerIds = filters.indexerIds;
      }

      const response = await this.client.get('/search', { params });
      logger.info(` Raw API response: ${response.data.length} results`);

      // Debug: Log first raw result to see structure and protocol field
      if (response.data.length > 0) {
        const firstResult = response.data[0];
        logger.info(` First raw result - protocol: "${firstResult.protocol}", indexer: "${firstResult.indexer}", title: "${firstResult.title?.substring(0, 50)}..."`);

        // Check protocol distribution in raw results
        const rawProtocols = response.data.reduce((acc: Record<string, number>, r: any) => {
          const proto = r.protocol || 'missing';
          acc[proto] = (acc[proto] || 0) + 1;
          return acc;
        }, {});
        logger.info(`Raw protocol distribution`, { protocols: rawProtocols });
      }

      // Debug: Log first raw result full structure (automatically filtered by LOG_LEVEL)
      if (response.data.length > 0) {
        logger.debug('Sample raw result from API', response.data[0]);
      }

      // Transform Prowlarr results to our format
      const results = response.data
        .map((result: ProwlarrSearchResult, index: number) => {
          const transformed = this.transformResult(result);
          if (!transformed) {
            // Log the full raw result that was skipped (automatically filtered by LOG_LEVEL)
            logger.debug(`Result #${index + 1} was skipped`, { rawData: result });
          }
          return transformed;
        })
        .filter((result: TorrentResult | null) => result !== null) as TorrentResult[];

      // Filter by protocol based on configured download client
      let filtered = await this.filterByProtocol(results);

      // Apply additional filters

      if (filters?.minSeeders) {
        // Only apply seeder filter to torrent results (NZB results don't have seeders)
        filtered = filtered.filter((r) => {
          // Skip filter for NZB results (undefined seeders)
          if (r.seeders === undefined) return true;
          return r.seeders >= (filters.minSeeders || 0);
        });
      }

      if (filters?.maxResults) {
        filtered = filtered.slice(0, filters.maxResults);
      }

      logger.info(`Search for "${query}" returned ${filtered.length} results`);

      return filtered;
    } catch (error) {
      logger.error('Search failed', { error: error instanceof Error ? error.message : String(error) });
      throw new Error(
        `Failed to search Prowlarr: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Search with multiple query variations to increase coverage
   * Fires 2 queries per call: "title author" and "title", then deduplicates by guid
   */
  async searchWithVariations(
    title: string,
    author: string,
    filters?: SearchFilters
  ): Promise<TorrentResult[]> {
    const queries = [
      `${title} ${author}`,
      title,
    ];

    logger.info(`Searching with ${queries.length} query variations`, { queries });

    const allResults: TorrentResult[] = [];

    for (const query of queries) {
      try {
        const results = await this.search(query, filters);
        logger.info(`Query "${query}" returned ${results.length} results`);
        allResults.push(...results);
      } catch (error) {
        logger.error(`Query "${query}" failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        // Continue with other queries even if one fails
      }
    }

    const deduplicated = this.deduplicateResults(allResults);
    logger.info(`Multi-query search: ${allResults.length} total → ${deduplicated.length} after dedup (${allResults.length - deduplicated.length} duplicates removed)`);

    return deduplicated;
  }

  /**
   * Deduplicate results by guid, preserving order (first occurrence wins)
   */
  private deduplicateResults(results: TorrentResult[]): TorrentResult[] {
    const seen = new Set<string>();
    return results.filter(result => {
      if (seen.has(result.guid)) {
        return false;
      }
      seen.add(result.guid);
      return true;
    });
  }

  /**
   * Get list of configured indexers
   */
  async getIndexers(): Promise<Indexer[]> {
    try {
      const response = await this.client.get('/indexer');
      return response.data;
    } catch (error) {
      logger.error('Failed to get indexers', { error: error instanceof Error ? error.message : String(error) });
      throw new Error('Failed to get indexers from Prowlarr');
    }
  }

  /**
   * Test connection to Prowlarr
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.client.get('/health');
      return true;
    } catch (error) {
      logger.error('Connection test failed', { error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  /**
   * Get indexer statistics
   */
  async getStats(): Promise<IndexerStats> {
    try {
      const response = await this.client.get('/indexerstats');
      return response.data;
    } catch (error) {
      logger.error('Failed to get stats', { error: error instanceof Error ? error.message : String(error) });
      throw new Error('Failed to get indexer statistics');
    }
  }

  /**
   * Get RSS feed for a specific indexer
   * Returns recent releases from the indexer's RSS feed
   * Uses true RSS feed endpoint to avoid burdening indexers with searches
   */
  async getRssFeed(indexerId: number): Promise<TorrentResult[]> {
    try {
      // Prowlarr RSS endpoint: /{indexerId}/api?apikey={key}&t=search&cat=3030
      const rssUrl = `${this.baseUrl}/${indexerId}/api`;

      const response = await axios.get(rssUrl, {
        params: {
          apikey: this.apiKey,
          t: 'search',
          cat: this.defaultCategory.toString(),
          limit: 100,
          extended: 1,
        },
        timeout: DOWNLOAD_CLIENT_TIMEOUT,
        responseType: 'text', // Get XML as text
      });

      // Parse XML RSS feed
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        allowBooleanAttributes: true,
      });

      const parsed = parser.parse(response.data);

      // Extract items from RSS feed
      const items = parsed?.rss?.channel?.item || [];
      const itemsArray = Array.isArray(items) ? items : [items];

      // Transform RSS items to TorrentResult format
      const results: TorrentResult[] = [];

      for (const item of itemsArray) {
        if (!item) continue;

        try {
          // Extract torznab attributes
          const attrs = Array.isArray(item['torznab:attr']) ? item['torznab:attr'] : [item['torznab:attr']];
          const getAttr = (name: string) => {
            const attr = attrs.find((a: any) => a?.['@_name'] === name);
            return attr?.['@_value'];
          };

          const seeders = parseInt(getAttr('seeders') || '0', 10);
          const peers = parseInt(getAttr('peers') || '0', 10);
          const leechers = Math.max(0, peers - seeders);

          // Extract metadata from title
          const metadata = this.extractMetadata(item.title || '');

          // Extract download URL
          const downloadUrl = item.link || item.enclosure?.['@_url'] || '';

          // Skip torrents without a valid download URL
          if (!downloadUrl || typeof downloadUrl !== 'string' || downloadUrl.trim() === '') {
            logger.warn(` Skipping torrent "${item.title || 'Unknown'}" - missing download URL`);
            continue;
          }

          const result: TorrentResult = {
            indexer: item.prowlarrindexer?.['#text'] || item.prowlarrindexer || 'Unknown',
            indexerId: indexerId,
            title: item.title || '',
            size: parseInt(item.size || '0', 10),
            seeders,
            leechers,
            publishDate: item.pubDate ? new Date(item.pubDate) : new Date(),
            downloadUrl: downloadUrl.trim(),
            infoUrl: item.comments || undefined,  // RSS feeds often have comments field with info URL
            infoHash: getAttr('infohash'),
            guid: item.guid || '',
            format: metadata.format,
            bitrate: metadata.bitrate,
            hasChapters: metadata.hasChapters,
          };

          results.push(result);
        } catch (error) {
          logger.error('Failed to parse RSS item', { error: error instanceof Error ? error.message : String(error) });
          // Continue with other items
        }
      }

      logger.info(`RSS feed for indexer ${indexerId} returned ${results.length} results`);

      return results;
    } catch (error) {
      logger.error(`Failed to get RSS feed for indexer ${indexerId}`, { error: error instanceof Error ? error.message : String(error) });
      throw new Error(`Failed to get RSS feed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get RSS feeds from all enabled indexers
   */
  async getAllRssFeeds(indexerIds: number[]): Promise<TorrentResult[]> {
    const allResults: TorrentResult[] = [];

    for (const indexerId of indexerIds) {
      try {
        const results = await this.getRssFeed(indexerId);
        allResults.push(...results);
      } catch (error) {
        logger.error(`Failed to get RSS feed for indexer ${indexerId}`, { error: error instanceof Error ? error.message : String(error) });
        // Continue with other indexers even if one fails
      }
    }

    logger.info(`RSS feeds from ${indexerIds.length} indexers returned ${allResults.length} total results`);

    return allResults;
  }

  /**
   * Filter results based on configured download client protocols
   * If both clients configured: return all results
   * If only one client configured: return only matching protocol results
   */
  private async filterByProtocol(results: TorrentResult[]): Promise<TorrentResult[]> {
    try {
      // Get configured download clients
      const { getDownloadClientManager } = await import('../services/download-client-manager.service');
      const { getConfigService } = await import('../services/config.service');
      const config = await getConfigService();
      const manager = getDownloadClientManager(config);

      const hasTorrentClient = await manager.hasClientForProtocol('torrent');
      const hasUsenetClient = await manager.hasClientForProtocol('usenet');

      // Debug: Log protocol distribution
      const protocolCounts = results.reduce((acc, r) => {
        const proto = r.protocol || 'unknown';
        acc[proto] = (acc[proto] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      logger.debug(`Protocol distribution in ${results.length} results`, { protocols: protocolCounts });

      // Debug: Log first few results to see their protocols
      if (results.length > 0 && results.length <= 5) {
        results.forEach((r, i) => {
          logger.info(` Result ${i + 1}: protocol="${r.protocol || 'undefined'}", url="${r.downloadUrl.substring(0, 80)}..."`);
        });
      } else if (results.length > 5) {
        logger.info(` First 3 results:`);
        results.slice(0, 3).forEach((r, i) => {
          logger.info(`   ${i + 1}: protocol="${r.protocol || 'undefined'}", isNZB=${ProwlarrService.isNZBResult(r)}`);
        });
      }

      // If both clients configured, return all results (best result selected across all protocols)
      if (hasTorrentClient && hasUsenetClient) {
        logger.info(` Both torrent and usenet clients configured, returning all ${results.length} results`);
        return results;
      }

      // If only torrent client configured, filter for torrent results
      if (hasTorrentClient) {
        const filtered = results.filter(result => !ProwlarrService.isNZBResult(result));
        logger.info(` Filtered ${results.length} results to ${filtered.length} torrent results for qBittorrent`);
        return filtered;
      }

      // If only usenet client configured, filter for NZB results
      if (hasUsenetClient) {
        const filtered = results.filter(result => ProwlarrService.isNZBResult(result));
        logger.info(` Filtered ${results.length} results to ${filtered.length} NZB results for SABnzbd`);
        return filtered;
      }

      // No clients configured - return empty
      logger.warn('No download clients configured, returning empty results');
      return [];
    } catch (error) {
      logger.error('Failed to filter by protocol, returning all results', { error: error instanceof Error ? error.message : String(error) });
      return results; // Fallback: return unfiltered if config fails
    }
  }

  /**
   * Detect if a result is an NZB download (Usenet) or torrent (BitTorrent)
   * Static method for protocol detection
   */
  static isNZBResult(result: TorrentResult): boolean {
    // Check protocol field first (most reliable - provided by Prowlarr API)
    if (result.protocol) {
      return result.protocol.toLowerCase() === 'usenet';
    }

    // Fallback to URL pattern detection if protocol not provided
    const url = result.downloadUrl.toLowerCase();

    // Check file extension
    if (url.endsWith('.nzb')) {
      return true;
    }

    // Check URL path patterns common in Newznab APIs
    if (url.includes('/nzb/') || url.includes('&t=get') || url.includes('/getnzb')) {
      return true;
    }

    return false;
  }

  /**
   * Transform Prowlarr result to our TorrentResult format
   */
  private transformResult(result: ProwlarrSearchResult): TorrentResult | null {
    try {
      // Get download URL - prefer downloadUrl (torrent file), fallback to magnetUrl (magnet link)
      const downloadUrl = result.downloadUrl || result.magnetUrl || '';

      // Validate we have a valid download URL
      if (!downloadUrl || typeof downloadUrl !== 'string' || downloadUrl.trim() === '') {
        logger.warn(` Skipping result "${result.title}" - missing both downloadUrl and magnetUrl`);
        return null;
      }

      // Extract metadata from title
      const metadata = this.extractMetadata(result.title);

      // Extract flags from result
      const flags = this.extractFlags(result);

      return {
        indexer: result.indexer,
        indexerId: result.indexerId,
        title: result.title,
        size: result.size,
        seeders: result.seeders,
        leechers: result.leechers,
        publishDate: new Date(result.publishDate),
        downloadUrl: downloadUrl.trim(),
        infoUrl: result.infoUrl,
        infoHash: result.infoHash,
        guid: result.guid,
        format: metadata.format,
        bitrate: metadata.bitrate,
        hasChapters: metadata.hasChapters,
        flags: flags.length > 0 ? flags : undefined,
        protocol: result.protocol, // 'torrent' or 'usenet'
      };
    } catch (error) {
      logger.error('Failed to transform result', { title: result?.title, error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  /**
   * Extract indexer flags from Prowlarr result
   */
  private extractFlags(result: ProwlarrSearchResult): string[] {
    const flags: string[] = [];

    // Primary method: Check for indexerFlags array (can be strings or numbers)
    if (result.indexerFlags && Array.isArray(result.indexerFlags)) {
      result.indexerFlags.forEach(flag => {
        if (typeof flag === 'string' && flag.trim()) {
          flags.push(flag.trim());
        }
        // Skip numeric flags - we can't map those to user-friendly names without indexer-specific mapping
      });
    }

    // Also check for common alternative field names Prowlarr might use
    const possibleFlagFields = ['flags', 'tags', 'labels'];
    for (const fieldName of possibleFlagFields) {
      const fieldValue = result[fieldName];
      if (fieldValue && Array.isArray(fieldValue)) {
        fieldValue.forEach((flag: any) => {
          if (typeof flag === 'string' && flag.trim() && !flags.includes(flag.trim())) {
            flags.push(flag.trim());
          }
        });
      }
    }

    // Fallback: Derive flags from volume factors only if no flags were found
    if (flags.length === 0) {
      if (result.downloadVolumeFactor !== undefined && result.downloadVolumeFactor === 0) {
        flags.push('Freeleech');
      } else if (result.downloadVolumeFactor !== undefined && result.downloadVolumeFactor < 1) {
        flags.push('Partial Freeleech');
      }

      if (result.uploadVolumeFactor !== undefined && result.uploadVolumeFactor > 1) {
        flags.push('Double Upload');
      }
    }

    // Log detected flags for debugging
    if (flags.length > 0) {
      logger.info(` ✓ Detected flags for "${result.title.substring(0, 50)}...": [${flags.join(', ')}]`);
    }

    return flags;
  }

  /**
   * Extract audiobook metadata from torrent title
   */
  private extractMetadata(title: string): {
    format?: 'M4B' | 'M4A' | 'MP3' | 'FLAC';
    bitrate?: string;
    hasChapters?: boolean;
  } {
    const upperTitle = title.toUpperCase();

    // Detect format
    let format: 'M4B' | 'M4A' | 'MP3' | 'FLAC' | undefined;
    if (upperTitle.includes('M4B')) {
      format = 'M4B';
    } else if (upperTitle.includes('M4A')) {
      format = 'M4A';
    } else if (upperTitle.includes('MP3')) {
      format = 'MP3';
    } else if (upperTitle.includes('FLAC')) {
      format = 'FLAC';
    }

    // Detect bitrate (e.g., "64kbps", "128 KBPS")
    const bitrateMatch = title.match(/(\d+)\s*kbps/i);
    const bitrate = bitrateMatch ? `${bitrateMatch[1]}kbps` : undefined;

    // M4B typically has chapters
    const hasChapters = format === 'M4B' ? true : undefined;

    return {
      format,
      bitrate,
      hasChapters,
    };
  }
}

// Singleton instance
let prowlarrService: ProwlarrService | null = null;

/**
 * Invalidate the cached ProwlarrService singleton.
 * Must be called after updating Prowlarr URL or API key so that
 * background jobs (search, RSS monitor, etc.) pick up the new credentials.
 */
export function invalidateProwlarrService(): void {
  if (prowlarrService) {
    logger.info('Prowlarr service singleton invalidated — will reconnect with new credentials on next use');
  }
  prowlarrService = null;
}

export async function getProwlarrService(): Promise<ProwlarrService> {
  if (!prowlarrService) {
    // Get configuration from database
    const { getConfigService } = await import('@/lib/services/config.service');
    const configService = getConfigService();

    const config = await configService.getMany(['prowlarr_url', 'prowlarr_api_key']);
    const baseUrl = config.prowlarr_url || process.env.PROWLARR_URL || 'http://prowlarr:9696';
    const apiKey = config.prowlarr_api_key || process.env.PROWLARR_API_KEY;

    if (!apiKey) {
      throw new Error('Prowlarr API key not configured');
    }

    prowlarrService = new ProwlarrService(baseUrl, apiKey);

    // Test connection
    const isConnected = await prowlarrService.testConnection();
    if (!isConnected) {
      logger.warn('Connection test failed');
    }
  }

  return prowlarrService;
}
