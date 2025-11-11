/**
 * Component: Audible Integration Service (Web Scraping)
 * Documentation: documentation/integrations/audible.md
 */

import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';

export interface AudibleAudiobook {
  asin: string;
  title: string;
  author: string;
  narrator?: string;
  description?: string;
  coverArtUrl?: string;
  durationMinutes?: number;
  releaseDate?: string;
  rating?: number;
  genres?: string[];
}

export interface AudibleSearchResult {
  query: string;
  results: AudibleAudiobook[];
  totalResults: number;
  page: number;
  hasMore: boolean;
}

export class AudibleService {
  private client: AxiosInstance;
  private readonly baseUrl = 'https://www.audible.com';

  constructor() {
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
  }

  /**
   * Get popular audiobooks from best sellers
   */
  async getPopularAudiobooks(limit: number = 20): Promise<AudibleAudiobook[]> {
    try {
      console.log('[Audible] Fetching popular audiobooks...');

      const response = await this.client.get('/adblbestsellers');
      const $ = cheerio.load(response.data);

      const audiobooks: AudibleAudiobook[] = [];

      // Parse audiobook items from best sellers page
      $('.productListItem').each((index, element) => {
        if (audiobooks.length >= limit) return false;

        const $el = $(element);

        // Extract ASIN from data attribute or link
        const asin = $el.find('li').attr('data-asin') ||
                     $el.find('a').attr('href')?.match(/\/pd\/[^\/]+\/([A-Z0-9]{10})/)?.[1] || '';

        if (!asin) return;

        const title = $el.find('h3 a').text().trim() ||
                      $el.find('.bc-heading a').text().trim();

        const authorText = $el.find('.authorLabel').text().trim() ||
                           $el.find('.bc-size-small .bc-text-bold').first().text().trim();

        const narratorText = $el.find('.narratorLabel').text().trim() ||
                             $el.find('.bc-size-small .bc-text-bold').eq(1).text().trim();

        const coverArtUrl = $el.find('img').attr('src') || '';

        const ratingText = $el.find('.ratingsLabel').text().trim();
        const rating = ratingText ? parseFloat(ratingText.split(' ')[0]) : undefined;

        audiobooks.push({
          asin,
          title,
          author: authorText.replace('By:', '').replace('Written by:', '').trim(),
          narrator: narratorText.replace('Narrated by:', '').trim(),
          coverArtUrl: coverArtUrl.replace(/\._.*_\./, '._SL500_.'),
          rating,
        });
      });

      console.log(`[Audible] Found ${audiobooks.length} popular audiobooks`);
      return audiobooks;
    } catch (error) {
      console.error('[Audible] Failed to fetch popular audiobooks:', error);
      return [];
    }
  }

  /**
   * Get new release audiobooks
   */
  async getNewReleases(limit: number = 20): Promise<AudibleAudiobook[]> {
    try {
      console.log('[Audible] Fetching new releases...');

      const response = await this.client.get('/newreleases');
      const $ = cheerio.load(response.data);

      const audiobooks: AudibleAudiobook[] = [];

      // Parse audiobook items from new releases page
      $('.productListItem').each((index, element) => {
        if (audiobooks.length >= limit) return false;

        const $el = $(element);

        const asin = $el.find('li').attr('data-asin') ||
                     $el.find('a').attr('href')?.match(/\/pd\/[^\/]+\/([A-Z0-9]{10})/)?.[1] || '';

        if (!asin) return;

        const title = $el.find('h3 a').text().trim() ||
                      $el.find('.bc-heading a').text().trim();

        const authorText = $el.find('.authorLabel').text().trim() ||
                           $el.find('.bc-size-small .bc-text-bold').first().text().trim();

        const narratorText = $el.find('.narratorLabel').text().trim();

        const coverArtUrl = $el.find('img').attr('src') || '';

        audiobooks.push({
          asin,
          title,
          author: authorText.replace('By:', '').replace('Written by:', '').trim(),
          narrator: narratorText.replace('Narrated by:', '').trim(),
          coverArtUrl: coverArtUrl.replace(/\._.*_\./, '._SL500_.'),
        });
      });

      console.log(`[Audible] Found ${audiobooks.length} new releases`);
      return audiobooks;
    } catch (error) {
      console.error('[Audible] Failed to fetch new releases:', error);
      return [];
    }
  }

  /**
   * Search for audiobooks
   */
  async search(query: string, page: number = 1): Promise<AudibleSearchResult> {
    try {
      console.log(`[Audible] Searching for "${query}"...`);

      const response = await this.client.get('/search', {
        params: {
          keywords: query,
          page,
        },
      });

      const $ = cheerio.load(response.data);

      const audiobooks: AudibleAudiobook[] = [];

      // Parse search results
      $('.productListItem').each((index, element) => {
        const $el = $(element);

        const asin = $el.find('li').attr('data-asin') ||
                     $el.find('a').attr('href')?.match(/\/pd\/[^\/]+\/([A-Z0-9]{10})/)?.[1] || '';

        if (!asin) return;

        const title = $el.find('h3 a').text().trim() ||
                      $el.find('.bc-heading a').text().trim();

        const authorText = $el.find('.authorLabel').text().trim() ||
                           $el.find('.bc-size-small .bc-text-bold').first().text().trim();

        const narratorText = $el.find('.narratorLabel').text().trim();

        const coverArtUrl = $el.find('img').attr('src') || '';

        const runtimeText = $el.find('.runtimeLabel').text().trim();
        const durationMinutes = this.parseRuntime(runtimeText);

        audiobooks.push({
          asin,
          title,
          author: authorText.replace('By:', '').replace('Written by:', '').trim(),
          narrator: narratorText.replace('Narrated by:', '').trim(),
          coverArtUrl: coverArtUrl.replace(/\._.*_\./, '._SL500_.'),
          durationMinutes,
        });
      });

      // Try to extract total results count
      const resultsText = $('.resultsInfo').text().trim();
      const totalResults = parseInt(resultsText.match(/of ([\d,]+)/)?.[1]?.replace(/,/g, '') || '0');

      console.log(`[Audible] Found ${audiobooks.length} results for "${query}"`);

      return {
        query,
        results: audiobooks,
        totalResults,
        page,
        hasMore: audiobooks.length > 0 && totalResults > page * 20,
      };
    } catch (error) {
      console.error('[Audible] Search failed:', error);
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
   * Get detailed audiobook information
   */
  async getAudiobookDetails(asin: string): Promise<AudibleAudiobook | null> {
    try {
      console.log(`[Audible] Fetching details for ASIN ${asin}...`);

      const response = await this.client.get(`/pd/${asin}`);
      const $ = cheerio.load(response.data);

      // Try to extract JSON-LD structured data
      const jsonLdScript = $('script[type="application/ld+json"]').html();
      if (jsonLdScript) {
        try {
          const jsonData = JSON.parse(jsonLdScript);
          if (jsonData['@type'] === 'Book') {
            return {
              asin,
              title: jsonData.name || '',
              author: Array.isArray(jsonData.author)
                ? jsonData.author.map((a: any) => a.name).join(', ')
                : jsonData.author?.name || '',
              narrator: Array.isArray(jsonData.readBy)
                ? jsonData.readBy.map((n: any) => n.name).join(', ')
                : jsonData.readBy?.name,
              description: jsonData.description || '',
              coverArtUrl: jsonData.image || '',
              rating: jsonData.aggregateRating?.ratingValue,
              releaseDate: jsonData.datePublished,
            };
          }
        } catch (e) {
          // Fall through to HTML parsing
        }
      }

      // Fallback to HTML parsing
      const title = $('h1.bc-heading').text().trim();
      const authorText = $('a.authorLabel').text().trim();
      const narratorText = $('a.narratorLabel').text().trim();
      const description = $('.bc-expander-content').text().trim();
      const coverArtUrl = $('img.bc-image-inset-border').attr('src') || '';

      const runtimeText = $('.runtimeLabel').text().trim();
      const durationMinutes = this.parseRuntime(runtimeText);

      const ratingText = $('.ratingsLabel').text().trim();
      const rating = ratingText ? parseFloat(ratingText.split(' ')[0]) : undefined;

      return {
        asin,
        title,
        author: authorText.replace('By:', '').trim(),
        narrator: narratorText.replace('Narrated by:', '').trim(),
        description,
        coverArtUrl: coverArtUrl.replace(/\._.*_\./, '._SL500_.'),
        durationMinutes,
        rating,
      };
    } catch (error) {
      console.error(`[Audible] Failed to fetch details for ${asin}:`, error);
      return null;
    }
  }

  /**
   * Parse runtime text to minutes
   */
  private parseRuntime(runtimeText: string): number | undefined {
    if (!runtimeText) return undefined;

    const hoursMatch = runtimeText.match(/(\d+)\s*hrs?/i);
    const minutesMatch = runtimeText.match(/(\d+)\s*mins?/i);

    let totalMinutes = 0;
    if (hoursMatch) {
      totalMinutes += parseInt(hoursMatch[1]) * 60;
    }
    if (minutesMatch) {
      totalMinutes += parseInt(minutesMatch[1]);
    }

    return totalMinutes > 0 ? totalMinutes : undefined;
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
