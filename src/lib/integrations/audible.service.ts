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
   * Get popular audiobooks from best sellers (with pagination support)
   */
  async getPopularAudiobooks(limit: number = 20): Promise<AudibleAudiobook[]> {
    try {
      console.log(`[Audible] Fetching popular audiobooks (limit: ${limit})...`);

      const audiobooks: AudibleAudiobook[] = [];
      let page = 1;
      const maxPages = Math.ceil(limit / 20); // Audible shows ~20 items per page

      while (audiobooks.length < limit && page <= maxPages) {
        console.log(`[Audible] Fetching page ${page}/${maxPages}...`);

        const response = await this.client.get('/adblbestsellers', {
          params: page > 1 ? { page } : {},
        });
        const $ = cheerio.load(response.data);

        let foundOnPage = 0;

        // Parse audiobook items from best sellers page
        $('.productListItem').each((index, element) => {
          if (audiobooks.length >= limit) return false;

          const $el = $(element);

          // Extract ASIN from data attribute or link
          const asin = $el.find('li').attr('data-asin') ||
                       $el.find('a').attr('href')?.match(/\/pd\/[^\/]+\/([A-Z0-9]{10})/)?.[1] || '';

          if (!asin) return;

          // Skip duplicates
          if (audiobooks.some(book => book.asin === asin)) return;

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

          foundOnPage++;
        });

        console.log(`[Audible] Found ${foundOnPage} audiobooks on page ${page}`);

        // If we got fewer than expected, probably no more pages
        if (foundOnPage < 10) {
          console.log(`[Audible] Reached end of available pages`);
          break;
        }

        page++;

        // Add delay between pages to respect rate limiting
        if (page <= maxPages && audiobooks.length < limit) {
          await this.delay(1500);
        }
      }

      console.log(`[Audible] Found ${audiobooks.length} popular audiobooks across ${page} pages`);
      return audiobooks;
    } catch (error) {
      console.error('[Audible] Failed to fetch popular audiobooks:', error);
      return [];
    }
  }

  /**
   * Get new release audiobooks (with pagination support)
   */
  async getNewReleases(limit: number = 20): Promise<AudibleAudiobook[]> {
    try {
      console.log(`[Audible] Fetching new releases (limit: ${limit})...`);

      const audiobooks: AudibleAudiobook[] = [];
      let page = 1;
      const maxPages = Math.ceil(limit / 20); // Audible shows ~20 items per page

      while (audiobooks.length < limit && page <= maxPages) {
        console.log(`[Audible] Fetching page ${page}/${maxPages}...`);

        const response = await this.client.get('/newreleases', {
          params: page > 1 ? { page } : {},
        });
        const $ = cheerio.load(response.data);

        let foundOnPage = 0;

        // Parse audiobook items from new releases page
        $('.productListItem').each((index, element) => {
          if (audiobooks.length >= limit) return false;

          const $el = $(element);

          const asin = $el.find('li').attr('data-asin') ||
                       $el.find('a').attr('href')?.match(/\/pd\/[^\/]+\/([A-Z0-9]{10})/)?.[1] || '';

          if (!asin) return;

          // Skip duplicates
          if (audiobooks.some(book => book.asin === asin)) return;

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

          foundOnPage++;
        });

        console.log(`[Audible] Found ${foundOnPage} audiobooks on page ${page}`);

        // If we got fewer than expected, probably no more pages
        if (foundOnPage < 10) {
          console.log(`[Audible] Reached end of available pages`);
          break;
        }

        page++;

        // Add delay between pages to respect rate limiting
        if (page <= maxPages && audiobooks.length < limit) {
          await this.delay(1500);
        }
      }

      console.log(`[Audible] Found ${audiobooks.length} new releases across ${page} pages`);
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

      // Initialize result object
      let result: AudibleAudiobook = {
        asin,
        title: '',
        author: '',
        narrator: '',
        description: '',
        coverArtUrl: '',
      };

      // Try to extract JSON-LD structured data first
      const jsonLdScript = $('script[type="application/ld+json"]').html();
      if (jsonLdScript) {
        try {
          const jsonData = JSON.parse(jsonLdScript);
          if (jsonData['@type'] === 'Book' || jsonData['@type'] === 'Audiobook') {
            console.log('[Audible] Found JSON-LD structured data');

            result.title = jsonData.name || '';
            result.author = Array.isArray(jsonData.author)
              ? jsonData.author.map((a: any) => a.name || a).join(', ')
              : jsonData.author?.name || jsonData.author || '';
            result.narrator = Array.isArray(jsonData.readBy)
              ? jsonData.readBy.map((n: any) => n.name || n).join(', ')
              : jsonData.readBy?.name || jsonData.readBy || '';
            result.description = jsonData.description || '';
            result.coverArtUrl = jsonData.image || '';
            result.rating = jsonData.aggregateRating?.ratingValue;
            result.releaseDate = jsonData.datePublished;

            if (jsonData.duration) {
              const durationMatch = jsonData.duration.match(/PT(\d+)H(\d+)M/);
              if (durationMatch) {
                result.durationMinutes = parseInt(durationMatch[1]) * 60 + parseInt(durationMatch[2]);
              }
            }
          }
        } catch (e) {
          console.log('[Audible] JSON-LD parsing failed, falling back to HTML');
        }
      }

      // Fallback to HTML parsing for any missing fields
      // Title - try multiple selectors
      if (!result.title) {
        result.title = $('h1.bc-heading').first().text().trim() ||
                      $('h1[class*="heading"]').first().text().trim() ||
                      $('.bc-container h1').first().text().trim() ||
                      $('h1').first().text().trim();
        console.log(`[Audible] Title from HTML: "${result.title}"`);
      }

      // Author - try multiple selectors
      if (!result.author) {
        result.author = $('li.authorLabel a').text().trim() ||
                       $('span.authorLabel a').text().trim() ||
                       $('.authorLabel').find('a').text().trim() ||
                       $('a[href*="/author/"]').first().text().trim() ||
                       $('.bc-size-small a[href*="/author/"]').first().text().trim();
        result.author = result.author.replace(/^By:\s*/i, '').replace(/^Written by:\s*/i, '').trim();
        console.log(`[Audible] Author from HTML: "${result.author}"`);
      }

      // Narrator - try multiple selectors
      if (!result.narrator) {
        result.narrator = $('li.narratorLabel a').text().trim() ||
                         $('span.narratorLabel a').text().trim() ||
                         $('.narratorLabel').find('a').text().trim() ||
                         $('a[href*="/narrator/"]').first().text().trim() ||
                         $('.bc-size-small a[href*="/narrator/"]').first().text().trim();
        result.narrator = result.narrator.replace(/^Narrated by:\s*/i, '').trim();
        console.log(`[Audible] Narrator from HTML: "${result.narrator}"`);
      }

      // Description - try multiple selectors
      if (!result.description) {
        result.description = $('.bc-expander-content').first().text().trim() ||
                            $('[class*="summary"] [class*="expander"]').text().trim() ||
                            $('.productPublisherSummary').text().trim() ||
                            $('[data-widget="publisherSummary"]').text().trim();
        console.log(`[Audible] Description length: ${result.description.length} chars`);
      }

      // Cover art - try multiple selectors
      if (!result.coverArtUrl) {
        result.coverArtUrl = $('img.bc-image-inset-border').attr('src') ||
                            $('img[class*="image"]').first().attr('src') ||
                            $('.bc-pub-detail-image img').attr('src') ||
                            $('img[src*="images-na.ssl-images-amazon.com"]').first().attr('src') ||
                            '';
        if (result.coverArtUrl) {
          result.coverArtUrl = result.coverArtUrl.replace(/\._.*_\./, '._SL500_.');
        }
      }

      // Runtime/Duration - try multiple selectors
      if (!result.durationMinutes) {
        const runtimeText = $('li.runtimeLabel span').text().trim() ||
                           $('.runtimeLabel').text().trim() ||
                           $('span:contains("Length:")').parent().text().trim();
        result.durationMinutes = this.parseRuntime(runtimeText);
        console.log(`[Audible] Duration: ${result.durationMinutes} minutes`);
      }

      // Rating - try multiple selectors
      if (!result.rating) {
        const ratingText = $('.ratingsLabel').text().trim() ||
                          $('[class*="rating"]').first().text().trim();
        if (ratingText) {
          const ratingMatch = ratingText.match(/(\d+\.?\d*)\s*out of/i);
          result.rating = ratingMatch ? parseFloat(ratingMatch[1]) : undefined;
        }
        console.log(`[Audible] Rating: ${result.rating}`);
      }

      // Release date - try multiple selectors
      if (!result.releaseDate) {
        const releaseDateText = $('li:contains("Release date:")').text().trim() ||
                               $('span:contains("Release date:")').parent().text().trim();
        const dateMatch = releaseDateText.match(/Release date:\s*(.+)/i);
        if (dateMatch) {
          result.releaseDate = dateMatch[1].trim();
        }
      }

      // Genres - try to extract categories
      const genres: string[] = [];
      $('a[href*="/cat/"]').each((_, el) => {
        const genre = $(el).text().trim();
        if (genre && !genres.includes(genre) && genre.length < 50) {
          genres.push(genre);
        }
      });
      if (genres.length > 0) {
        result.genres = genres.slice(0, 5); // Limit to 5 genres
        console.log(`[Audible] Genres: ${result.genres.join(', ')}`);
      }

      console.log(`[Audible] Successfully fetched details for "${result.title}"`);
      return result;
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
