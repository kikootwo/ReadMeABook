/**
 * Component: Deluge Integration Service
 * Documentation: documentation/phase3/download-clients.md
 */

import axios, { AxiosInstance } from 'axios';
import https from 'https';
import path from 'path';
import { DOWNLOAD_CLIENT_TIMEOUT } from '../constants/download-timeouts';
import * as parseTorrentModule from 'parse-torrent';
import { RMABLogger } from '../utils/logger';
import { PathMapper, PathMappingConfig } from '../utils/path-mapper';
import {
  IDownloadClient, DownloadClientType, ProtocolType,
  DownloadInfo, DownloadStatus, AddDownloadOptions, ConnectionTestResult,
} from '../interfaces/download-client.interface';

const parseTorrent = (parseTorrentModule as any).default || parseTorrentModule;
const logger = RMABLogger.create('Deluge');

export class DelugeService implements IDownloadClient {
  readonly clientType: DownloadClientType = 'deluge';
  readonly protocol: ProtocolType = 'torrent';

  private client: AxiosInstance;
  private baseUrl: string;
  private password: string;
  private defaultSavePath: string;
  private defaultCategory: string;
  private pathMappingConfig: PathMappingConfig;
  private sessionCookie: string = '';
  private requestId: number = 0;

  constructor(
    baseUrl: string,
    _username: string, // Unused — Deluge uses password-only auth; kept for consistent signature
    password: string,
    defaultSavePath: string = '/downloads',
    defaultCategory: string = 'readmeabook',
    disableSSLVerify: boolean = false,
    pathMappingConfig?: PathMappingConfig
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.password = password;
    this.defaultSavePath = defaultSavePath;
    this.defaultCategory = defaultCategory;
    this.pathMappingConfig = pathMappingConfig || { enabled: false, remotePath: '', localPath: '' };

    const httpsAgent = disableSSLVerify && this.baseUrl.startsWith('https')
      ? new https.Agent({ rejectUnauthorized: false }) : undefined;
    if (httpsAgent) logger.info('[Deluge] SSL certificate verification disabled');

    this.client = axios.create({ baseURL: this.baseUrl, timeout: DOWNLOAD_CLIENT_TIMEOUT, httpsAgent });
  }

  /** JSON-RPC call with automatic re-authentication on auth failure */
  private async rpc(method: string, params: any[] = [], retried = false): Promise<any> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.sessionCookie) headers['Cookie'] = this.sessionCookie;

    try {
      const reqId = ++this.requestId;
      const { data } = await this.client.post('/json', { method, params, id: reqId }, { headers });
      // Deluge error.code === 1: "Not authenticated" — re-login then retry
      if (data.error?.code === 1 && !retried) {
        await this.login();
        return this.rpc(method, params, true);
      }
      // Deluge error.code === 2: "Unknown method" — daemon disconnected, force reconnect
      // Only retry for core.* methods — plugin methods (label.*) fail because the plugin
      // isn't enabled, not because the daemon is disconnected.
      if (data.error?.code === 2 && !retried && method.startsWith('core.')) {
        await this.login(true);
        return this.rpc(method, params, true);
      }
      return data;
    } catch (error) {
      if (!retried) { await this.login(); return this.rpc(method, params, true); }
      throw error;
    }
  }

  private async login(forceReconnect: boolean = false): Promise<void> {
    const { data, headers } = await this.client.post(
      '/json',
      { method: 'auth.login', params: [this.password], id: ++this.requestId },
      { headers: { 'Content-Type': 'application/json' } }
    );
    if (!data?.result) throw new Error('Failed to authenticate with Deluge — check your password');
    const cookies = headers['set-cookie'];
    if (cookies?.length) this.sessionCookie = cookies[0].split(';')[0];
    logger.info('Successfully authenticated with Deluge');

    // Deluge Web UI requires a daemon connection before core.* methods work.
    // When forceReconnect is true, skip the web.connected check and force a fresh connection.
    await this.ensureDaemonConnected(forceReconnect);
  }

  /**
   * Ensure the Web UI is connected to a deluged daemon host.
   * Uses web.connected (returns boolean) as the check — daemon.info is NOT a valid
   * method through the Deluge Web UI JSON-RPC; only web.* and core.* methods work.
   */
  private async ensureDaemonConnected(force: boolean = false): Promise<void> {
    if (!force) {
      const test = await this.rpc('web.connected', [], true);
      if (test.result === true) return;
    }

    logger.info('Connecting to daemon...');

    const hostsData = await this.rpc('web.get_hosts', [], true);
    const hosts: any[] = hostsData.result || [];

    if (hosts.length === 0) {
      throw new Error('Deluge has no daemon hosts configured. Add a host in the Deluge Web UI under Connection Manager.');
    }

    const hostId = hosts[0][0];
    const connectResult = await this.rpc('web.connect', [hostId], true);
    if (connectResult.error) {
      throw new Error(`Failed to connect to Deluge daemon: ${connectResult.error.message}`);
    }

    // Verify connection is established
    const verify = await this.rpc('web.connected', [], true);
    if (verify.result !== true) {
      throw new Error('Deluge daemon failed to respond after web.connect. Check that deluged is running.');
    }

    logger.info('Connected to Deluge daemon');
  }

  // =========================================================================
  // IDownloadClient Implementation
  // =========================================================================

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      await this.login();
      return { success: true, message: 'Connected to Deluge' };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Connection failed';
      if (axios.isAxiosError(error)) {
        const c = error.code;
        if (c?.includes('CERT') || c?.includes('SSL')) return { success: false, message: `SSL verification failed (${c}). Enable "Disable SSL Verification".` };
        if (c === 'ECONNREFUSED') return { success: false, message: `Connection refused at: ${this.baseUrl}` };
        if (c === 'ETIMEDOUT' || c === 'ECONNABORTED') return { success: false, message: `Connection timeout: ${this.baseUrl}` };
        if (c === 'ENOTFOUND') return { success: false, message: `Host not found: ${this.baseUrl}` };
        if (error.response?.status === 401) return { success: false, message: 'Authentication failed. Check your password.' };
      }
      logger.error('Connection test failed', { error: msg });
      return { success: false, message: msg };
    }
  }

  async addDownload(url: string, options?: AddDownloadOptions): Promise<string> {
    if (!url || typeof url !== 'string' || url.trim() === '') {
      throw new Error('Invalid download URL: URL is required and must be a non-empty string');
    }
    const category = options?.category || this.defaultCategory;
    return url.startsWith('magnet:')
      ? this.addMagnetLink(url, category, options)
      : this.addTorrentFile(url, category, options);
  }

  private async addMagnetLink(magnetUrl: string, category: string, options?: AddDownloadOptions): Promise<string> {
    const infoHash = this.extractHashFromMagnet(magnetUrl);
    if (!infoHash) throw new Error('Invalid magnet link - could not extract info_hash');
    logger.info(`Extracted info_hash from magnet: ${infoHash}`);

    const existing = await this.rpc('core.get_torrent_status', [infoHash, ['name']]);
    if (existing.result && Object.keys(existing.result).length > 0) {
      logger.info(`Torrent ${infoHash} already exists (duplicate)`);
      return infoHash;
    }

    const opts = this.buildTorrentOptions(options?.paused);
    const data = await this.rpc('core.add_torrent_magnet', [magnetUrl, opts]);
    if (!data.result) throw new Error(`Deluge rejected magnet link: ${data.error?.message || 'unknown error'}`);

    await this.postAddSetup(data.result, category);
    logger.info(`Successfully added magnet link: ${infoHash}`);
    return infoHash;
  }

  private async addTorrentFile(torrentUrl: string, category: string, options?: AddDownloadOptions): Promise<string> {
    logger.info(`Downloading .torrent file from: ${torrentUrl}`);

    let torrentResponse;
    try {
      torrentResponse = await axios.get(torrentUrl, {
        responseType: 'arraybuffer', maxRedirects: 0,
        validateStatus: (s) => s >= 200 && s < 300, timeout: DOWNLOAD_CLIENT_TIMEOUT,
      });
      if (torrentResponse.data.length > 0) {
        const magnetMatch = torrentResponse.data.toString().match(/^magnet:\?[^\s]+$/);
        if (magnetMatch) return this.addMagnetLink(magnetMatch[0], category, options);
      }
    } catch (error) {
      if (!axios.isAxiosError(error) || !error.response) throw error;
      const status = error.response.status;
      if (status >= 300 && status < 400) {
        const loc = error.response.headers['location'];
        if (loc?.startsWith('magnet:')) return this.addMagnetLink(loc, category, options);
        if (loc?.startsWith('http://') || loc?.startsWith('https://')) {
          try { torrentResponse = await axios.get(loc, { responseType: 'arraybuffer', timeout: DOWNLOAD_CLIENT_TIMEOUT, maxRedirects: 5 }); }
          catch { throw new Error('Failed to download torrent file after redirect'); }
        } else { throw new Error(`Invalid redirect location: ${loc}`); }
      } else { throw new Error(`Failed to download torrent: HTTP ${status}`); }
    }

    const torrentBuffer = Buffer.from(torrentResponse.data);
    let parsed: any;
    try { parsed = await parseTorrent(torrentBuffer); }
    catch { throw new Error('Invalid .torrent file - failed to parse'); }

    const infoHash = parsed.infoHash;
    if (!infoHash) throw new Error('Failed to extract info_hash from .torrent file');
    logger.info(`Extracted info_hash: ${infoHash}`);

    const existing = await this.rpc('core.get_torrent_status', [infoHash, ['name']]);
    if (existing.result && Object.keys(existing.result).length > 0) {
      logger.info(`Torrent ${infoHash} already exists (duplicate)`);
      return infoHash;
    }

    const filename = parsed.name ? `${parsed.name}.torrent` : 'torrent.torrent';
    const opts = this.buildTorrentOptions(options?.paused);
    const data = await this.rpc('core.add_torrent_file', [filename, torrentBuffer.toString('base64'), opts]);
    if (!data.result) throw new Error(`Deluge rejected .torrent file: ${data.error?.message || 'unknown error'}`);

    await this.postAddSetup(infoHash, category);
    logger.info(`Successfully added torrent: ${infoHash}`);
    return infoHash;
  }

  async getDownload(id: string): Promise<DownloadInfo | null> {
    const fields = ['name', 'total_size', 'total_done', 'progress', 'state',
      'download_payload_rate', 'eta', 'label', 'save_path',
      'time_added', 'is_finished', 'seeding_time', 'ratio', 'message'];

    for (let attempt = 0; attempt <= 3; attempt++) {
      const { result } = await this.rpc('core.get_torrent_status', [id, fields]);
      if (result && Object.keys(result).length > 0) return this.mapToDownloadInfo(id, result);
      if (attempt === 3) return null;
      const delay = 500 * Math.pow(2, attempt);
      logger.warn(`Torrent ${id} not found, retrying in ${delay}ms (${attempt + 1}/3)`);
      await new Promise(r => setTimeout(r, delay));
    }
    return null;
  }

  async pauseDownload(id: string): Promise<void> {
    await this.rpc('core.pause_torrent', [[id]]);
    logger.info(`Paused torrent: ${id}`);
  }

  async resumeDownload(id: string): Promise<void> {
    await this.rpc('core.resume_torrent', [[id]]);
    logger.info(`Resumed torrent: ${id}`);
  }

  async deleteDownload(id: string, deleteFiles: boolean = false): Promise<void> {
    await this.rpc('core.remove_torrent', [id, deleteFiles]);
    logger.info(`Deleted torrent: ${id}`);
  }

  async postProcess(_id: string): Promise<void> {} // No-op: seeding cleanup scheduler manages lifecycle

  async getCategories(): Promise<string[]> {
    try { const { result } = await this.rpc('label.get_labels'); return Array.isArray(result) ? result : []; }
    catch { return []; }
  }

  async setCategory(id: string, category: string): Promise<void> {
    await this.applyLabel(id, category);
    logger.info(`Set label for torrent ${id}: ${category}`);
  }

  // =========================================================================
  // Internal Helpers
  // =========================================================================

  private buildTorrentOptions(paused?: boolean): Record<string, any> {
    const remoteSavePath = PathMapper.reverseTransform(this.defaultSavePath, this.pathMappingConfig);
    const opts: Record<string, any> = { download_location: remoteSavePath, move_completed: false, move_completed_path: '' };
    if (paused) opts.add_paused = true;
    return opts;
  }

  private async postAddSetup(hash: string, category: string): Promise<void> {
    await this.disableSeedLimits(hash);
    await this.applyLabel(hash, category);
  }

  private async applyLabel(hash: string, label: string): Promise<void> {
    try {
      try { await this.rpc('label.add', [label]); } catch { /* may already exist */ }
      await this.rpc('label.set_torrent', [hash, label]);
    } catch (error) {
      logger.warn(`Failed to apply label "${label}" to ${hash}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async disableSeedLimits(hash: string): Promise<void> {
    try {
      await this.rpc('core.set_torrent_options', [[hash], { stop_at_ratio: false, seed_time_limit: -1 }]);
    } catch (error) {
      logger.warn(`Failed to disable seed limits for ${hash}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private mapToDownloadInfo(hash: string, t: Record<string, any>): DownloadInfo {
    return {
      id: hash, name: t.name || '', size: t.total_size || 0,
      bytesDownloaded: t.total_done || 0, progress: (t.progress || 0) / 100,
      status: this.mapStatus(t.state), downloadSpeed: t.download_payload_rate || 0,
      eta: t.eta > 0 ? t.eta : 0, category: t.label || '',
      downloadPath: t.save_path ? path.join(t.save_path, t.name || '') : undefined,
      completedAt: t.is_finished && t.time_added ? new Date(t.time_added * 1000) : undefined,
      errorMessage: t.message || undefined, seedingTime: t.seeding_time,
      ratio: t.ratio >= 0 ? t.ratio : undefined,
    };
  }

  private mapStatus(state: string): DownloadStatus {
    const map: Record<string, DownloadStatus> = {
      'Downloading': 'downloading', 'Seeding': 'seeding', 'Paused': 'paused',
      'Checking': 'checking', 'Queued': 'queued', 'Error': 'failed', 'Moving': 'downloading',
    };
    return map[state] || 'downloading';
  }

  private extractHashFromMagnet(magnetUrl: string): string | null {
    const match = magnetUrl.match(/xt=urn:btih:([a-fA-F0-9]{40}|[a-zA-Z0-9]{32})/i);
    return match ? match[1].toLowerCase() : null;
  }
}

// Singleton factory (matches Transmission/qBittorrent pattern)
let delugeServiceInstance: DelugeService | null = null;
let configLoaded = false;

export async function getDelugeService(): Promise<DelugeService> {
  if (delugeServiceInstance && configLoaded) return delugeServiceInstance;

  try {
    const { getConfigService } = await import('../services/config.service');
    const { getDownloadClientManager } = await import('../services/download-client-manager.service');
    const configService = await getConfigService();
    const manager = getDownloadClientManager(configService);

    const clientConfig = await manager.getClientForProtocol('torrent');
    if (!clientConfig) throw new Error('Deluge is not configured. Please configure a Deluge client in admin settings.');
    if (clientConfig.type !== 'deluge') throw new Error(`Expected Deluge client but found ${clientConfig.type}`);
    if (!clientConfig.url) throw new Error('Deluge is not fully configured. Check your configuration in admin settings.');

    const baseDir = await configService.get('download_dir') || '/downloads';
    const downloadDir = clientConfig.customPath ? require('path').join(baseDir, clientConfig.customPath) : baseDir;

    delugeServiceInstance = new DelugeService(
      clientConfig.url, clientConfig.username || '', clientConfig.password || '',
      downloadDir, clientConfig.category || 'readmeabook', clientConfig.disableSSLVerify,
      { enabled: clientConfig.remotePathMappingEnabled || false, remotePath: clientConfig.remotePath || '', localPath: clientConfig.localPath || '' }
    );

    const result = await delugeServiceInstance.testConnection();
    if (!result.success) throw new Error(result.message || 'Deluge connection test failed.');

    logger.info('[Deluge] Connection test successful');
    configLoaded = true;
    return delugeServiceInstance;
  } catch (error) {
    logger.error('[Deluge] Failed to initialize service', { error: error instanceof Error ? error.message : String(error) });
    delugeServiceInstance = null;
    configLoaded = false;
    throw error;
  }
}

export function invalidateDelugeService(): void {
  delugeServiceInstance = null;
  configLoaded = false;
  logger.info('[Deluge] Service singleton invalidated');
}
