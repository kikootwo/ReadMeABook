/**
 * Component: qBittorrent Integration Service
 * Documentation: documentation/phase3/qbittorrent.md
 */

import axios, { AxiosInstance } from 'axios';

export interface AddTorrentOptions {
  savePath?: string;
  category?: string;
  tags?: string[];
  paused?: boolean;
  skipChecking?: boolean;
  sequentialDownload?: boolean;
}

export interface TorrentInfo {
  hash: string;
  name: string;
  size: number;
  progress: number; // 0.0 to 1.0
  dlspeed: number; // Bytes per second
  upspeed: number;
  downloaded: number;
  uploaded: number;
  eta: number; // Seconds remaining
  state: TorrentState;
  category: string;
  tags: string;
  save_path: string;
  completion_on: number; // Unix timestamp
  added_on: number;
}

export type TorrentState =
  | 'downloading'
  | 'uploading'
  | 'stalledDL'
  | 'stalledUP'
  | 'pausedDL'
  | 'pausedUP'
  | 'queuedDL'
  | 'queuedUP'
  | 'checkingDL'
  | 'checkingUP'
  | 'error'
  | 'missingFiles'
  | 'allocating';

export interface TorrentFile {
  name: string;
  size: number;
  progress: number;
  priority: number;
  index: number;
}

export interface DownloadProgress {
  percent: number;
  bytesDownloaded: number;
  bytesTotal: number;
  speed: number;
  eta: number;
  state: string;
}

export class QBittorrentService {
  private client: AxiosInstance;
  private baseUrl: string;
  private username: string;
  private password: string;
  private cookie?: string;
  private defaultSavePath: string;
  private defaultCategory: string;

  constructor(
    baseUrl: string,
    username: string,
    password: string,
    defaultSavePath: string = '/downloads',
    defaultCategory: string = 'readmeabook'
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.username = username;
    this.password = password;
    this.defaultSavePath = defaultSavePath;
    this.defaultCategory = defaultCategory;

    this.client = axios.create({
      baseURL: `${this.baseUrl}/api/v2`,
      timeout: 30000,
    });
  }

  /**
   * Authenticate and establish session
   */
  async login(): Promise<void> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/api/v2/auth/login`,
        new URLSearchParams({
          username: this.username,
          password: this.password,
        }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }
      );

      // Extract cookie from response
      const cookies = response.headers['set-cookie'];
      if (cookies && cookies.length > 0) {
        this.cookie = cookies[0].split(';')[0];
      }

      if (!this.cookie) {
        throw new Error('Failed to authenticate with qBittorrent');
      }

      console.log('Successfully authenticated with qBittorrent');
    } catch (error) {
      console.error('qBittorrent login failed:', error);
      throw new Error('Failed to authenticate with qBittorrent');
    }
  }

  /**
   * Add torrent (magnet link or file URL)
   */
  async addTorrent(url: string, options?: AddTorrentOptions): Promise<string> {
    // Ensure we're authenticated
    if (!this.cookie) {
      await this.login();
    }

    try {
      const form = new URLSearchParams({
        urls: url,
        savepath: options?.savePath || this.defaultSavePath,
        category: options?.category || this.defaultCategory,
        paused: options?.paused ? 'true' : 'false',
        sequentialDownload: (options?.sequentialDownload !== false).toString(),
      });

      if (options?.tags) {
        form.append('tags', options.tags.join(','));
      }

      await this.client.post('/torrents/add', form, {
        headers: {
          Cookie: this.cookie,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      // Extract hash from magnet link or URL
      const hash = this.extractHash(url);

      console.log(`Added torrent to qBittorrent: ${hash}`);

      return hash;
    } catch (error) {
      // Try re-authenticating if we get a 403
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        console.log('Session expired, re-authenticating...');
        await this.login();
        return this.addTorrent(url, options); // Retry once
      }

      console.error('Failed to add torrent:', error);
      throw new Error('Failed to add torrent to qBittorrent');
    }
  }

  /**
   * Get torrent status and progress
   */
  async getTorrent(hash: string): Promise<TorrentInfo> {
    if (!this.cookie) {
      await this.login();
    }

    try {
      const response = await this.client.get('/torrents/info', {
        headers: { Cookie: this.cookie },
        params: { hashes: hash },
      });

      const torrents = response.data;
      if (!torrents || torrents.length === 0) {
        throw new Error(`Torrent ${hash} not found`);
      }

      return torrents[0];
    } catch (error) {
      console.error('Failed to get torrent info:', error);
      throw new Error('Failed to get torrent information');
    }
  }

  /**
   * Get all torrents (optionally filtered by category)
   */
  async getTorrents(category?: string): Promise<TorrentInfo[]> {
    if (!this.cookie) {
      await this.login();
    }

    try {
      const params: Record<string, string> = {};
      if (category) {
        params.category = category;
      }

      const response = await this.client.get('/torrents/info', {
        headers: { Cookie: this.cookie },
        params,
      });

      return response.data;
    } catch (error) {
      console.error('Failed to get torrents:', error);
      throw new Error('Failed to get torrents from qBittorrent');
    }
  }

  /**
   * Pause torrent
   */
  async pauseTorrent(hash: string): Promise<void> {
    if (!this.cookie) {
      await this.login();
    }

    try {
      await this.client.post(
        '/torrents/pause',
        new URLSearchParams({ hashes: hash }),
        {
          headers: {
            Cookie: this.cookie,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      console.log(`Paused torrent: ${hash}`);
    } catch (error) {
      console.error('Failed to pause torrent:', error);
      throw new Error('Failed to pause torrent');
    }
  }

  /**
   * Resume torrent
   */
  async resumeTorrent(hash: string): Promise<void> {
    if (!this.cookie) {
      await this.login();
    }

    try {
      await this.client.post(
        '/torrents/resume',
        new URLSearchParams({ hashes: hash }),
        {
          headers: {
            Cookie: this.cookie,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      console.log(`Resumed torrent: ${hash}`);
    } catch (error) {
      console.error('Failed to resume torrent:', error);
      throw new Error('Failed to resume torrent');
    }
  }

  /**
   * Delete torrent
   */
  async deleteTorrent(hash: string, deleteFiles: boolean = false): Promise<void> {
    if (!this.cookie) {
      await this.login();
    }

    try {
      await this.client.post(
        '/torrents/delete',
        new URLSearchParams({
          hashes: hash,
          deleteFiles: deleteFiles.toString(),
        }),
        {
          headers: {
            Cookie: this.cookie,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      console.log(`Deleted torrent: ${hash}`);
    } catch (error) {
      console.error('Failed to delete torrent:', error);
      throw new Error('Failed to delete torrent');
    }
  }

  /**
   * Get files in torrent
   */
  async getFiles(hash: string): Promise<TorrentFile[]> {
    if (!this.cookie) {
      await this.login();
    }

    try {
      const response = await this.client.get('/torrents/files', {
        headers: { Cookie: this.cookie },
        params: { hash },
      });

      return response.data;
    } catch (error) {
      console.error('Failed to get torrent files:', error);
      throw new Error('Failed to get torrent files');
    }
  }

  /**
   * Set category for torrent
   */
  async setCategory(hash: string, category: string): Promise<void> {
    if (!this.cookie) {
      await this.login();
    }

    try {
      await this.client.post(
        '/torrents/setCategory',
        new URLSearchParams({
          hashes: hash,
          category,
        }),
        {
          headers: {
            Cookie: this.cookie,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      console.log(`Set category for torrent ${hash}: ${category}`);
    } catch (error) {
      console.error('Failed to set category:', error);
      throw new Error('Failed to set torrent category');
    }
  }

  /**
   * Test connection to qBittorrent
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.login();
      return true;
    } catch (error) {
      console.error('qBittorrent connection test failed:', error);
      return false;
    }
  }

  /**
   * Get download progress details
   */
  getDownloadProgress(torrent: TorrentInfo): DownloadProgress {
    return {
      percent: Math.round(torrent.progress * 100),
      bytesDownloaded: torrent.downloaded,
      bytesTotal: torrent.size,
      speed: torrent.dlspeed,
      eta: torrent.eta,
      state: this.mapState(torrent.state),
    };
  }

  /**
   * Map qBittorrent state to our simplified state
   */
  private mapState(state: TorrentState): string {
    const stateMap: Record<TorrentState, string> = {
      downloading: 'downloading',
      uploading: 'completed',
      stalledDL: 'downloading',
      stalledUP: 'completed',
      pausedDL: 'paused',
      pausedUP: 'paused',
      queuedDL: 'queued',
      queuedUP: 'completed',
      checkingDL: 'checking',
      checkingUP: 'checking',
      error: 'failed',
      missingFiles: 'failed',
      allocating: 'downloading',
    };

    return stateMap[state] || 'unknown';
  }

  /**
   * Extract hash from magnet link or .torrent URL
   */
  private extractHash(url: string): string {
    // Check if it's a magnet link
    if (url.startsWith('magnet:')) {
      // Extract hash from magnet:?xt=urn:btih:HASH
      const match = url.match(/xt=urn:btih:([a-fA-F0-9]{40}|[a-zA-Z0-9]{32})/i);
      if (match) {
        return match[1].toLowerCase();
      }
    }

    // If we can't extract hash, generate a temporary placeholder
    // The actual hash will be available after qBittorrent processes it
    return 'pending';
  }
}

// Singleton instance
let qbittorrentService: QBittorrentService | null = null;

export async function getQBittorrentService(): Promise<QBittorrentService> {
  if (!qbittorrentService) {
    // Get configuration from environment or config service
    const baseUrl = process.env.QBITTORRENT_URL || 'http://qbittorrent:8080';
    const username = process.env.QBITTORRENT_USERNAME || 'admin';
    const password = process.env.QBITTORRENT_PASSWORD;
    const savePath = process.env.DOWNLOAD_DIR || '/downloads';

    if (!password) {
      throw new Error('qBittorrent password not configured');
    }

    qbittorrentService = new QBittorrentService(
      baseUrl,
      username,
      password,
      savePath,
      'readmeabook'
    );

    // Test connection
    const isConnected = await qbittorrentService.testConnection();
    if (!isConnected) {
      console.warn('Warning: qBittorrent connection test failed');
    }
  }

  return qbittorrentService;
}
