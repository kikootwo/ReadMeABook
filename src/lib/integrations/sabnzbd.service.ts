/**
 * Component: SABnzbd Integration Service
 * Documentation: documentation/phase3/sabnzbd.md
 */

import axios, { AxiosInstance } from 'axios';
import https from 'https';
import FormData from 'form-data';
import { RMABLogger } from '@/lib/utils/logger';
import { PathMapper, PathMappingConfig } from '@/lib/utils/path-mapper';
import {
  IDownloadClient,
  DownloadClientType,
  ProtocolType,
  DownloadInfo,
  DownloadStatus,
  AddDownloadOptions,
  ConnectionTestResult,
} from '../interfaces/download-client.interface';

const logger = RMABLogger.create('SABnzbd');

export interface AddNZBOptions {
  category?: string;
  priority?: 'low' | 'normal' | 'high' | 'force';
  paused?: boolean;
  /** Headers to include when fetching the NZB from the source URL */
  sourceHeaders?: Record<string, string>;
}

export interface NZBInfo {
  nzbId: string;
  name: string;
  size: number; // Bytes
  progress: number; // 0.0 to 1.0
  status: NZBStatus;
  downloadSpeed: number; // Bytes/sec
  timeLeft: number; // Seconds
  category: string;
  downloadPath?: string;
  completedAt?: Date;
  errorMessage?: string;
}

export type NZBStatus =
  | 'downloading'
  | 'queued'
  | 'paused'
  | 'extracting'
  | 'completed'
  | 'failed'
  | 'repairing';

export interface QueueItem {
  nzbId: string;
  name: string;
  size: number; // MB (converted to bytes in getNZB)
  sizeLeft: number; // MB
  percentage: number; // 0-100
  status: string; // "Downloading", "Paused", "Queued"
  timeLeft: string; // "0:15:30" format
  category: string;
  priority: string;
}

export interface HistoryItem {
  nzbId: string;
  name: string;
  category: string;
  status: string; // "Completed", "Failed"
  bytes: string; // Size in bytes (as string)
  failMessage: string;
  storage: string; // Download path
  completedTimestamp: string; // Unix timestamp
  downloadTime: string; // Seconds (as string)
}

export interface SABnzbdConfig {
  version: string;
  categories: Array<{
    name: string;
    dir: string;
  }>;
  completeDir: string; // SABnzbd's configured complete download folder
}

export interface DownloadProgress {
  percent: number;
  bytesDownloaded: number;
  bytesTotal: number;
  speed: number;
  eta: number;
  state: string;
}

export class SABnzbdService implements IDownloadClient {
  readonly clientType: DownloadClientType = 'sabnzbd';
  readonly protocol: ProtocolType = 'usenet';

  private client: AxiosInstance;
  private baseUrl: string;
  private apiKey: string;
  private defaultCategory: string;
  private defaultDownloadDir: string;
  private disableSSLVerify: boolean;
  private httpsAgent?: https.Agent;
  private pathMappingConfig: PathMappingConfig;

  constructor(
    baseUrl: string,
    apiKey: string,
    defaultCategory: string = 'readmeabook',
    defaultDownloadDir: string = '/downloads',
    disableSSLVerify: boolean = false,
    pathMappingConfig?: PathMappingConfig
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey?.trim() || '';
    this.defaultCategory = defaultCategory;
    this.defaultDownloadDir = defaultDownloadDir;
    this.disableSSLVerify = disableSSLVerify;
    this.pathMappingConfig = pathMappingConfig || { enabled: false, remotePath: '', localPath: '' };

    // Configure HTTPS agent if SSL verification is disabled
    if (this.disableSSLVerify && this.baseUrl.startsWith('https')) {
      this.httpsAgent = new https.Agent({
        rejectUnauthorized: false,
      });
    }

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      httpsAgent: this.httpsAgent,
    });
  }

  /**
   * Test connection to SABnzbd
   */
  async testConnection(): Promise<ConnectionTestResult> {
    try {
      // Validate API key is not empty
      if (!this.apiKey || this.apiKey.trim() === '') {
        return {
          success: false,
          message: 'API key is required for SABnzbd',
        };
      }

      // Use queue endpoint to test authentication (requires valid API key)
      const response = await this.client.get('/api', {
        params: {
          mode: 'queue',
          output: 'json',
          apikey: this.apiKey,
        },
      });

      // Check if SABnzbd returned an error (invalid API key)
      // SABnzbd can return errors in different formats:
      // - { status: false, error: "message" }
      // - { error: "message" }
      // - Plain text error
      if (response.data?.status === false || response.data?.error) {
        const errorMsg = response.data?.error || 'Authentication failed';
        return {
          success: false,
          message: errorMsg.includes('API Key')
            ? 'Invalid API key. Check your SABnzbd configuration (Config → General → API Key).'
            : errorMsg,
        };
      }

      // Queue endpoint requires auth - if we got here, API key is valid
      // Now get the version
      const version = await this.getVersion();
      return { success: true, version, message: `Connected to SABnzbd v${version}` };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Enhanced error messages for common issues
      if (errorMessage.includes('ECONNREFUSED')) {
        return {
          success: false,
          message: 'Connection refused. Is SABnzbd running and accessible at this URL?',
        };
      } else if (errorMessage.includes('ETIMEDOUT') || errorMessage.includes('ENOTFOUND')) {
        return {
          success: false,
          message: 'Connection timed out. Check the URL and network connectivity.',
        };
      } else if (errorMessage.includes('certificate') || errorMessage.includes('SSL') || errorMessage.includes('TLS')) {
        return {
          success: false,
          message: 'SSL/TLS certificate error. Enable "Disable SSL verification" if using self-signed certificates.',
        };
      } else if (errorMessage.includes('API Key Incorrect') || errorMessage.includes('API Key Required')) {
        return {
          success: false,
          message: 'Invalid API key. Check your SABnzbd configuration (Config → General → API Key).',
        };
      }

      return {
        success: false,
        message: errorMessage,
      };
    }
  }

  /**
   * Get SABnzbd version
   */
  async getVersion(): Promise<string> {
    const response = await this.client.get('/api', {
      params: {
        mode: 'version',
        output: 'json',
        apikey: this.apiKey,
      },
    });

    if (response.data?.version) {
      return response.data.version;
    }

    throw new Error('Failed to get SABnzbd version');
  }

  /**
   * Get SABnzbd configuration including complete download folder
   *
   * SABnzbd config structure:
   * - misc.complete_dir: The base folder where completed downloads are stored
   * - categories: Object mapping category names to their settings (dir is relative to complete_dir)
   */
  async getConfig(): Promise<SABnzbdConfig> {
    const response = await this.client.get('/api', {
      params: {
        mode: 'get_config',
        output: 'json',
        apikey: this.apiKey,
      },
    });

    const config = response.data?.config;
    if (!config) {
      throw new Error('Failed to get SABnzbd configuration');
    }

    // Extract complete_dir from misc section
    // This is where SABnzbd stores completed downloads before category subdirectories are applied
    const completeDir = config.misc?.complete_dir || '';

    logger.debug('SABnzbd config retrieved from API', {
      completeDir: completeDir || '(not configured)',
      downloadDir: config.misc?.download_dir || '(not set)',
      categoryCount: Object.keys(config.categories || {}).length,
      categories: Object.entries(config.categories || {}).map(([name, details]: [string, any]) => ({
        name,
        dir: details.dir || '(root)',
      })),
    });

    return {
      version: config.version || '',
      completeDir,
      categories: Object.entries(config.categories || {}).map(([name, details]: [string, any]) => ({
        name,
        dir: details.dir || '',
      })),
    };
  }

  /**
   * Get SABnzbd's complete download folder
   * This is the base directory where SABnzbd stores completed downloads
   */
  async getCompleteDir(): Promise<string> {
    const config = await this.getConfig();
    return config.completeDir;
  }

  /**
   * Calculate the correct category path for SABnzbd
   *
   * SABnzbd categories use paths relative to complete_dir by default, but can also
   * accept absolute paths. This method calculates the correct path based on:
   * 1. SABnzbd's complete_dir setting
   * 2. RMAB's desired download path
   * 3. Remote path mapping (if enabled)
   *
   * @returns The path to set for the category (relative, absolute, or empty string)
   */
  private calculateCategoryPath(completeDir: string, desiredPath: string): string {
    // Normalize paths for comparison (convert backslashes, remove trailing slashes)
    const normalizeForCompare = (p: string): string => {
      return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    };

    const normalizedComplete = normalizeForCompare(completeDir);
    const normalizedDesired = normalizeForCompare(desiredPath);

    logger.debug('Path comparison (normalized)', {
      completeDir: { original: completeDir, normalized: normalizedComplete },
      desiredPath: { original: desiredPath, normalized: normalizedDesired },
    });

    // Case 1: Desired path exactly matches complete_dir
    // Use empty string so downloads go to complete_dir root
    if (normalizedComplete === normalizedDesired) {
      logger.debug('Path match result: EXACT_MATCH - paths are identical after normalization');
      logger.info('Desired path matches SABnzbd complete_dir, using category root');
      return '';
    }

    // Case 2: Desired path is under complete_dir
    // Calculate relative path (SABnzbd will append it to complete_dir)
    if (normalizedDesired.startsWith(normalizedComplete + '/')) {
      const relativePath = desiredPath.substring(completeDir.length).replace(/^[/\\]+/, '');
      logger.debug('Path match result: SUBDIRECTORY - desired path is under complete_dir', {
        relativePath,
        calculation: `"${desiredPath}".substring(${completeDir.length}) = "${relativePath}"`,
      });
      logger.info(`Desired path is under complete_dir, using relative path: ${relativePath}`);
      return relativePath;
    }

    // Case 3: Desired path is completely different
    // Use absolute path (SABnzbd will use it directly)
    logger.debug('Path match result: DIFFERENT - paths do not overlap, using absolute path');
    logger.info(`Desired path differs from complete_dir, using absolute path: ${desiredPath}`);
    return desiredPath;
  }

  /**
   * Ensure the category exists with the correct download path
   *
   * This method handles the complexity of SABnzbd's path handling:
   * - Fetches SABnzbd's complete_dir to understand where downloads go
   * - Applies remote path mapping to translate between RMAB and SABnzbd perspectives
   * - Calculates the appropriate category path (relative or absolute)
   * - Creates or updates the category as needed
   *
   * Called before every download to ensure path settings stay synchronized.
   */
  async ensureCategory(): Promise<void> {
    try {
      logger.debug('ensureCategory() called - syncing category path with SABnzbd');

      // Get SABnzbd's configuration including complete_dir
      const config = await this.getConfig();
      const completeDir = config.completeDir;

      logger.debug('Retrieved SABnzbd configuration', {
        completeDir: completeDir || '(not set)',
        existingCategories: config.categories.map(c => ({ name: c.name, dir: c.dir || '(root)' })),
      });

      if (!completeDir) {
        logger.warn('SABnzbd complete_dir not found in config, category path may be incorrect');
      }

      // Apply reverse path mapping to get the path from SABnzbd's perspective
      // Example: RMAB sees /downloads, SABnzbd sees /mnt/usenet/complete
      logger.debug('Applying reverse path mapping', {
        inputPath: this.defaultDownloadDir,
        pathMappingEnabled: this.pathMappingConfig.enabled,
        remotePath: this.pathMappingConfig.remotePath || '(not set)',
        localPath: this.pathMappingConfig.localPath || '(not set)',
      });

      const desiredPath = PathMapper.reverseTransform(this.defaultDownloadDir, this.pathMappingConfig);

      const pathWasTransformed = desiredPath !== this.defaultDownloadDir;
      logger.debug('Reverse path mapping result', {
        originalPath: this.defaultDownloadDir,
        transformedPath: desiredPath,
        wasTransformed: pathWasTransformed,
      });

      logger.info('Category path calculation', {
        rmabDownloadDir: this.defaultDownloadDir,
        pathMappingEnabled: this.pathMappingConfig.enabled,
        desiredPathForSab: desiredPath,
        sabCompleteDir: completeDir,
      });

      // Calculate the correct category path
      const categoryPath = completeDir
        ? this.calculateCategoryPath(completeDir, desiredPath)
        : desiredPath; // Fallback to desired path if complete_dir unknown

      logger.debug('Final category path determined', {
        categoryPath: categoryPath || '(empty - downloads to complete_dir root)',
        category: this.defaultCategory,
      });

      // Check if category exists and has the correct path
      const existingCategory = config.categories.find(cat => cat.name === this.defaultCategory);

      logger.debug('Checking existing category', {
        categoryName: this.defaultCategory,
        exists: !!existingCategory,
        currentDir: existingCategory?.dir || '(not set)',
        targetDir: categoryPath || '(root)',
        needsUpdate: existingCategory ? existingCategory.dir !== categoryPath : true,
      });

      if (!existingCategory) {
        // Create new category
        logger.info(`Creating category "${this.defaultCategory}" with path: "${categoryPath || '(root)'}"`);
        logger.debug('SABnzbd API call: set_config (create category)', {
          section: 'categories',
          keyword: this.defaultCategory,
          dir: categoryPath,
        });

        await this.client.get('/api', {
          params: {
            mode: 'set_config',
            section: 'categories',
            keyword: this.defaultCategory,
            dir: categoryPath,
            output: 'json',
            apikey: this.apiKey,
          },
        });

        logger.info(`Category "${this.defaultCategory}" created successfully`);
      } else if (existingCategory.dir !== categoryPath) {
        // Update existing category with new path
        logger.info(`Updating category "${this.defaultCategory}" path from "${existingCategory.dir || '(root)'}" to "${categoryPath || '(root)'}"`);
        logger.debug('SABnzbd API call: set_config (update category)', {
          section: 'categories',
          keyword: this.defaultCategory,
          oldDir: existingCategory.dir,
          newDir: categoryPath,
        });

        await this.client.get('/api', {
          params: {
            mode: 'set_config',
            section: 'categories',
            keyword: this.defaultCategory,
            dir: categoryPath,
            output: 'json',
            apikey: this.apiKey,
          },
        });

        logger.info(`Category "${this.defaultCategory}" path updated successfully`);
      } else {
        logger.debug(`Category "${this.defaultCategory}" already has correct path: "${categoryPath || '(root)'}" - no update needed`);
      }
    } catch (error) {
      logger.error('Failed to ensure category', { error: error instanceof Error ? error.message : String(error) });
      // Don't throw - category issues shouldn't block downloads
      // Downloads will still work, just may end up in wrong location
    }
  }

  /**
   * Add NZB to SABnzbd
   *
   * Downloads the NZB file content from the source URL (typically a Prowlarr proxy URL)
   * and uploads it directly to SABnzbd via mode=addfile. This ensures SABnzbd does not
   * need network access to Prowlarr — RMAB acts as the intermediary, matching the pattern
   * used by qBittorrent for .torrent files.
   *
   * @param url - NZB download URL (usually a Prowlarr proxy URL)
   * @param options - Category, priority, and pause options
   * @returns SABnzbd NZB ID (nzo_id)
   */
  async addNZB(url: string, options?: AddNZBOptions): Promise<string> {
    logger.info(`Adding NZB from URL: ${url.substring(0, 150)}...`);

    const category = options?.category || this.defaultCategory;

    // Ensure category exists with correct path before every download
    // This syncs the category path with SABnzbd's complete_dir and handles path mapping
    await this.ensureCategory();

    // Download the NZB file content from the source URL
    // This decouples SABnzbd from needing direct network access to Prowlarr
    let nzbBuffer: Buffer;
    let filename: string;

    try {
      logger.info('Downloading NZB file from source URL...');

      const nzbResponse = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000,
        maxRedirects: 5,
        headers: options?.sourceHeaders,
        // Use the same SSL settings as the SABnzbd client if the NZB URL
        // happens to be served over HTTPS with a self-signed cert
        httpsAgent: url.startsWith('https') ? this.httpsAgent : undefined,
      });

      nzbBuffer = Buffer.from(nzbResponse.data);

      if (nzbBuffer.length === 0) {
        throw new Error('NZB file is empty (0 bytes)');
      }

      logger.info(`Downloaded NZB file: ${nzbBuffer.length} bytes`);

      // Extract filename from Content-Disposition header, URL path, or use fallback
      filename = this.extractNZBFilename(url, nzbResponse.headers['content-disposition']);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status) {
          throw new Error(`Failed to download NZB file: HTTP ${status} from source URL`);
        }
        if (error.code === 'ECONNREFUSED') {
          throw new Error('Failed to download NZB file: Connection refused. Is Prowlarr running?');
        }
        if (error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
          throw new Error('Failed to download NZB file: Connection timed out. Check Prowlarr URL and network.');
        }
      }
      throw error;
    }

    // Upload NZB file content to SABnzbd via mode=addfile (multipart POST)
    const formData = new FormData();
    formData.append('nzbfile', nzbBuffer, {
      filename,
      contentType: 'application/x-nzb',
    });
    formData.append('mode', 'addfile');
    formData.append('cat', category);
    formData.append('priority', this.mapPriority(options?.priority));
    formData.append('pp', '3'); // Post-processing: +Repair, +Unpack, +Delete
    formData.append('output', 'json');
    formData.append('apikey', this.apiKey);

    const response = await this.client.post('/api', formData, {
      headers: formData.getHeaders(),
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    if (response.data?.status === false) {
      throw new Error(response.data.error || 'Failed to add NZB to SABnzbd');
    }

    const nzbIds = response.data?.nzo_ids;
    if (!nzbIds || nzbIds.length === 0) {
      throw new Error('SABnzbd did not return an NZB ID');
    }

    const nzbId = nzbIds[0];
    logger.info(`Added NZB: ${nzbId}`);

    return nzbId;
  }

  /**
   * Extract a usable filename for the NZB upload.
   * Tries Content-Disposition header first, then URL path, then falls back to a default.
   */
  private extractNZBFilename(url: string, contentDisposition?: string): string {
    // Try Content-Disposition header (e.g., 'attachment; filename="My.Audiobook.nzb"')
    if (contentDisposition) {
      const match = contentDisposition.match(/filename[*]?=(?:UTF-8''|"?)([^";]+)/i);
      if (match?.[1]) {
        const decoded = decodeURIComponent(match[1].replace(/"+$/, ''));
        if (decoded) {
          logger.debug(`Filename from Content-Disposition: ${decoded}`);
          return decoded.endsWith('.nzb') ? decoded : `${decoded}.nzb`;
        }
      }
    }

    // Try extracting from URL path (before query params)
    try {
      const urlPath = new URL(url).pathname;
      const basename = urlPath.split('/').pop();
      if (basename && basename.length > 0 && basename !== 'download') {
        const decoded = decodeURIComponent(basename);
        logger.debug(`Filename from URL path: ${decoded}`);
        return decoded.endsWith('.nzb') ? decoded : `${decoded}.nzb`;
      }
    } catch {
      // URL parsing failed, fall through to default
    }

    return 'download.nzb';
  }

  /**
   * Get NZB info by ID
   * Checks queue first, then history
   */
  async getNZB(nzbId: string): Promise<NZBInfo | null> {
    // Check queue first
    const queue = await this.getQueue();
    const queueItem = queue.find(item => item.nzbId === nzbId);

    if (queueItem) {
      return this.mapQueueItemToNZBInfo(queueItem);
    }

    // Not in queue, check history
    const history = await this.getHistory(100);
    const historyItem = history.find(item => item.nzbId === nzbId);

    if (historyItem) {
      return this.mapHistoryItemToNZBInfo(historyItem);
    }

    // Not found
    return null;
  }

  /**
   * Get current download queue
   */
  async getQueue(): Promise<QueueItem[]> {
    const response = await this.client.get('/api', {
      params: {
        mode: 'queue',
        output: 'json',
        apikey: this.apiKey,
      },
    });

    const slots = response.data?.queue?.slots || [];
    return slots.map((slot: any) => ({
      nzbId: slot.nzo_id,
      name: slot.filename,
      size: parseFloat(slot.mb || '0'),
      sizeLeft: parseFloat(slot.mbleft || '0'),
      percentage: parseInt(slot.percentage || '0', 10),
      status: slot.status,
      timeLeft: slot.timeleft || '0:00:00',
      category: slot.cat || '',
      priority: slot.priority || 'Normal',
    }));
  }

  /**
   * Get download history
   */
  async getHistory(limit: number = 100): Promise<HistoryItem[]> {
    const response = await this.client.get('/api', {
      params: {
        mode: 'history',
        limit,
        output: 'json',
        apikey: this.apiKey,
      },
    });

    const slots = response.data?.history?.slots || [];
    return slots.map((slot: any) => ({
      nzbId: slot.nzo_id,
      name: slot.name,
      category: slot.category || '',
      status: slot.status,
      bytes: slot.bytes || '0',
      failMessage: slot.fail_message || '',
      storage: slot.storage || '',
      completedTimestamp: slot.completed || '0',
      downloadTime: slot.download_time || '0',
    }));
  }

  /**
   * Pause NZB download
   */
  async pauseNZB(nzbId: string): Promise<void> {
    await this.client.get('/api', {
      params: {
        mode: 'pause',
        value: nzbId,
        output: 'json',
        apikey: this.apiKey,
      },
    });
  }

  /**
   * Resume NZB download
   */
  async resumeNZB(nzbId: string): Promise<void> {
    await this.client.get('/api', {
      params: {
        mode: 'resume',
        value: nzbId,
        output: 'json',
        apikey: this.apiKey,
      },
    });
  }

  /**
   * Delete NZB download from queue
   */
  async deleteNZB(nzbId: string, deleteFiles: boolean = false): Promise<void> {
    logger.info(`Deleting NZB from queue: ${nzbId} (del_files: ${deleteFiles ? '1' : '0'})`);

    const response = await this.client.get('/api', {
      params: {
        mode: 'queue',
        name: 'delete',
        value: nzbId,
        del_files: deleteFiles ? '1' : '0',
        output: 'json',
        apikey: this.apiKey,
      },
    });

    logger.info(`SABnzbd queue delete response: ${JSON.stringify(response.data)}`);

    // Check if SABnzbd returned an error
    if (response.data?.status === false) {
      throw new Error(response.data.error || `Failed to delete NZB ${nzbId} from queue`);
    }
  }

  /**
   * Archive NZB from history (hides from main view but preserves for troubleshooting)
   * Note: SABnzbd's default behavior is to archive. Use archive=0 to permanently delete.
   */
  async archiveFromHistory(nzbId: string): Promise<void> {
    logger.info(`Archiving NZB from history: ${nzbId}`);

    const response = await this.client.get('/api', {
      params: {
        mode: 'history',
        name: 'delete',
        value: nzbId,
        // No del_files parameter - we'll handle file cleanup manually
        // No archive parameter - defaults to archive=1 (move to hidden archive, not permanent delete)
        output: 'json',
        apikey: this.apiKey,
      },
    });

    logger.info(`SABnzbd history archive response: ${JSON.stringify(response.data)}`);

    // Check if SABnzbd returned an error
    if (response.data?.status === false) {
      throw new Error(response.data.error || `Failed to archive NZB ${nzbId} from history`);
    }
  }

  /**
   * Archive completed NZB from history after file organization
   * Note: Only archives from history (not queue). If still in queue, something went wrong.
   * Archives to SABnzbd's hidden archive (preserves for troubleshooting, doesn't permanently delete)
   */
  async archiveCompletedNZB(nzbId: string): Promise<void> {
    logger.info(`Attempting to archive completed NZB ${nzbId}`);

    try {
      await this.archiveFromHistory(nzbId);
      logger.info(`Successfully archived ${nzbId} from history`);
    } catch (error) {
      logger.error(`Failed to archive ${nzbId} from history`, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(`NZB ${nzbId} not found in history or failed to archive`);
    }
  }

  // =========================================================================
  // IDownloadClient Implementation
  // =========================================================================

  /**
   * Add a download via the unified interface.
   * Delegates to addNZB with mapped options.
   */
  async addDownload(url: string, options?: AddDownloadOptions): Promise<string> {
    const priorityMap: Record<string, 'low' | 'normal' | 'high' | 'force'> = {
      low: 'low',
      normal: 'normal',
      high: 'high',
      force: 'force',
    };

    return this.addNZB(url, {
      category: options?.category,
      priority: options?.priority ? priorityMap[options.priority] || 'normal' : undefined,
      paused: options?.paused,
      sourceHeaders: options?.sourceHeaders,
    });
  }

  /**
   * Get download status via the unified interface.
   * Checks both queue and history to find the NZB.
   */
  async getDownload(id: string): Promise<DownloadInfo | null> {
    const nzbInfo = await this.getNZB(id);
    if (!nzbInfo) {
      return null;
    }
    return this.mapNZBInfoToDownloadInfo(nzbInfo);
  }

  /** Pause a download via the unified interface */
  async pauseDownload(id: string): Promise<void> {
    return this.pauseNZB(id);
  }

  /** Resume a download via the unified interface */
  async resumeDownload(id: string): Promise<void> {
    return this.resumeNZB(id);
  }

  /** Delete a download via the unified interface */
  async deleteDownload(id: string, deleteFiles: boolean = false): Promise<void> {
    return this.deleteNZB(id, deleteFiles);
  }

  /**
   * Post-download cleanup via the unified interface.
   * Archives the completed NZB from SABnzbd history.
   */
  async postProcess(id: string): Promise<void> {
    await this.archiveCompletedNZB(id);
  }

  /** Not applicable for usenet clients */
  async getCategories(): Promise<string[]> {
    return [];
  }

  /** Not applicable for usenet clients */
  async setCategory(_id: string, _category: string): Promise<void> {
    // No-op: post-import category is scoped to torrent clients
  }

  /**
   * Map NZBInfo to the unified DownloadInfo format.
   */
  private mapNZBInfoToDownloadInfo(nzb: NZBInfo): DownloadInfo {
    return {
      id: nzb.nzbId,
      name: nzb.name,
      size: nzb.size,
      bytesDownloaded: Math.round(nzb.size * nzb.progress),
      progress: nzb.progress,
      status: this.mapNZBStatusToDownloadStatus(nzb.status),
      downloadSpeed: nzb.downloadSpeed,
      eta: nzb.timeLeft,
      category: nzb.category,
      downloadPath: nzb.downloadPath,
      completedAt: nzb.completedAt,
      errorMessage: nzb.errorMessage,
      // Usenet has no seeding concept
      seedingTime: undefined,
      ratio: undefined,
    };
  }

  /**
   * Map SABnzbd NZB status to unified DownloadStatus.
   */
  private mapNZBStatusToDownloadStatus(status: NZBStatus): DownloadStatus {
    const statusMap: Record<NZBStatus, DownloadStatus> = {
      downloading: 'downloading',
      queued: 'queued',
      paused: 'paused',
      extracting: 'processing',
      completed: 'completed',
      failed: 'failed',
      repairing: 'processing',
    };

    return statusMap[status] || 'downloading';
  }

  // =========================================================================
  // Legacy Methods (used internally and by direct callers)
  // =========================================================================

  /**
   * Get download progress from queue item
   */
  getDownloadProgress(queueItem: QueueItem): DownloadProgress {
    const bytesTotal = queueItem.size * 1024 * 1024; // Convert MB to bytes
    const bytesLeft = queueItem.sizeLeft * 1024 * 1024;
    const bytesDownloaded = bytesTotal - bytesLeft;
    const percent = queueItem.percentage / 100; // Convert 0-100 to 0.0-1.0

    // Parse time left (format: "0:15:30")
    let etaSeconds = 0;
    if (queueItem.timeLeft && queueItem.timeLeft !== '0:00:00') {
      const parts = queueItem.timeLeft.split(':');
      if (parts.length === 3) {
        etaSeconds = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
      }
    }

    // Calculate speed (bytes/sec)
    const speed = etaSeconds > 0 ? bytesLeft / etaSeconds : 0;

    // Map SABnzbd status to our state format
    let state = 'downloading';
    const statusLower = queueItem.status.toLowerCase();
    if (statusLower.includes('paused')) {
      state = 'paused';
    } else if (statusLower.includes('queued')) {
      state = 'queued';
    } else if (statusLower.includes('extracting') || statusLower.includes('unpacking')) {
      state = 'extracting';
    } else if (statusLower.includes('repairing') || statusLower.includes('verifying')) {
      state = 'repairing';
    } else if (percent >= 1.0) {
      state = 'completed';
    }

    return {
      percent: Math.min(percent, 1.0),
      bytesDownloaded,
      bytesTotal,
      speed,
      eta: etaSeconds,
      state,
    };
  }

  /**
   * Map queue item to NZBInfo
   */
  private mapQueueItemToNZBInfo(queueItem: QueueItem): NZBInfo {
    const progress = this.getDownloadProgress(queueItem);
    return {
      nzbId: queueItem.nzbId,
      name: queueItem.name,
      size: queueItem.size * 1024 * 1024, // MB to bytes
      progress: progress.percent,
      status: progress.state as NZBStatus,
      downloadSpeed: progress.speed,
      timeLeft: progress.eta,
      category: queueItem.category,
    };
  }

  /**
   * Map history item to NZBInfo
   */
  private mapHistoryItemToNZBInfo(historyItem: HistoryItem): NZBInfo {
    const isCompleted = historyItem.status.toLowerCase().includes('completed');
    const isFailed = historyItem.status.toLowerCase().includes('failed');

    return {
      nzbId: historyItem.nzbId,
      name: historyItem.name,
      size: parseInt(historyItem.bytes || '0', 10),
      progress: isCompleted ? 1.0 : 0.0,
      status: isFailed ? 'failed' : isCompleted ? 'completed' : 'downloading',
      downloadSpeed: 0,
      timeLeft: 0,
      category: historyItem.category,
      downloadPath: historyItem.storage,
      completedAt: historyItem.completedTimestamp ? new Date(parseInt(historyItem.completedTimestamp) * 1000) : undefined,
      errorMessage: historyItem.failMessage || undefined,
    };
  }

  /**
   * Map priority option to SABnzbd priority value
   */
  private mapPriority(priority?: 'low' | 'normal' | 'high' | 'force'): string {
    switch (priority) {
      case 'force':
        return '2'; // Force (highest)
      case 'high':
        return '1'; // High
      case 'low':
        return '-1'; // Low
      case 'normal':
      default:
        return '0'; // Normal
    }
  }
}

/**
 * Singleton instance and factory
 */
let sabnzbdServiceInstance: SABnzbdService | null = null;
let configLoaded = false;

export async function getSABnzbdService(): Promise<SABnzbdService> {
  // Always recreate if config hasn't been loaded successfully
  if (sabnzbdServiceInstance && configLoaded) {
    return sabnzbdServiceInstance;
  }

  try {
    // Load configuration from download client manager (uses new multi-client config format)
    const { getConfigService } = await import('../services/config.service');
    const { getDownloadClientManager } = await import('../services/download-client-manager.service');
    const configService = await getConfigService();
    const manager = getDownloadClientManager(configService);

    logger.info('Loading configuration from download client manager...');
    const clientConfig = await manager.getClientForProtocol('usenet');

    if (!clientConfig) {
      throw new Error('SABnzbd is not configured. Please configure a SABnzbd client in the admin settings.');
    }

    if (clientConfig.type !== 'sabnzbd') {
      throw new Error(`Expected SABnzbd client but found ${clientConfig.type}`);
    }

    // Get download_dir from main config, applying customPath if configured
    const baseDir = await configService.get('download_dir') || '/downloads';
    const downloadDir = clientConfig.customPath
      ? require('path').join(baseDir, clientConfig.customPath)
      : baseDir;

    logger.debug('RMAB download_dir from config', { downloadDir });

    // Build path mapping configuration from client settings
    const pathMappingConfig: PathMappingConfig = {
      enabled: clientConfig.remotePathMappingEnabled || false,
      remotePath: clientConfig.remotePath || '',
      localPath: clientConfig.localPath || '',
    };

    logger.debug('Path mapping configuration built', {
      enabled: pathMappingConfig.enabled,
      remotePath: pathMappingConfig.remotePath || '(not set)',
      localPath: pathMappingConfig.localPath || '(not set)',
      explanation: pathMappingConfig.enabled
        ? `Will translate "${pathMappingConfig.localPath}" ↔ "${pathMappingConfig.remotePath}"`
        : 'Path mapping disabled - paths used as-is',
    });

    logger.info('Config loaded:', {
      name: clientConfig.name,
      hasUrl: !!clientConfig.url,
      hasApiKey: !!clientConfig.password,
      disableSSLVerify: clientConfig.disableSSLVerify,
      downloadDir,
      pathMappingEnabled: pathMappingConfig.enabled,
    });

    if (!clientConfig.url || !clientConfig.password) {
      throw new Error('SABnzbd is not fully configured. Please check your configuration in admin settings.');
    }

    sabnzbdServiceInstance = new SABnzbdService(
      clientConfig.url,
      clientConfig.password, // API key stored in password field
      clientConfig.category || 'readmeabook',
      downloadDir,
      clientConfig.disableSSLVerify,
      pathMappingConfig
    );

    // Ensure category exists with correct path (handles path mapping and complete_dir sync)
    await sabnzbdServiceInstance.ensureCategory();

    configLoaded = true;
    return sabnzbdServiceInstance;
  } catch (error) {
    logger.error('Failed to initialize service', { error: error instanceof Error ? error.message : String(error) });
    sabnzbdServiceInstance = null;
    configLoaded = false;
    throw error;
  }
}

export function invalidateSABnzbdService(): void {
  sabnzbdServiceInstance = null;
  configLoaded = false;
  logger.info('Service singleton invalidated');
}
