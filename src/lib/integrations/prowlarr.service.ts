/**
 * Component: Prowlarr Integration Service
 * Documentation: documentation/phase3/prowlarr.md
 */

import axios, { AxiosInstance } from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { TorrentResult } from '../utils/ranking-algorithm';

export interface SearchFilters {
  category?: number;
  minSeeders?: number;
  maxResults?: number;
}

export interface Indexer {
  id: number;
  name: string;
  enable: boolean;
  protocol: string;
  priority: number;
  capabilities?: {
    supportsRss?: boolean;
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
  title: string;
  size: number;
  seeders: number;
  leechers: number;
  publishDate: string;
  downloadUrl: string;
  infoHash?: string;
  categories?: number[];
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
      timeout: 30000, // 30 seconds
    });
  }

  /**
   * Search for audiobooks across all configured indexers
   */
  async search(
    query: string,
    filters?: SearchFilters
  ): Promise<TorrentResult[]> {
    try {
      const params: Record<string, any> = {
        query,
        categories: filters?.category?.toString() || this.defaultCategory.toString(),
        type: 'search',
        extended: 1, // Enable searching in tags, labels, and metadata
      };

      const response = await this.client.get('/search', { params });

      // Transform Prowlarr results to our format
      const results = response.data
        .map((result: ProwlarrSearchResult) => this.transformResult(result))
        .filter((result: TorrentResult | null) => result !== null) as TorrentResult[];

      // Apply filters
      let filtered = results;

      if (filters?.minSeeders) {
        filtered = filtered.filter((r) => r.seeders >= (filters.minSeeders || 0));
      }

      if (filters?.maxResults) {
        filtered = filtered.slice(0, filters.maxResults);
      }

      console.log(`Prowlarr search for "${query}" returned ${filtered.length} results`);

      return filtered;
    } catch (error) {
      console.error('Prowlarr search failed:', error);
      throw new Error(
        `Failed to search Prowlarr: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Get list of configured indexers
   */
  async getIndexers(): Promise<Indexer[]> {
    try {
      const response = await this.client.get('/indexer');
      return response.data;
    } catch (error) {
      console.error('Failed to get Prowlarr indexers:', error);
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
      console.error('Prowlarr connection test failed:', error);
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
      console.error('Failed to get Prowlarr stats:', error);
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
        timeout: 30000,
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

          const result: TorrentResult = {
            indexer: item.prowlarrindexer?.['#text'] || item.prowlarrindexer || 'Unknown',
            title: item.title || '',
            size: parseInt(item.size || '0', 10),
            seeders,
            leechers,
            publishDate: item.pubDate ? new Date(item.pubDate) : new Date(),
            downloadUrl: item.link || item.enclosure?.['@_url'] || '',
            infoHash: getAttr('infohash'),
            guid: item.guid || '',
            format: metadata.format,
            bitrate: metadata.bitrate,
            hasChapters: metadata.hasChapters,
          };

          results.push(result);
        } catch (error) {
          console.error('Failed to parse RSS item:', error);
          // Continue with other items
        }
      }

      console.log(`RSS feed for indexer ${indexerId} returned ${results.length} results`);

      return results;
    } catch (error) {
      console.error(`Failed to get RSS feed for indexer ${indexerId}:`, error);
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
        console.error(`Failed to get RSS feed for indexer ${indexerId}:`, error);
        // Continue with other indexers even if one fails
      }
    }

    console.log(`RSS feeds from ${indexerIds.length} indexers returned ${allResults.length} total results`);

    return allResults;
  }

  /**
   * Transform Prowlarr result to our TorrentResult format
   */
  private transformResult(result: ProwlarrSearchResult): TorrentResult | null {
    try {
      // Extract metadata from title
      const metadata = this.extractMetadata(result.title);

      return {
        indexer: result.indexer,
        title: result.title,
        size: result.size,
        seeders: result.seeders,
        leechers: result.leechers,
        publishDate: new Date(result.publishDate),
        downloadUrl: result.downloadUrl,
        infoHash: result.infoHash,
        guid: result.guid,
        format: metadata.format,
        bitrate: metadata.bitrate,
        hasChapters: metadata.hasChapters,
      };
    } catch (error) {
      console.error('Failed to transform result:', result, error);
      return null;
    }
  }

  /**
   * Extract audiobook metadata from torrent title
   */
  private extractMetadata(title: string): {
    format?: 'M4B' | 'M4A' | 'MP3';
    bitrate?: string;
    hasChapters?: boolean;
  } {
    const upperTitle = title.toUpperCase();

    // Detect format
    let format: 'M4B' | 'M4A' | 'MP3' | undefined;
    if (upperTitle.includes('M4B')) {
      format = 'M4B';
    } else if (upperTitle.includes('M4A')) {
      format = 'M4A';
    } else if (upperTitle.includes('MP3')) {
      format = 'MP3';
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
      console.warn('Warning: Prowlarr connection test failed');
    }
  }

  return prowlarrService;
}
