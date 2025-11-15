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
   * Primary: Audnexus API (reliable, structured data)
   * Fallback: Audible scraping
   */
  async getAudiobookDetails(asin: string): Promise<AudibleAudiobook | null> {
    try {
      console.log(`[Audible] Fetching details for ASIN ${asin}...`);

      // Try Audnexus first (more reliable)
      const audnexusData = await this.fetchFromAudnexus(asin);
      if (audnexusData) {
        console.log(`[Audible] Successfully fetched from Audnexus for "${audnexusData.title}"`);
        return audnexusData;
      }

      console.log(`[Audible] Audnexus failed, falling back to Audible scraping...`);

      // Fallback to Audible scraping
      return await this.scrapeAudibleDetails(asin);
    } catch (error) {
      console.error(`[Audible] Failed to fetch details for ${asin}:`, error);
      return null;
    }
  }

  /**
   * Fetch audiobook details from Audnexus API
   */
  private async fetchFromAudnexus(asin: string): Promise<AudibleAudiobook | null> {
    try {
      console.log(`[Audnexus] Fetching ASIN ${asin}...`);

      const response = await axios.get(`https://api.audnex.us/books/${asin}`, {
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
        narrator: data.narrators?.map((n: any) => n.name).join(', ') || '',
        description: data.description || data.summary || '',
        coverArtUrl: data.image || '',
        durationMinutes: data.runtimeLengthMin ? parseInt(data.runtimeLengthMin) : undefined,
        releaseDate: data.releaseDate || undefined,
        rating: data.rating ? parseFloat(data.rating) : undefined,
        genres: data.genres?.map((g: any) => typeof g === 'string' ? g : g.name).slice(0, 5) || undefined,
      };

      // Ensure cover art URL is high quality
      if (result.coverArtUrl && !result.coverArtUrl.includes('_SL500_')) {
        result.coverArtUrl = result.coverArtUrl.replace(/\._.*_\./, '._SL500_.');
      }

      console.log(`[Audnexus] Success:`, JSON.stringify({
        title: result.title,
        author: result.author,
        narrator: result.narrator,
        descLength: result.description?.length || 0,
        duration: result.durationMinutes,
        rating: result.rating,
        genres: result.genres?.length || 0
      }));

      return result;
    } catch (error: any) {
      if (error.response?.status === 404) {
        console.log(`[Audnexus] Book not found (404) for ASIN ${asin}`);
      } else {
        console.log(`[Audnexus] Error fetching ASIN ${asin}:`, error.message);
      }
      return null;
    }
  }

  /**
   * Scrape audiobook details from Audible (fallback method)
   */
  private async scrapeAudibleDetails(asin: string): Promise<AudibleAudiobook | null> {
    try {
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

      // Debug: Save HTML in development
      const isDev = process.env.NODE_ENV === 'development';
      if (isDev) {
        const fs = require('fs');
        const path = require('path');
        const debugPath = path.join('/tmp', `audible-${asin}.html`);
        fs.writeFileSync(debugPath, response.data);
        console.log(`[Audible] Saved HTML to ${debugPath} for debugging`);
      }

      // Try to extract JSON-LD structured data first
      const jsonLdScripts = $('script[type="application/ld+json"]');
      console.log(`[Audible] Found ${jsonLdScripts.length} JSON-LD script tags`);

      jsonLdScripts.each((i, elem) => {
        try {
          const jsonData = JSON.parse($(elem).html() || '{}');
          console.log(`[Audible] JSON-LD ${i} type:`, jsonData['@type']);

          if (jsonData['@type'] === 'Book' || jsonData['@type'] === 'Audiobook' || jsonData['@type'] === 'Product') {
            console.log('[Audible] Found valid JSON-LD structured data');

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
          console.log(`[Audible] JSON-LD ${i} parsing failed:`, e);
        }
      });

      // Fallback to HTML parsing for any missing fields
      // Title - try multiple selectors
      if (!result.title) {
        result.title = $('h1.bc-heading').first().text().trim() ||
                      $('h1[class*="heading"]').first().text().trim() ||
                      $('.bc-container h1').first().text().trim() ||
                      $('h1').first().text().trim();
        console.log(`[Audible] Title from HTML: "${result.title}"`);
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

        result.author = result.author.replace(/^By:\s*/i, '').replace(/^Written by:\s*/i, '').trim();
        console.log(`[Audible] Author from HTML: "${result.author}"`);
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
          result.narrator = result.narrator.replace(/^Narrated by:\s*/i, '').trim();
        }
        console.log(`[Audible] Narrator from HTML: "${result.narrator || ''}"`);
      }

      // Description - try multiple approaches with strict filtering
      if (!result.description) {
        const excludePatterns = [
          /\$\d+\.\d+/,  // Price patterns
          /cancel anytime/i,
          /free trial/i,
          /membership/i,
          /subscribe/i,
          /offer.*ends/i,
          /^\s*by\s+[\w\s,]+$/i,  // Just author names
        ];

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

        console.log(`[Audible] Description length: ${result.description?.length || 0} chars`);
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
        // Look for runtime text in various places
        const runtimeText =
          $('li.runtimeLabel span').text().trim() ||
          $('.runtimeLabel').text().trim() ||
          $('span:contains("Length:")').parent().text().trim() ||
          $('li:contains("Length:")').text().trim() ||
          (() => {
            // Look for any text matching duration pattern
            let found = '';
            $('li, span, div').each((_, elem) => {
              const text = $(elem).text().trim();
              if (text.match(/\d+\s*(hr|hour|h)\s*\d*\s*(min|minute|m)?/i) && text.length < 100) {
                found = text;
                return false; // break
              }
            });
            return found;
          })();

        result.durationMinutes = this.parseRuntime(runtimeText);
        console.log(`[Audible] Duration from "${runtimeText}": ${result.durationMinutes} minutes`);
      }

      // Rating - try multiple approaches
      if (!result.rating) {
        const ratingText =
          $('.ratingsLabel').text().trim() ||
          $('[class*="rating"]').first().text().trim() ||
          $('span:contains("out of 5 stars")').parent().text().trim() ||
          (() => {
            // Look for rating pattern
            let found = '';
            $('span, div').each((_, elem) => {
              const text = $(elem).text().trim();
              if (text.match(/\d+\.?\d*\s*out of\s*5/i) && text.length < 50) {
                found = text;
                return false;
              }
            });
            return found;
          })();

        if (ratingText) {
          const ratingMatch = ratingText.match(/(\d+\.?\d*)\s*out of/i);
          result.rating = ratingMatch ? parseFloat(ratingMatch[1]) : undefined;
        }
        console.log(`[Audible] Rating from "${ratingText}": ${result.rating}`);
      }

      // Release date - try multiple selectors
      if (!result.releaseDate) {
        const releaseDateText =
          $('li:contains("Release date:")').text().trim() ||
          $('span:contains("Release date:")').parent().text().trim() ||
          $('[class*="release"]').text().trim();

        const dateMatch = releaseDateText.match(/Release date:\s*(.+)/i) ||
                         releaseDateText.match(/(\w+ \d{1,2},? \d{4})/);
        if (dateMatch) {
          result.releaseDate = dateMatch[1].trim();
        }
        console.log(`[Audible] Release date from "${releaseDateText}": ${result.releaseDate}`);
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
        console.log(`[Audible] Genres: ${result.genres.join(', ')}`);
      }

      console.log(`[Audible] Successfully fetched details for "${result.title}"`);
      console.log(`[Audible] Final result:`, JSON.stringify({
        title: result.title,
        author: result.author,
        narrator: result.narrator,
        descLength: result.description?.length || 0,
        duration: result.durationMinutes,
        rating: result.rating,
        genres: result.genres?.length || 0
      }));

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
