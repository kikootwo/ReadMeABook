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
      const category = options?.category || this.defaultCategory;

      // Ensure category exists
      await this.ensureCategory(category);

      const form = new URLSearchParams({
        urls: url,
        savepath: options?.savePath || this.defaultSavePath,
        category,
        paused: options?.paused ? 'true' : 'false',
        sequentialDownload: (options?.sequentialDownload !== false).toString(),
      });

      if (options?.tags) {
        form.append('tags', options.tags.join(','));
      }

      console.log('[qBittorrent] Adding torrent with category:', category);

      const addResponse = await this.client.post('/torrents/add', form, {
        headers: {
          Cookie: this.cookie,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      console.log('[qBittorrent] Add torrent response status:', addResponse.status);
      console.log('[qBittorrent] Add torrent response data:', addResponse.data);

      // Try to extract hash from magnet link
      const extractedHash = this.extractHash(url);

      // If we got a real hash from magnet link, return it
      if (extractedHash !== 'pending') {
        console.log(`[qBittorrent] Added torrent (from magnet): ${extractedHash}`);
        return extractedHash;
      }

      // For .torrent URLs, we need to query qBittorrent to get the actual hash
      console.log('[qBittorrent] Waiting for torrent to be processed...');

      // Wait for qBittorrent to process the torrent
      await new Promise(resolve => setTimeout(resolve, 2000));

      // First, try to get all torrents regardless of category to see if it was added
      const allTorrents = await this.getTorrents();
      console.log(`[qBittorrent] Total torrents in qBittorrent: ${allTorrents.length}`);

      // Get torrents in our category
      const categoryTorrents = await this.getTorrents(category);
      console.log(`[qBittorrent] Torrents in category "${category}": ${categoryTorrents.length}`);

      if (categoryTorrents.length === 0) {
        // Check if torrent was added without category
        if (allTorrents.length > 0) {
          const newestOverall = allTorrents.reduce((newest, current) =>
            current.added_on > newest.added_on ? current : newest
          );
          console.warn(`[qBittorrent] Torrent may have been added without category. Newest torrent: ${newestOverall.hash} in category "${newestOverall.category}"`);

          // Set the correct category
          await this.setCategory(newestOverall.hash, category);
          console.log(`[qBittorrent] Set category to "${category}" for torrent ${newestOverall.hash}`);

          return newestOverall.hash;
        }

        throw new Error('Failed to retrieve torrent after adding - no torrents found');
      }

      // Find the most recently added torrent in our category
      const newestTorrent = categoryTorrents.reduce((newest, current) =>
        current.added_on > newest.added_on ? current : newest
      );

      console.log(`[qBittorrent] Added torrent: ${newestTorrent.hash} (${newestTorrent.name})`);

      return newestTorrent.hash;
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
   * Ensure category exists in qBittorrent
   */
  private async ensureCategory(category: string): Promise<void> {
    if (!this.cookie) {
      await this.login();
    }

    try {
      // Create category (this is idempotent - won't fail if it already exists)
      await this.client.post(
        '/torrents/createCategory',
        new URLSearchParams({
          category,
          savePath: this.defaultSavePath,
        }),
        {
          headers: {
            Cookie: this.cookie,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      console.log(`[qBittorrent] Category "${category}" ensured`);
    } catch (error) {
      // Ignore errors - category might already exist
      console.log(`[qBittorrent] Category creation returned:`, error);
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
   * Static method to test connection with custom credentials (for setup wizard)
   */
  static async testConnectionWithCredentials(
    url: string,
    username: string,
    password: string
  ): Promise<string> {
    const baseUrl = url.replace(/\/$/, '');

    try {
      const response = await axios.post(
        `${baseUrl}/api/v2/auth/login`,
        new URLSearchParams({ username, password }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }
      );

      // Get version to confirm connection
      const cookies = response.headers['set-cookie'];
      if (!cookies || cookies.length === 0) {
        throw new Error('Failed to authenticate');
      }

      const cookie = cookies[0].split(';')[0];

      const versionResponse = await axios.get(`${baseUrl}/api/v2/app/version`, {
        headers: { Cookie: cookie },
      });

      return versionResponse.data || 'Connected';
    } catch (error) {
      console.error('qBittorrent connection test failed:', error);
      throw new Error('Failed to connect to qBittorrent');
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
let configLoaded = false;

export async function getQBittorrentService(): Promise<QBittorrentService> {
  // Always recreate if config hasn't been loaded successfully
  if (!qbittorrentService || !configLoaded) {
    try {
      // Get configuration from database ONLY (no env var fallback)
      const { getConfigService } = await import('@/lib/services/config.service');
      const configService = getConfigService();

      console.log('[qBittorrent] Loading configuration from database...');
      const config = await configService.getMany([
        'download_client_url',
        'download_client_username',
        'download_client_password',
        'download_dir',
      ]);

      console.log('[qBittorrent] Config loaded:', {
        hasUrl: !!config.download_client_url,
        hasUsername: !!config.download_client_username,
        hasPassword: !!config.download_client_password,
        hasPath: !!config.download_dir,
      });

      // Validate all required fields are present (no env var fallback)
      const missingFields: string[] = [];

      if (!config.download_client_url) {
        missingFields.push('qBittorrent URL');
      }
      if (!config.download_client_username) {
        missingFields.push('qBittorrent username');
      }
      if (!config.download_client_password) {
        missingFields.push('qBittorrent password');
      }
      if (!config.download_dir) {
        missingFields.push('Download path');
      }

      if (missingFields.length > 0) {
        const errorMsg = `qBittorrent is not fully configured. Missing: ${missingFields.join(', ')}. Please configure qBittorrent in the admin settings.`;
        console.error('[qBittorrent]', errorMsg);
        throw new Error(errorMsg);
      }

      // TypeScript type narrowing: at this point we know all values are non-null
      const url = config.download_client_url as string;
      const username = config.download_client_username as string;
      const password = config.download_client_password as string;
      const savePath = config.download_dir as string;

      console.log('[qBittorrent] Creating service instance...');
      qbittorrentService = new QBittorrentService(
        url,
        username,
        password,
        savePath,
        'readmeabook'
      );

      // Test connection
      console.log('[qBittorrent] Testing connection...');
      const isConnected = await qbittorrentService.testConnection();
      if (!isConnected) {
        console.warn('[qBittorrent] Connection test failed');
        throw new Error('qBittorrent connection test failed. Please check your configuration in admin settings.');
      } else {
        console.log('[qBittorrent] Connection test successful');
        configLoaded = true; // Mark as successfully loaded
      }
    } catch (error) {
      console.error('[qBittorrent] Failed to initialize service:', error);
      qbittorrentService = null; // Reset service on error
      configLoaded = false;
      throw error;
    }
  }

  return qbittorrentService;
}
