/**
 * Component: Thumbnail Cache Service
 * Documentation: documentation/integrations/audible.md
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import axios from 'axios';

const CACHE_DIR = '/app/cache/thumbnails';
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB max per image
const TIMEOUT_MS = 10000; // 10 second timeout for downloads

export class ThumbnailCacheService {
  /**
   * Ensure cache directory exists
   */
  private async ensureCacheDir(): Promise<void> {
    try {
      await fs.mkdir(CACHE_DIR, { recursive: true });
    } catch (error) {
      console.error('[ThumbnailCache] Failed to create cache directory:', error);
      throw error;
    }
  }

  /**
   * Generate a unique filename for a cached thumbnail
   * @param asin - Audible ASIN
   * @param url - Original URL (used for extension)
   * @returns Filename for cached thumbnail
   */
  private generateFilename(asin: string, url: string): string {
    // Extract file extension from URL (default to .jpg if not found)
    const urlPath = new URL(url).pathname;
    const ext = path.extname(urlPath) || '.jpg';

    // Use ASIN as filename for easy lookup and cleanup
    return `${asin}${ext}`;
  }

  /**
   * Download and cache a thumbnail from a URL
   * @param asin - Audible ASIN
   * @param url - URL of the thumbnail to download
   * @returns Local file path of cached thumbnail, or null if failed
   */
  async cacheThumbnail(asin: string, url: string): Promise<string | null> {
    if (!url || !asin) {
      return null;
    }

    try {
      await this.ensureCacheDir();

      const filename = this.generateFilename(asin, url);
      const filePath = path.join(CACHE_DIR, filename);

      // Check if file already exists
      try {
        await fs.access(filePath);
        // File exists, return path
        return filePath;
      } catch {
        // File doesn't exist, proceed with download
      }

      // Download image
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: TIMEOUT_MS,
        maxContentLength: MAX_FILE_SIZE,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      // Verify content type is an image
      const contentType = response.headers['content-type'];
      if (!contentType || !contentType.startsWith('image/')) {
        console.warn(`[ThumbnailCache] Invalid content type for ${asin}: ${contentType}`);
        return null;
      }

      // Write to file
      await fs.writeFile(filePath, Buffer.from(response.data));

      console.log(`[ThumbnailCache] Cached thumbnail for ${asin}: ${filePath}`);
      return filePath;
    } catch (error) {
      // Log error but don't throw - we'll fall back to the original URL
      console.error(`[ThumbnailCache] Failed to cache thumbnail for ${asin}:`, error);
      return null;
    }
  }

  /**
   * Delete a cached thumbnail
   * @param asin - Audible ASIN
   */
  async deleteThumbnail(asin: string): Promise<void> {
    try {
      // Find all files matching this ASIN (with any extension)
      const files = await fs.readdir(CACHE_DIR);
      const asinFiles = files.filter(f => f.startsWith(asin + '.'));

      for (const file of asinFiles) {
        const filePath = path.join(CACHE_DIR, file);
        await fs.unlink(filePath);
        console.log(`[ThumbnailCache] Deleted thumbnail: ${filePath}`);
      }
    } catch (error) {
      console.error(`[ThumbnailCache] Failed to delete thumbnail for ${asin}:`, error);
    }
  }

  /**
   * Clean up thumbnails that are no longer referenced in the database
   * @param activeAsins - Set of ASINs that should be kept
   */
  async cleanupUnusedThumbnails(activeAsins: Set<string>): Promise<number> {
    try {
      await this.ensureCacheDir();

      const files = await fs.readdir(CACHE_DIR);
      let deletedCount = 0;

      for (const file of files) {
        // Extract ASIN from filename (remove extension)
        const asin = path.parse(file).name;

        // If ASIN is not in active set, delete the file
        if (!activeAsins.has(asin)) {
          const filePath = path.join(CACHE_DIR, file);
          await fs.unlink(filePath);
          deletedCount++;
          console.log(`[ThumbnailCache] Deleted unused thumbnail: ${file}`);
        }
      }

      console.log(`[ThumbnailCache] Cleanup complete: ${deletedCount} thumbnails deleted`);
      return deletedCount;
    } catch (error) {
      console.error('[ThumbnailCache] Failed to cleanup thumbnails:', error);
      return 0;
    }
  }

  /**
   * Get the cached path for a thumbnail
   * @param cachedPath - Path from database
   * @returns Path relative to app root for serving
   */
  getCachedPath(cachedPath: string | null): string | null {
    if (!cachedPath) {
      return null;
    }

    // Return path relative to /app for serving
    return cachedPath.replace('/app/', '/');
  }

  /**
   * Get cache directory (for mounting in Docker)
   */
  getCacheDirectory(): string {
    return CACHE_DIR;
  }
}

// Singleton instance
let thumbnailCacheService: ThumbnailCacheService | null = null;

export function getThumbnailCacheService(): ThumbnailCacheService {
  if (!thumbnailCacheService) {
    thumbnailCacheService = new ThumbnailCacheService();
  }
  return thumbnailCacheService;
}
