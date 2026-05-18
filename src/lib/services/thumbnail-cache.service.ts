/**
 * Component: Thumbnail Cache Service
 * Documentation: documentation/integrations/audible.md
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import axios from 'axios';
import { RMAB_USER_AGENT } from '../utils/user-agent';
import { RMABLogger } from '../utils/logger';

const logger = RMABLogger.create('ThumbnailCache');

const CACHE_DIR = '/app/cache/thumbnails';
const LIBRARY_CACHE_DIR = '/app/cache/library';
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
      logger.error(`Failed to create cache directory: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Ensure library cache directory exists
   */
  private async ensureLibraryCacheDir(): Promise<void> {
    try {
      await fs.mkdir(LIBRARY_CACHE_DIR, { recursive: true });
    } catch (error) {
      logger.error(`Failed to create library cache directory: ${error instanceof Error ? error.message : String(error)}`);
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
   * Generate a unique filename for a library cover using SHA-256 hash
   * @param plexGuid - Plex/ABS unique identifier (may contain special chars)
   * @param url - Original URL (used for extension)
   * @returns Filename for cached library cover
   */
  private generateLibraryFilename(plexGuid: string, url: string): string {
    // Hash the plexGuid to handle special characters (://, ?, etc.)
    const hash = crypto.createHash('sha256').update(plexGuid).digest('hex').substring(0, 16);

    // Extract file extension from URL (default to .jpg if not found)
    let ext = '.jpg';
    try {
      const urlPath = new URL(url).pathname;
      ext = path.extname(urlPath) || '.jpg';
    } catch {
      // If URL parsing fails, use default extension
    }

    return `${hash}${ext}`;
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
          'User-Agent': RMAB_USER_AGENT,
        },
      });

      // Verify content type is an image
      const contentType = response.headers['content-type'];
      if (!contentType || !contentType.startsWith('image/')) {
        logger.warn(`Invalid content type for ${asin}: ${contentType}`);
        return null;
      }

      // Write to file
      await fs.writeFile(filePath, Buffer.from(response.data));

      logger.info(`Cached thumbnail for ${asin}: ${filePath}`);
      return filePath;
    } catch (error) {
      // Log warning but don't throw - we'll fall back to the original URL
      logger.warn(`Failed to cache thumbnail for ${asin}: ${error instanceof Error ? error.message : String(error)} - will use remote URL`);
      return null;
    }
  }

  /**
   * Download and cache a library thumbnail from Plex/Audiobookshelf
   * @param plexGuid - Plex/ABS unique identifier
   * @param coverUrl - URL of the cover (full URL or relative path)
   * @param backendBaseUrl - Base URL of backend (Plex or ABS server)
   * @param authToken - Authentication token
   * @param backendMode - 'plex' or 'audiobookshelf'
   * @returns Local file path of cached thumbnail, or null if failed
   */
  async cacheLibraryThumbnail(
    plexGuid: string,
    coverUrl: string,
    backendBaseUrl: string,
    authToken: string,
    backendMode: 'plex' | 'audiobookshelf'
  ): Promise<string | null> {
    if (!coverUrl || !plexGuid || !backendBaseUrl || !authToken) {
      return null;
    }

    try {
      await this.ensureLibraryCacheDir();

      const filename = this.generateLibraryFilename(plexGuid, coverUrl);
      const filePath = path.join(LIBRARY_CACHE_DIR, filename);

      // Check if file already exists (skip download for subsequent scans)
      try {
        await fs.access(filePath);
        // File exists, return path immediately
        return filePath;
      } catch {
        // File doesn't exist, proceed with download
      }

      // Construct full URL based on backend mode
      let fullUrl: string;
      if (backendMode === 'plex') {
        // Plex uses token in query string
        const separator = coverUrl.includes('?') ? '&' : '?';
        fullUrl = `${backendBaseUrl}${coverUrl}${separator}X-Plex-Token=${authToken}`;
      } else {
        // Audiobookshelf uses Authorization header
        fullUrl = coverUrl.startsWith('http') ? coverUrl : `${backendBaseUrl}${coverUrl}`;
      }

      // Download image
      const response = await axios.get(fullUrl, {
        responseType: 'arraybuffer',
        timeout: TIMEOUT_MS,
        maxContentLength: MAX_FILE_SIZE,
        headers: {
          'User-Agent': RMAB_USER_AGENT,
          ...(backendMode === 'audiobookshelf' && { Authorization: `Bearer ${authToken}` }),
        },
      });

      // Verify content type is an image
      const contentType = response.headers['content-type'];
      if (!contentType || !contentType.startsWith('image/')) {
        logger.warn(`Invalid content type for library cover ${plexGuid}: ${contentType}`);
        return null;
      }

      // Write to file
      await fs.writeFile(filePath, Buffer.from(response.data));

      logger.info(`Cached library thumbnail for ${plexGuid}: ${filePath}`);
      return filePath;
    } catch (error) {
      // Log warning but don't throw - graceful degradation
      logger.warn(`Failed to cache library thumbnail for ${plexGuid}: ${error instanceof Error ? error.message : String(error)}`);
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
        logger.info(`Deleted thumbnail: ${filePath}`);
      }
    } catch (error) {
      logger.error(`Failed to delete thumbnail for ${asin}: ${error instanceof Error ? error.message : String(error)}`);
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
          logger.info(`Deleted unused thumbnail: ${file}`);
        }
      }

      logger.info(`Cleanup complete: ${deletedCount} thumbnails deleted`);
      return deletedCount;
    } catch (error) {
      logger.error(`Failed to cleanup thumbnails: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    }
  }

  /**
   * Clean up library thumbnails that are no longer referenced in the database
   * @param plexGuidToHashMap - Map of plexGuid to hash (for reverse lookup)
   * @returns Number of deleted files
   */
  async cleanupLibraryThumbnails(plexGuidToHashMap: Map<string, string>): Promise<number> {
    try {
      await this.ensureLibraryCacheDir();

      const files = await fs.readdir(LIBRARY_CACHE_DIR);
      let deletedCount = 0;

      // Build reverse map: hash -> plexGuid
      const activeHashes = new Set<string>();
      for (const [plexGuid] of plexGuidToHashMap) {
        // Generate hash for each plexGuid (consistent with generateLibraryFilename)
        const hash = crypto.createHash('sha256').update(plexGuid).digest('hex').substring(0, 16);
        activeHashes.add(hash);
      }

      for (const file of files) {
        // Extract hash from filename (remove extension)
        const hash = path.parse(file).name;

        // If hash is not in active set, delete the file
        if (!activeHashes.has(hash)) {
          const filePath = path.join(LIBRARY_CACHE_DIR, file);
          await fs.unlink(filePath);
          deletedCount++;
          logger.info(`Deleted unused library thumbnail: ${file}`);
        }
      }

      logger.info(`Library cleanup complete: ${deletedCount} thumbnails deleted`);
      return deletedCount;
    } catch (error) {
      logger.error(`Failed to cleanup library thumbnails: ${error instanceof Error ? error.message : String(error)}`);
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
