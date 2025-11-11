/**
 * Component: Prowlarr Integration Service
 * Documentation: documentation/phase3/prowlarr.md
 */

import axios, { AxiosInstance } from 'axios';
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
    // Get configuration from environment or config service
    const baseUrl = process.env.PROWLARR_URL || 'http://prowlarr:9696';
    const apiKey = process.env.PROWLARR_API_KEY;

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
