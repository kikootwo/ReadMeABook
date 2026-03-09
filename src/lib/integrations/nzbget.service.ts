/**
 * Component: NZBGet Integration Service
 * Documentation: documentation/phase3/download-clients.md
 */

import axios, { AxiosInstance } from 'axios';
import https from 'https';
import zlib from 'zlib';
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

const logger = RMABLogger.create('NZBGet');

// =========================================================================
// NZBGet-specific types
// =========================================================================

/** NZBGet queue group item from listgroups() */
interface NZBGetGroupItem {
  NZBID: number;
  NZBName: string;
  Status: string;
  FileSizeMB: number;
  DownloadedSizeMB: number;
  RemainingSizeMB: number;
  DownloadTimeSec: number;
  Category: string;
  DestDir: string;
  FinalDir: string;
  MaxPriority: number;
  ActiveDownloads: number;
  Health: number;
  PostInfoText: string;
  PostStageProgress: number;
}

/** NZBGet history item from history() */
interface NZBGetHistoryItem {
  NZBID: number;
  Name: string;
  Status: string;
  Category: string;
  FileSizeMB: number;
  DownloadedSizeMB: number;
  DestDir: string;
  FinalDir: string;
  DownloadTimeSec: number;
  PostTotalTimeSec: number;
  ParStatus: string;
  UnpackStatus: string;
  DeleteStatus: string;
  MarkStatus: string;
  HistoryTime: number;
  FailedArticles: number;
  TotalArticles: number;
}

/** NZBGet config entry from config() */
interface NZBGetConfigItem {
  Name: string;
  Value: string;
}

/** NZBGet status response from status() */
interface NZBGetStatus {
  DownloadRate: number;
  RemainingSizeMB: number;
  DownloadedSizeMB: number;
  DownloadPaused: boolean;
  ServerStandBy: boolean;
}

/** Internal NZB info (normalized before mapping to DownloadInfo) */
interface NZBInfo {
  nzbId: string;
  name: string;
  size: number;
  bytesDownloaded: number;
  progress: number;
  status: DownloadStatus;
  downloadSpeed: number;
  eta: number;
  category: string;
  downloadPath?: string;
  completedAt?: Date;
  errorMessage?: string;
}

// =========================================================================
// NZBGet Service
// =========================================================================

export class NZBGetService implements IDownloadClient {
  readonly clientType: DownloadClientType = 'nzbget';
  readonly protocol: ProtocolType = 'usenet';

  private client: AxiosInstance;
  private baseUrl: string;
  private username: string;
  private password: string;
  private defaultCategory: string;
  private defaultDownloadDir: string;
  private disableSSLVerify: boolean;
  private httpsAgent?: https.Agent;
  private pathMappingConfig: PathMappingConfig;

  constructor(
    baseUrl: string,
    username: string,
    password: string,
    defaultCategory: string = 'readmeabook',
    defaultDownloadDir: string = '/downloads',
    disableSSLVerify: boolean = false,
    pathMappingConfig?: PathMappingConfig
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.username = username || '';
    this.password = password || '';
    this.defaultCategory = defaultCategory;
    this.defaultDownloadDir = defaultDownloadDir;
    this.disableSSLVerify = disableSSLVerify;
    this.pathMappingConfig = pathMappingConfig || { enabled: false, remotePath: '', localPath: '' };

    if (this.disableSSLVerify && this.baseUrl.startsWith('https')) {
      this.httpsAgent = new https.Agent({
        rejectUnauthorized: false,
      });
    }

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      httpsAgent: this.httpsAgent,
      auth: {
        username: this.username,
        password: this.password,
      },
    });
  }

  // =========================================================================
  // JSON-RPC Communication
  // =========================================================================

  /**
   * Make a JSON-RPC call to NZBGet.
   * All NZBGet API calls go through POST /jsonrpc with Basic Auth.
   */
  private async rpc<T = any>(method: string, params: any[] = []): Promise<T> {
    const response = await this.client.post('/jsonrpc', {
      method,
      params,
    });

    if (response.data?.error) {
      const errorMsg = typeof response.data.error === 'string'
        ? response.data.error
        : response.data.error.message || JSON.stringify(response.data.error);
      throw new Error(`NZBGet RPC error (${method}): ${errorMsg}`);
    }

    return response.data?.result;
  }

  // =========================================================================
  // IDownloadClient Implementation
  // =========================================================================

  /**
   * Test connection to NZBGet
   */
  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const version = await this.rpc<string>('version');

      if (!version) {
        return {
          success: false,
          message: 'Connected but failed to get NZBGet version',
        };
      }

      return {
        success: true,
        version,
        message: `Connected to NZBGet v${version}`,
      };
    } catch (error) {
      return {
        success: false,
        message: this.formatConnectionError(error),
      };
    }
  }

  /**
   * Add a download via the unified interface.
   * Downloads the NZB file from the source URL and uploads to NZBGet via append().
   */
  async addDownload(url: string, options?: AddDownloadOptions): Promise<string> {
    logger.info(`Adding NZB from URL: ${url.substring(0, 150)}...`);

    const category = options?.category || this.defaultCategory;

    // Ensure category exists with correct path before every download
    // (Matches SABnzbd/qBittorrent behavior — lightweight config read + conditional write)
    await this.ensureCategory();

    // Download the NZB file content from the source URL (Prowlarr proxy)
    let nzbBuffer: Buffer;
    let filename: string;

    try {
      logger.info('Downloading NZB file from source URL...');

      const nzbResponse = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000,
        maxRedirects: 5,
        headers: options?.sourceHeaders,
        httpsAgent: url.startsWith('https') ? this.httpsAgent : undefined,
      });

      nzbBuffer = Buffer.from(nzbResponse.data);

      if (nzbBuffer.length === 0) {
        throw new Error('NZB file is empty (0 bytes)');
      }

      logger.info(`Downloaded NZB file: ${nzbBuffer.length} bytes`);

      // Detect and decompress gzip-compressed NZB files
      // Prowlarr/indexers may serve .nzb.gz files which need decompression before upload
      if (nzbBuffer[0] === 0x1f && nzbBuffer[1] === 0x8b) {
        logger.info('NZB file is gzip-compressed, decompressing...');
        nzbBuffer = zlib.gunzipSync(nzbBuffer);
        logger.info(`Decompressed NZB file: ${nzbBuffer.length} bytes`);
      }
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

    // Upload to NZBGet via append()
    // Parameters: Filename, Content (base64), Category, Priority, AddToTop, AddPaused,
    //             DupeKey, DupeScore, DupeMode, AutoCategory, PPParameters
    const base64Content = nzbBuffer.toString('base64');
    const priority = this.mapPriority(options?.priority);

    const nzbId = await this.rpc<number>('append', [
      filename,                // Filename
      base64Content,           // Content (base64-encoded NZB)
      category,                // Category
      priority,                // Priority (0=normal, 50=high, 100=very high, 900=force)
      false,                   // AddToTop
      options?.paused || false, // AddPaused
      '',                      // DupeKey
      0,                       // DupeScore
      'FORCE',                 // DupeMode — RMAB manages its own lifecycle, skip NZBGet dupe detection
      [],                      // PPParameters
    ]);

    if (!nzbId || nzbId <= 0) {
      // Log diagnostic info to help debug rejected NZBs
      const contentPreview = nzbBuffer.slice(0, 100).toString('utf-8');
      logger.error('NZBGet rejected the NZB file', {
        filename,
        contentLength: nzbBuffer.length,
        base64Length: base64Content.length,
        contentPreview: contentPreview.substring(0, 80),
        returnedId: nzbId,
      });
      throw new Error('NZBGet rejected the NZB file');
    }

    const id = String(nzbId);
    logger.info(`Added NZB: ${id} (${filename})`);
    return id;
  }

  /**
   * Get current status of a download.
   * Checks queue (listgroups) first, then history.
   */
  async getDownload(id: string): Promise<DownloadInfo | null> {
    const nzbId = parseInt(id, 10);
    if (isNaN(nzbId)) {
      logger.error(`Invalid NZB ID: ${id}`);
      return null;
    }

    // Check queue first
    const groups = await this.rpc<NZBGetGroupItem[]>('listgroups', [0]);
    const groupItem = groups?.find(g => g.NZBID === nzbId);

    if (groupItem) {
      return this.mapGroupToDownloadInfo(groupItem);
    }

    // Not in queue, check history
    const history = await this.rpc<NZBGetHistoryItem[]>('history', [false]);
    const historyItem = history?.find(h => h.NZBID === nzbId);

    if (historyItem) {
      return this.mapHistoryToDownloadInfo(historyItem);
    }

    return null;
  }

  /**
   * Pause a download via editqueue GroupPause
   */
  async pauseDownload(id: string): Promise<void> {
    const nzbId = parseInt(id, 10);
    const result = await this.rpc<boolean>('editqueue', ['GroupPause', '', [nzbId]]);
    if (!result) {
      throw new Error(`Failed to pause download ${id}`);
    }
    logger.info(`Paused download: ${id}`);
  }

  /**
   * Resume a download via editqueue GroupResume
   */
  async resumeDownload(id: string): Promise<void> {
    const nzbId = parseInt(id, 10);
    const result = await this.rpc<boolean>('editqueue', ['GroupResume', '', [nzbId]]);
    if (!result) {
      throw new Error(`Failed to resume download ${id}`);
    }
    logger.info(`Resumed download: ${id}`);
  }

  /**
   * Delete a download from NZBGet.
   * Tries queue first (GroupFinalDelete), then history (HistoryFinalDelete).
   */
  async deleteDownload(id: string, deleteFiles: boolean = false): Promise<void> {
    const nzbId = parseInt(id, 10);
    logger.info(`Deleting download: ${id} (deleteFiles: ${deleteFiles})`);

    // Try deleting from queue first
    const groups = await this.rpc<NZBGetGroupItem[]>('listgroups', [0]);
    const inQueue = groups?.some(g => g.NZBID === nzbId);

    if (inQueue) {
      const command = deleteFiles ? 'GroupFinalDelete' : 'GroupDelete';
      const result = await this.rpc<boolean>('editqueue', [command, '', [nzbId]]);
      if (!result) {
        throw new Error(`Failed to delete download ${id} from queue`);
      }
      logger.info(`Deleted download ${id} from queue`);
      return;
    }

    // Try deleting from history
    const command = deleteFiles ? 'HistoryFinalDelete' : 'HistoryDelete';
    const result = await this.rpc<boolean>('editqueue', [command, '', [nzbId]]);
    if (!result) {
      throw new Error(`Failed to delete download ${id} from history`);
    }
    logger.info(`Deleted download ${id} from history`);
  }

  /**
   * Post-download cleanup: archive from NZBGet history.
   * Uses HistoryDelete to hide the item from visible history (preserves in hidden archive).
   * Analogous to SABnzbd's archive behavior.
   */
  async postProcess(id: string): Promise<void> {
    const nzbId = parseInt(id, 10);
    logger.info(`Archiving completed download from history: ${id}`);

    try {
      const result = await this.rpc<boolean>('editqueue', ['HistoryDelete', '', [nzbId]]);
      if (!result) {
        throw new Error(`NZBGet returned false for HistoryDelete`);
      }
      logger.info(`Successfully archived ${id} from history`);
    } catch (error) {
      logger.error(`Failed to archive ${id} from history`, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(`NZB ${id} not found in history or failed to archive`);
    }
  }

  /** Not applicable for usenet clients */
  async getCategories(): Promise<string[]> {
    return [];
  }

  /** Not applicable for usenet clients */
  async setCategory(_id: string, _category: string): Promise<void> {
    // No-op: post-import category is scoped to torrent clients
  }

  // =========================================================================
  // Category Management
  // =========================================================================

  /**
   * Ensure the category exists in NZBGet with the correct download path.
   *
   * NZBGet categories are config entries (Category1.Name, Category1.DestDir, etc.).
   * Reads existing config, checks for our category, creates/updates via saveconfig().
   *
   * CRITICAL: NZBGet's saveconfig() does a FULL config replacement — passing only
   * our entries would wipe every other setting and destroy the instance. We must
   * always read the full config, merge our changes, and write the entire config back.
   *
   * After creating a new category, we call reload() so NZBGet picks up the new
   * category DestDir immediately. reload() is safe when the config is correct.
   *
   * Called before every download (matches SABnzbd/qBittorrent pattern).
   * Lightweight: reads config, writes only if category is missing or path changed.
   */
  async ensureCategory(): Promise<void> {
    try {
      logger.debug('ensureCategory() called - syncing category with NZBGet');

      const config = await this.rpc<NZBGetConfigItem[]>('config');
      if (!config) {
        logger.warn('Failed to get NZBGet config, skipping category check');
        return;
      }

      // Find the main DestDir (NZBGet's base download directory)
      const destDirEntry = config.find(c => c.Name === 'DestDir');
      const nzbgetDestDir = destDirEntry?.Value || '';

      logger.debug('NZBGet config retrieved', {
        destDir: nzbgetDestDir || '(not configured)',
      });

      // Apply reverse path mapping to get the path from NZBGet's perspective
      const desiredPath = PathMapper.reverseTransform(this.defaultDownloadDir, this.pathMappingConfig);

      logger.debug('Category path calculation', {
        rmabDownloadDir: this.defaultDownloadDir,
        desiredPathForNZBGet: desiredPath,
        nzbgetDestDir,
        pathMappingEnabled: this.pathMappingConfig.enabled,
      });

      // Find existing categories and our category slot
      const { existingSlot, nextSlot } = this.findCategorySlot(config, this.defaultCategory);

      if (existingSlot !== null) {
        // Category exists - check if DestDir needs updating
        const currentDestDir = config.find(c => c.Name === `Category${existingSlot}.DestDir`)?.Value || '';

        if (this.normalizePath(currentDestDir) !== this.normalizePath(desiredPath)) {
          logger.info(`Updating category "${this.defaultCategory}" DestDir from "${currentDestDir}" to "${desiredPath}"`);
          const updatedConfig = this.mergeConfigEntries(config, [
            { Name: `Category${existingSlot}.DestDir`, Value: desiredPath },
          ]);
          await this.rpc('saveconfig', [updatedConfig]);
          await this.reloadAndWait();
        } else {
          logger.debug(`Category "${this.defaultCategory}" already configured correctly`);
        }
      } else {
        // Create new category — merge into full config so we don't wipe existing settings
        logger.info(`Creating category "${this.defaultCategory}" in slot ${nextSlot} with DestDir: "${desiredPath}"`);
        const updatedConfig = this.mergeConfigEntries(config, [
          { Name: `Category${nextSlot}.Name`, Value: this.defaultCategory },
          { Name: `Category${nextSlot}.DestDir`, Value: desiredPath },
          { Name: `Category${nextSlot}.Unpack`, Value: 'yes' },
        ]);
        await this.rpc('saveconfig', [updatedConfig]);
        await this.reloadAndWait();
      }
    } catch (error) {
      logger.error('Failed to ensure category', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - category issues shouldn't block downloads
    }
  }

  /**
   * Read-only entries returned by NZBGet's config() RPC that must NOT be
   * written back via saveconfig(). These are runtime/system properties.
   */
  private static readonly READ_ONLY_CONFIG_KEYS = new Set([
    'ConfigFile',
    'AppBin',
    'AppDir',
    'Version',
  ]);

  /**
   * Merge new/updated config entries into the full NZBGet config.
   * Returns a complete config array safe to pass to saveconfig().
   *
   * Filters out read-only system entries (ConfigFile, AppBin, AppDir, Version)
   * that config() returns but saveconfig() rejects.
   *
   * For entries that already exist (by Name), replaces the value.
   * For new entries, appends them to the array.
   */
  private mergeConfigEntries(
    fullConfig: NZBGetConfigItem[],
    changes: NZBGetConfigItem[]
  ): NZBGetConfigItem[] {
    const merged: NZBGetConfigItem[] = [];

    for (const entry of fullConfig) {
      // Skip read-only system entries that saveconfig() rejects
      if (NZBGetService.READ_ONLY_CONFIG_KEYS.has(entry.Name)) {
        continue;
      }
      const override = changes.find(c => c.Name === entry.Name);
      merged.push(override ? { Name: entry.Name, Value: override.Value } : { Name: entry.Name, Value: entry.Value });
    }

    // Append any entries that don't exist in the current config
    for (const change of changes) {
      if (!fullConfig.some(entry => entry.Name === change.Name)) {
        merged.push({ Name: change.Name, Value: change.Value });
      }
    }

    return merged;
  }

  /**
   * Find the category slot number for an existing category or determine the next available slot.
   */
  private findCategorySlot(
    config: NZBGetConfigItem[],
    categoryName: string
  ): { existingSlot: number | null; nextSlot: number } {
    let maxSlot = 0;
    let existingSlot: number | null = null;

    for (const entry of config) {
      const match = entry.Name.match(/^Category(\d+)\.Name$/);
      if (match) {
        const slot = parseInt(match[1], 10);
        if (slot > maxSlot) {
          maxSlot = slot;
        }
        if (entry.Value === categoryName) {
          existingSlot = slot;
        }
      }
    }

    return { existingSlot, nextSlot: maxSlot + 1 };
  }

  /**
   * Reload NZBGet so config changes (new categories, DestDir updates) take effect.
   * Polls version() to confirm NZBGet is back online before continuing.
   */
  private async reloadAndWait(): Promise<void> {
    try {
      logger.info('Reloading NZBGet to apply configuration changes...');
      await this.rpc('reload');

      const maxWait = 10000;
      const pollInterval = 500;
      const startTime = Date.now();

      while (Date.now() - startTime < maxWait) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        try {
          await this.rpc<string>('version');
          logger.info('NZBGet reloaded successfully');
          return;
        } catch {
          // Still restarting, keep polling
        }
      }

      logger.warn('NZBGet did not respond after reload within 10s, continuing anyway');
    } catch (error) {
      logger.warn('NZBGet reload request failed, config changes may require manual restart', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // =========================================================================
  // Status Mapping
  // =========================================================================

  /**
   * Map NZBGet queue group item to unified DownloadInfo
   */
  private async mapGroupToDownloadInfo(group: NZBGetGroupItem): Promise<DownloadInfo> {
    const totalBytes = group.FileSizeMB * 1024 * 1024;
    const downloadedBytes = group.DownloadedSizeMB * 1024 * 1024;
    const progress = totalBytes > 0 ? Math.min(downloadedBytes / totalBytes, 1.0) : 0;

    // Get global download speed for active items
    let downloadSpeed = 0;
    let eta = 0;
    const status = this.mapGroupStatus(group.Status);

    if (status === 'downloading') {
      try {
        const serverStatus = await this.rpc<NZBGetStatus>('status');
        downloadSpeed = serverStatus?.DownloadRate || 0;
        const remainingBytes = group.RemainingSizeMB * 1024 * 1024;
        eta = downloadSpeed > 0 ? Math.round(remainingBytes / downloadSpeed) : 0;
      } catch {
        // Non-critical: speed/eta will be 0
      }
    }

    // Return raw download path (path mapping is applied downstream by the consumer)
    const downloadPath = group.FinalDir || group.DestDir || undefined;

    return {
      id: String(group.NZBID),
      name: group.NZBName,
      size: totalBytes,
      bytesDownloaded: downloadedBytes,
      progress,
      status,
      downloadSpeed,
      eta,
      category: group.Category || '',
      downloadPath,
      completedAt: undefined,
      errorMessage: undefined,
      seedingTime: undefined,
      ratio: undefined,
    };
  }

  /**
   * Map NZBGet history item to unified DownloadInfo
   */
  private mapHistoryToDownloadInfo(history: NZBGetHistoryItem): DownloadInfo {
    const totalBytes = history.FileSizeMB * 1024 * 1024;
    const downloadedBytes = history.DownloadedSizeMB * 1024 * 1024;
    const status = this.mapHistoryStatus(history.Status);

    // Return raw download path (path mapping is applied downstream by the consumer)
    const downloadPath = history.FinalDir || history.DestDir || undefined;

    return {
      id: String(history.NZBID),
      name: history.Name,
      size: totalBytes,
      bytesDownloaded: status === 'completed' ? totalBytes : downloadedBytes,
      progress: status === 'completed' ? 1.0 : (totalBytes > 0 ? downloadedBytes / totalBytes : 0),
      status,
      downloadSpeed: 0,
      eta: 0,
      category: history.Category || '',
      downloadPath,
      completedAt: history.HistoryTime ? new Date(history.HistoryTime * 1000) : undefined,
      errorMessage: status === 'failed' ? this.buildHistoryErrorMessage(history) : undefined,
      seedingTime: undefined,
      ratio: undefined,
    };
  }

  /**
   * Map NZBGet queue status string to unified DownloadStatus
   */
  private mapGroupStatus(status: string): DownloadStatus {
    switch (status) {
      case 'QUEUED':
        return 'queued';
      case 'PAUSED':
        return 'paused';
      case 'DOWNLOADING':
      case 'FETCHING':
        return 'downloading';
      case 'PP_QUEUED':
      case 'LOADING_PARS':
      case 'VERIFYING_SOURCES':
      case 'REPAIRING':
      case 'VERIFYING_REPAIRED':
      case 'RENAMING':
      case 'UNPACKING':
      case 'MOVING':
      case 'POST_UNPACK_RENAMING':
      case 'EXECUTING_SCRIPT':
      case 'PP_FINISHED':
        return 'processing';
      default:
        logger.warn(`Unknown NZBGet queue status: ${status}, defaulting to downloading`);
        return 'downloading';
    }
  }

  /**
   * Map NZBGet history status string to unified DownloadStatus.
   * History statuses have format: "PREFIX/DETAIL" (e.g., "SUCCESS/ALL", "FAILURE/PAR")
   */
  private mapHistoryStatus(status: string): DownloadStatus {
    const prefix = status.split('/')[0];

    switch (prefix) {
      case 'SUCCESS':
        return 'completed';
      case 'WARNING':
        // WARNING means the download succeeded but post-processing had issues
        // From RMAB's perspective, the download is still completed
        return 'completed';
      case 'FAILURE':
        return 'failed';
      case 'DELETED':
        return 'failed';
      default:
        logger.warn(`Unknown NZBGet history status: ${status}, defaulting to failed`);
        return 'failed';
    }
  }

  /**
   * Build a descriptive error message from NZBGet history item
   */
  private buildHistoryErrorMessage(history: NZBGetHistoryItem): string {
    const parts: string[] = [];

    // Include the raw status for context
    parts.push(history.Status);

    if (history.ParStatus && history.ParStatus !== 'NONE' && history.ParStatus !== 'SUCCESS') {
      parts.push(`Par: ${history.ParStatus}`);
    }
    if (history.UnpackStatus && history.UnpackStatus !== 'NONE' && history.UnpackStatus !== 'SUCCESS') {
      parts.push(`Unpack: ${history.UnpackStatus}`);
    }
    if (history.DeleteStatus && history.DeleteStatus !== 'NONE') {
      parts.push(`Delete: ${history.DeleteStatus}`);
    }

    // Article failure info
    if (history.FailedArticles > 0) {
      const failPercent = history.TotalArticles > 0
        ? Math.round((history.FailedArticles / history.TotalArticles) * 100)
        : 0;
      parts.push(`${history.FailedArticles} failed articles (${failPercent}%)`);
    }

    return parts.join(' | ');
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  /**
   * Extract a usable filename for the NZB upload.
   * Tries Content-Disposition header first, then URL path, then falls back to a default.
   */
  private extractNZBFilename(url: string, contentDisposition?: string): string {
    if (contentDisposition) {
      const match = contentDisposition.match(/filename[*]?=(?:UTF-8''|"?)([^";]+)/i);
      if (match?.[1]) {
        const decoded = decodeURIComponent(match[1].replace(/"+$/, ''));
        if (decoded) {
          return decoded.endsWith('.nzb') ? decoded : `${decoded}.nzb`;
        }
      }
    }

    try {
      const urlPath = new URL(url).pathname;
      const basename = urlPath.split('/').pop();
      if (basename && basename.length > 0 && basename !== 'download') {
        const decoded = decodeURIComponent(basename);
        return decoded.endsWith('.nzb') ? decoded : `${decoded}.nzb`;
      }
    } catch {
      // URL parsing failed
    }

    return 'download.nzb';
  }

  /**
   * Map priority string to NZBGet priority integer.
   * NZBGet priorities: -100 (very low), -50 (low), 0 (normal), 50 (high), 100 (very high), 900 (force)
   */
  private mapPriority(priority?: string): number {
    switch (priority) {
      case 'force':
        return 900;
      case 'high':
        return 50;
      case 'low':
        return -50;
      case 'normal':
      default:
        return 0;
    }
  }

  /**
   * Format connection error into a user-friendly message
   */
  private formatConnectionError(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      if (status === 401) {
        return 'Authentication failed. Check your NZBGet username and password (Settings → Security).';
      }
      if (status === 403) {
        return 'Access denied. Check your NZBGet credentials and access permissions.';
      }
      if (error.code === 'ECONNREFUSED') {
        return `Connection refused. Is NZBGet running and accessible at this URL?`;
      }
      if (error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
        return 'Connection timed out. Check the URL and network connectivity.';
      }
      if (error.message?.includes('certificate') || error.message?.includes('SSL') || error.message?.includes('TLS')) {
        return 'SSL/TLS certificate error. Enable "Disable SSL verification" if using self-signed certificates.';
      }
    }

    return error instanceof Error ? error.message : 'Unknown error';
  }

  /**
   * Normalize a path for comparison (forward slashes, no trailing slash, lowercase)
   */
  private normalizePath(p: string): string {
    return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  }
}

// =========================================================================
// Singleton Factory
// =========================================================================

let nzbgetServiceInstance: NZBGetService | null = null;
let configLoaded = false;

export async function getNZBGetService(): Promise<NZBGetService> {
  if (nzbgetServiceInstance && configLoaded) {
    return nzbgetServiceInstance;
  }

  try {
    const { getConfigService } = await import('../services/config.service');
    const { getDownloadClientManager } = await import('../services/download-client-manager.service');
    const configService = await getConfigService();
    const manager = getDownloadClientManager(configService);

    logger.info('Loading configuration from download client manager...');
    const clientConfig = await manager.getClientForProtocol('usenet');

    if (!clientConfig) {
      throw new Error('NZBGet is not configured. Please configure an NZBGet client in the admin settings.');
    }

    if (clientConfig.type !== 'nzbget') {
      throw new Error(`Expected NZBGet client but found ${clientConfig.type}`);
    }

    const baseDir = await configService.get('download_dir') || '/downloads';
    const downloadDir = clientConfig.customPath
      ? require('path').join(baseDir, clientConfig.customPath)
      : baseDir;

    const pathMappingConfig: PathMappingConfig = {
      enabled: clientConfig.remotePathMappingEnabled || false,
      remotePath: clientConfig.remotePath || '',
      localPath: clientConfig.localPath || '',
    };

    logger.info('Config loaded:', {
      name: clientConfig.name,
      hasUrl: !!clientConfig.url,
      hasPassword: !!clientConfig.password,
      disableSSLVerify: clientConfig.disableSSLVerify,
      downloadDir,
      pathMappingEnabled: pathMappingConfig.enabled,
    });

    if (!clientConfig.url || !clientConfig.password) {
      throw new Error('NZBGet is not fully configured. Please check your configuration in admin settings.');
    }

    nzbgetServiceInstance = new NZBGetService(
      clientConfig.url,
      clientConfig.username || '',
      clientConfig.password,
      clientConfig.category || 'readmeabook',
      downloadDir,
      clientConfig.disableSSLVerify,
      pathMappingConfig
    );

    await nzbgetServiceInstance.ensureCategory();

    configLoaded = true;
    return nzbgetServiceInstance;
  } catch (error) {
    logger.error('Failed to initialize service', {
      error: error instanceof Error ? error.message : String(error),
    });
    nzbgetServiceInstance = null;
    configLoaded = false;
    throw error;
  }
}

export function invalidateNZBGetService(): void {
  nzbgetServiceInstance = null;
  configLoaded = false;
  logger.info('Service singleton invalidated');
}
