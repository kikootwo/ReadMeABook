/**
 * Component: Transmission Integration Service
 * Documentation: documentation/phase3/download-clients.md
 */

import axios, { AxiosInstance } from 'axios';
import https from 'https';
import path from 'path';
import * as parseTorrentModule from 'parse-torrent';
import { RMABLogger } from '../utils/logger';
import { PathMapper, PathMappingConfig } from '../utils/path-mapper';
import {
  IDownloadClient,
  DownloadClientType,
  ProtocolType,
  DownloadInfo,
  DownloadStatus,
  AddDownloadOptions,
  ConnectionTestResult,
} from '../interfaces/download-client.interface';

// Handle both ESM and CommonJS imports
const parseTorrent = (parseTorrentModule as any).default || parseTorrentModule;

const logger = RMABLogger.create('Transmission');

/** Transmission RPC numeric status codes */
type TransmissionStatus = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Transmission torrent fields we request */
interface TransmissionTorrent {
  hashString: string;
  name: string;
  totalSize: number;
  downloadedEver: number;
  percentDone: number;
  status: TransmissionStatus;
  rateDownload: number;
  eta: number;
  labels: string[];
  downloadDir: string;
  doneDate: number;
  errorString: string;
  error: number;
  secondsSeeding: number;
  uploadRatio: number;
  uploadedEver: number;
}

/** Fields we request from the Transmission RPC API */
const TORRENT_FIELDS = [
  'hashString',
  'name',
  'totalSize',
  'downloadedEver',
  'percentDone',
  'status',
  'rateDownload',
  'eta',
  'labels',
  'downloadDir',
  'doneDate',
  'errorString',
  'error',
  'secondsSeeding',
  'uploadRatio',
  'uploadedEver',
];

export class TransmissionService implements IDownloadClient {
  readonly clientType: DownloadClientType = 'transmission';
  readonly protocol: ProtocolType = 'torrent';

  private client: AxiosInstance;
  private baseUrl: string;
  private username: string;
  private password: string;
  private defaultSavePath: string;
  private defaultCategory: string;
  private disableSSLVerify: boolean;
  private httpsAgent?: https.Agent;
  private pathMappingConfig: PathMappingConfig;
  private sessionId: string = '';

  constructor(
    baseUrl: string,
    username: string,
    password: string,
    defaultSavePath: string = '/downloads',
    defaultCategory: string = 'readmeabook',
    disableSSLVerify: boolean = false,
    pathMappingConfig?: PathMappingConfig
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.username = username;
    this.password = password;
    this.defaultSavePath = defaultSavePath;
    this.defaultCategory = defaultCategory;
    this.disableSSLVerify = disableSSLVerify;
    this.pathMappingConfig = pathMappingConfig || { enabled: false, remotePath: '', localPath: '' };

    if (disableSSLVerify && this.baseUrl.startsWith('https')) {
      this.httpsAgent = new https.Agent({ rejectUnauthorized: false });
      logger.info('[Transmission] SSL certificate verification disabled');
    }

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 60000, // 60 seconds - some indexers (e.g. yggtorrent) enforce a 30s wait before download
      httpsAgent: this.httpsAgent,
    });
  }

  /**
   * Execute an RPC request to Transmission.
   * Handles CSRF token (409 → capture X-Transmission-Session-Id → retry).
   */
  private async rpc(method: string, args?: Record<string, any>): Promise<any> {
    const body = { method, arguments: args };
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.sessionId) {
      headers['X-Transmission-Session-Id'] = this.sessionId;
    }

    // Add Basic Auth if credentials provided
    const auth = this.username
      ? { username: this.username, password: this.password }
      : undefined;

    try {
      const response = await this.client.post('/transmission/rpc', body, { headers, auth });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        // Capture CSRF token and retry
        const newSessionId = error.response.headers['x-transmission-session-id'];
        if (newSessionId) {
          this.sessionId = newSessionId;
          headers['X-Transmission-Session-Id'] = this.sessionId;
          const response = await this.client.post('/transmission/rpc', body, { headers, auth });
          return response.data;
        }
      }
      throw error;
    }
  }

  // =========================================================================
  // IDownloadClient Implementation
  // =========================================================================

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const data = await this.rpc('session-get', { fields: ['version'] });

      if (data.result !== 'success') {
        return { success: false, message: `Transmission RPC error: ${data.result}` };
      }

      const version = data.arguments?.version;
      return {
        success: true,
        version,
        message: `Connected to Transmission${version ? ` ${version}` : ''}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed';

      if (axios.isAxiosError(error)) {
        const code = error.code;
        const status = error.response?.status;

        if (code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
            code === 'CERT_HAS_EXPIRED' || code?.includes('CERT') || code?.includes('SSL')) {
          return { success: false, message: `SSL certificate verification failed (${code}). Enable "Disable SSL Verification" if you trust this server.` };
        }
        if (code === 'ECONNREFUSED') {
          return { success: false, message: `Connection refused. Check if Transmission is running at: ${this.baseUrl}` };
        }
        if (code === 'ETIMEDOUT' || code === 'ECONNABORTED') {
          return { success: false, message: `Connection timeout. Verify the URL is correct: ${this.baseUrl}` };
        }
        if (code === 'ENOTFOUND') {
          return { success: false, message: `Host not found. Verify the address: ${this.baseUrl}` };
        }
        if (status === 401) {
          return { success: false, message: 'Authentication failed. Check your username and password.' };
        }
      }

      logger.error('Connection test failed', { error: message });
      return { success: false, message };
    }
  }

  async addDownload(url: string, options?: AddDownloadOptions): Promise<string> {
    if (!url || typeof url !== 'string' || url.trim() === '') {
      throw new Error('Invalid download URL: URL is required and must be a non-empty string');
    }

    const category = options?.category || this.defaultCategory;

    if (url.startsWith('magnet:')) {
      return this.addMagnetLink(url, category, options);
    } else {
      return this.addTorrentFile(url, category, options);
    }
  }

  private async addMagnetLink(
    magnetUrl: string,
    category: string,
    options?: AddDownloadOptions
  ): Promise<string> {
    const infoHash = this.extractHashFromMagnet(magnetUrl);
    if (!infoHash) {
      throw new Error('Invalid magnet link - could not extract info_hash');
    }

    logger.info(`Extracted info_hash from magnet: ${infoHash}`);

    // Check for duplicates
    try {
      await this.getTorrentByHash(infoHash);
      logger.info(`Torrent ${infoHash} already exists (duplicate), returning existing hash`);
      return infoHash;
    } catch {
      // Torrent doesn't exist, continue
    }

    const localSavePath = this.defaultSavePath;
    const remoteSavePath = PathMapper.reverseTransform(localSavePath, this.pathMappingConfig);

    const args: Record<string, any> = {
      filename: magnetUrl,
      'download-dir': remoteSavePath,
      paused: options?.paused || false,
      labels: [category],
    };

    logger.info('[Transmission] Adding magnet link...');
    const data = await this.rpc('torrent-add', args);

    if (data.result !== 'success') {
      throw new Error(`Transmission rejected magnet link: ${data.result}`);
    }

    // torrent-add returns torrent-added or torrent-duplicate
    const added = data.arguments?.['torrent-added'] || data.arguments?.['torrent-duplicate'];
    if (!added) {
      throw new Error('Transmission did not return torrent info after adding');
    }

    // Override Transmission's global seeding rules — RMAB manages torrent lifecycle
    await this.disableSeedLimits(added.hashString || infoHash);

    logger.info(`Successfully added magnet link: ${infoHash}`);
    return infoHash;
  }

  private async addTorrentFile(
    torrentUrl: string,
    category: string,
    options?: AddDownloadOptions
  ): Promise<string> {
    logger.info(`Downloading .torrent file from: ${torrentUrl}`);

    let torrentResponse;
    try {
      torrentResponse = await axios.get(torrentUrl, {
        responseType: 'arraybuffer',
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 300,
        timeout: 60000, // 60 seconds - some indexers (e.g. yggtorrent) enforce a 30s wait before download
      });

      // Check if response body is a magnet link
      if (torrentResponse.data.length > 0) {
        const responseText = torrentResponse.data.toString();
        const magnetMatch = responseText.match(/^magnet:\?[^\s]+$/);
        if (magnetMatch) {
          logger.info('Response body is a magnet link');
          return this.addMagnetLink(magnetMatch[0], category, options);
        }
      }
    } catch (error) {
      if (!axios.isAxiosError(error) || !error.response) {
        throw error;
      }

      const status = error.response.status;

      if (status >= 300 && status < 400) {
        const location = error.response.headers['location'];
        if (location && location.startsWith('magnet:')) {
          return this.addMagnetLink(location, category, options);
        }
        if (location && (location.startsWith('http://') || location.startsWith('https://'))) {
          try {
            torrentResponse = await axios.get(location, {
              responseType: 'arraybuffer',
              timeout: 60000, // 60 seconds - some indexers (e.g. yggtorrent) enforce a 30s wait before download
              maxRedirects: 5,
            });
          } catch {
            throw new Error('Failed to download torrent file after redirect');
          }
        } else {
          throw new Error(`Invalid redirect location: ${location}`);
        }
      } else {
        throw new Error(`Failed to download torrent: HTTP ${status}`);
      }
    }

    const torrentBuffer = Buffer.from(torrentResponse.data);

    let parsedTorrentData: any;
    try {
      parsedTorrentData = await parseTorrent(torrentBuffer);
    } catch {
      throw new Error('Invalid .torrent file - failed to parse');
    }

    const infoHash = parsedTorrentData.infoHash;
    if (!infoHash) {
      throw new Error('Failed to extract info_hash from .torrent file');
    }

    logger.info(`Extracted info_hash: ${infoHash}`);

    // Check for duplicates
    try {
      await this.getTorrentByHash(infoHash);
      logger.info(`Torrent ${infoHash} already exists (duplicate), returning existing hash`);
      return infoHash;
    } catch {
      // Torrent doesn't exist, continue
    }

    const localSavePath = this.defaultSavePath;
    const remoteSavePath = PathMapper.reverseTransform(localSavePath, this.pathMappingConfig);

    // Transmission accepts base64-encoded .torrent content via 'metainfo' field
    const metainfo = torrentBuffer.toString('base64');

    const args: Record<string, any> = {
      metainfo,
      'download-dir': remoteSavePath,
      paused: options?.paused || false,
      labels: [category],
    };

    logger.info('[Transmission] Adding .torrent file...');
    const data = await this.rpc('torrent-add', args);

    if (data.result !== 'success') {
      throw new Error(`Transmission rejected .torrent file: ${data.result}`);
    }

    // torrent-add returns torrent-added or torrent-duplicate
    const added = data.arguments?.['torrent-added'] || data.arguments?.['torrent-duplicate'];

    // Override Transmission's global seeding rules — RMAB manages torrent lifecycle
    await this.disableSeedLimits(added?.hashString || infoHash);

    logger.info(`Successfully added torrent: ${infoHash}`);
    return infoHash;
  }

  async getDownload(id: string): Promise<DownloadInfo | null> {
    const maxRetries = 3;
    const initialDelayMs = 500;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const torrent = await this.getTorrentByHash(id);
        return this.mapToDownloadInfo(torrent);
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (!message.includes('not found')) {
          throw error;
        }
        if (attempt === maxRetries) {
          return null;
        }
        const delayMs = initialDelayMs * Math.pow(2, attempt);
        logger.warn(`Torrent ${id} not found, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    return null;
  }

  async pauseDownload(id: string): Promise<void> {
    try {
      const torrent = await this.getTorrentByHash(id);
      await this.rpc('torrent-stop', { ids: [torrent.hashString] });
      logger.info(`Paused torrent: ${id}`);
    } catch (error) {
      logger.error('Failed to pause torrent', { error: error instanceof Error ? error.message : String(error) });
      throw new Error('Failed to pause torrent');
    }
  }

  async resumeDownload(id: string): Promise<void> {
    try {
      const torrent = await this.getTorrentByHash(id);
      await this.rpc('torrent-start', { ids: [torrent.hashString] });
      logger.info(`Resumed torrent: ${id}`);
    } catch (error) {
      logger.error('Failed to resume torrent', { error: error instanceof Error ? error.message : String(error) });
      throw new Error('Failed to resume torrent');
    }
  }

  async deleteDownload(id: string, deleteFiles: boolean = false): Promise<void> {
    try {
      const torrent = await this.getTorrentByHash(id);
      await this.rpc('torrent-remove', {
        ids: [torrent.hashString],
        'delete-local-data': deleteFiles,
      });
      logger.info(`Deleted torrent: ${id}`);
    } catch (error) {
      logger.error('Failed to delete torrent', { error: error instanceof Error ? error.message : String(error) });
      throw new Error('Failed to delete torrent');
    }
  }

  /**
   * Post-download cleanup.
   * No-op for Transmission — torrents continue seeding until the
   * cleanup-seeded-torrents job removes them after meeting seeding requirements.
   */
  async postProcess(_id: string): Promise<void> {
    // No-op: torrents are managed by the seeding cleanup scheduler
  }

  /**
   * Get available categories/labels.
   * Transmission uses free-form labels — no predefined list to fetch.
   */
  async getCategories(): Promise<string[]> {
    return [];
  }

  /**
   * Set the label for a torrent.
   * Uses the torrent-set RPC method to replace the labels array.
   */
  async setCategory(id: string, category: string): Promise<void> {
    try {
      const torrent = await this.getTorrentByHash(id);
      await this.rpc('torrent-set', { ids: [torrent.hashString], labels: [category] });
      logger.info(`Set label for torrent ${id}: ${category}`);
    } catch (error) {
      logger.error('Failed to set label', { error: error instanceof Error ? error.message : String(error) });
      throw new Error('Failed to set torrent label');
    }
  }

  // =========================================================================
  // Internal Helpers
  // =========================================================================

  /**
   * Disable Transmission's global seed ratio and idle time limits for a torrent.
   * Mode 2 = unlimited (ignore global settings). RMAB manages torrent lifecycle
   * via the cleanup-seeded-torrents processor using per-indexer seeding times.
   */
  private async disableSeedLimits(hashOrId: string): Promise<void> {
    try {
      await this.rpc('torrent-set', {
        ids: [hashOrId],
        seedRatioMode: 2,
        seedIdleMode: 2,
      });
      logger.info(`Disabled seed limits for torrent: ${hashOrId}`);
    } catch (error) {
      // Non-fatal — torrent was still added, just might get cleaned up by Transmission's rules
      logger.warn(`Failed to disable seed limits for torrent ${hashOrId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get a torrent by its info hash.
   */
  private async getTorrentByHash(hash: string): Promise<TransmissionTorrent> {
    const data = await this.rpc('torrent-get', { ids: [hash], fields: TORRENT_FIELDS });

    if (data.result !== 'success') {
      throw new Error(`Transmission RPC error: ${data.result}`);
    }

    const torrents: TransmissionTorrent[] = data.arguments?.torrents || [];
    if (torrents.length === 0) {
      throw new Error(`Torrent ${hash} not found`);
    }

    return torrents[0];
  }

  /**
   * Map Transmission torrent to unified DownloadInfo.
   */
  private mapToDownloadInfo(torrent: TransmissionTorrent): DownloadInfo {
    // Return raw download path (path mapping is applied downstream by the consumer)
    const downloadPath = path.join(torrent.downloadDir, torrent.name);

    return {
      id: torrent.hashString,
      name: torrent.name,
      size: torrent.totalSize,
      bytesDownloaded: torrent.downloadedEver,
      progress: torrent.percentDone,
      status: this.mapStatus(torrent.status, torrent.error),
      downloadSpeed: torrent.rateDownload,
      eta: torrent.eta < 0 ? 0 : torrent.eta,
      category: torrent.labels?.[0] || '',
      downloadPath,
      completedAt: torrent.doneDate > 0 ? new Date(torrent.doneDate * 1000) : undefined,
      errorMessage: torrent.error > 0 ? torrent.errorString : undefined,
      seedingTime: torrent.secondsSeeding,
      ratio: torrent.uploadRatio >= 0 ? torrent.uploadRatio : undefined,
    };
  }

  /**
   * Map Transmission numeric status to unified DownloadStatus.
   * 0=stopped, 1=check-pending, 2=checking, 3=download-pending,
   * 4=downloading, 5=seed-pending, 6=seeding
   */
  private mapStatus(status: TransmissionStatus, errorCode: number): DownloadStatus {
    if (errorCode > 0) {
      return 'failed';
    }

    const statusMap: Record<TransmissionStatus, DownloadStatus> = {
      0: 'paused',
      1: 'checking',
      2: 'checking',
      3: 'queued',
      4: 'downloading',
      5: 'seeding',
      6: 'seeding',
    };

    return statusMap[status] || 'downloading';
  }

  /**
   * Extract info_hash from magnet link.
   */
  private extractHashFromMagnet(magnetUrl: string): string | null {
    const match = magnetUrl.match(/xt=urn:btih:([a-fA-F0-9]{40}|[a-zA-Z0-9]{32})/i);
    if (match) {
      return match[1].toLowerCase();
    }
    return null;
  }
}

// Singleton factory (matches qBittorrent, SABnzbd, NZBGet pattern)
let transmissionServiceInstance: TransmissionService | null = null;
let configLoaded = false;

export async function getTransmissionService(): Promise<TransmissionService> {
  if (transmissionServiceInstance && configLoaded) {
    return transmissionServiceInstance;
  }

  try {
    const { getConfigService } = await import('../services/config.service');
    const { getDownloadClientManager } = await import('../services/download-client-manager.service');
    const configService = await getConfigService();
    const manager = getDownloadClientManager(configService);

    logger.info('[Transmission] Loading configuration from download client manager...');
    const clientConfig = await manager.getClientForProtocol('torrent');

    if (!clientConfig) {
      throw new Error('Transmission is not configured. Please configure a Transmission client in the admin settings.');
    }

    if (clientConfig.type !== 'transmission') {
      throw new Error(`Expected Transmission client but found ${clientConfig.type}`);
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

    logger.info('[Transmission] Config loaded:', {
      name: clientConfig.name,
      hasUrl: !!clientConfig.url,
      hasUsername: !!clientConfig.username,
      hasPassword: !!clientConfig.password,
      disableSSLVerify: clientConfig.disableSSLVerify,
      downloadDir,
      pathMappingEnabled: pathMappingConfig.enabled,
    });

    if (!clientConfig.url) {
      throw new Error('Transmission is not fully configured. Please check your configuration in admin settings.');
    }

    transmissionServiceInstance = new TransmissionService(
      clientConfig.url,
      clientConfig.username || '',
      clientConfig.password || '',
      downloadDir,
      clientConfig.category || 'readmeabook',
      clientConfig.disableSSLVerify,
      pathMappingConfig
    );

    const connectionResult = await transmissionServiceInstance.testConnection();
    if (!connectionResult.success) {
      throw new Error(connectionResult.message || 'Transmission connection test failed. Please check your configuration in admin settings.');
    }

    logger.info('[Transmission] Connection test successful');
    configLoaded = true;
    return transmissionServiceInstance;
  } catch (error) {
    logger.error('[Transmission] Failed to initialize service', {
      error: error instanceof Error ? error.message : String(error),
    });
    transmissionServiceInstance = null;
    configLoaded = false;
    throw error;
  }
}

export function invalidateTransmissionService(): void {
  transmissionServiceInstance = null;
  configLoaded = false;
  logger.info('[Transmission] Service singleton invalidated');
}
