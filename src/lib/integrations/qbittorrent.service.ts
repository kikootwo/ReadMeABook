/**
 * Component: qBittorrent Integration Service
 * Documentation: documentation/phase3/qbittorrent.md
 */

import axios, { AxiosInstance } from 'axios';
import * as parseTorrentModule from 'parse-torrent';
import FormData from 'form-data';

// Handle both ESM and CommonJS imports
const parseTorrent = (parseTorrentModule as any).default || parseTorrentModule;

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
  seeding_time?: number; // Seconds spent seeding
  ratio?: number; // Upload/download ratio
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
   * Add torrent (magnet link or file URL) - Enterprise Implementation
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

      // Determine if this is a magnet link or .torrent file URL
      if (url.startsWith('magnet:')) {
        console.log('[qBittorrent] Detected magnet link');
        return await this.addMagnetLink(url, category, options);
      } else {
        console.log('[qBittorrent] Detected .torrent file URL');
        return await this.addTorrentFile(url, category, options);
      }
    } catch (error) {
      // Try re-authenticating if we get a 403
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        console.log('[qBittorrent] Session expired, re-authenticating...');
        await this.login();
        return this.addTorrent(url, options); // Retry once
      }

      console.error('[qBittorrent] Failed to add torrent:', error);
      throw new Error('Failed to add torrent to qBittorrent');
    }
  }

  /**
   * Add magnet link - hash is extractable from URI (deterministic)
   */
  private async addMagnetLink(
    magnetUrl: string,
    category: string,
    options?: AddTorrentOptions
  ): Promise<string> {
    // Extract info_hash from magnet link (deterministic)
    const infoHash = this.extractHashFromMagnet(magnetUrl);

    if (!infoHash) {
      throw new Error('Invalid magnet link - could not extract info_hash');
    }

    console.log(`[qBittorrent] Extracted info_hash from magnet: ${infoHash}`);

    // Check for duplicates
    try {
      const existing = await this.getTorrent(infoHash);
      console.log(`[qBittorrent] Torrent ${infoHash} already exists (duplicate), returning existing hash`);
      return infoHash;
    } catch {
      // Torrent doesn't exist, continue with adding
    }

    // Upload via 'urls' parameter
    const form = new URLSearchParams({
      urls: magnetUrl,
      savepath: options?.savePath || this.defaultSavePath,
      category,
      paused: options?.paused ? 'true' : 'false',
      sequentialDownload: (options?.sequentialDownload !== false).toString(),
    });

    if (options?.tags) {
      form.append('tags', options.tags.join(','));
    }

    console.log('[qBittorrent] Uploading magnet link...');

    const response = await this.client.post('/torrents/add', form, {
      headers: {
        Cookie: this.cookie,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    if (response.data !== 'Ok.') {
      throw new Error(`qBittorrent rejected magnet link: ${response.data}`);
    }

    console.log(`[qBittorrent] Successfully added magnet link: ${infoHash}`);
    return infoHash;
  }

  /**
   * Add .torrent file - download, parse, extract hash, upload content (deterministic)
   */
  private async addTorrentFile(
    torrentUrl: string,
    category: string,
    options?: AddTorrentOptions
  ): Promise<string> {
    console.log(`[qBittorrent] Downloading .torrent file from: ${torrentUrl}`);

    // Make initial request with maxRedirects: 0 to intercept redirects
    // Some Prowlarr indexers return HTTP URLs that redirect to magnet: links
    let torrentResponse;
    try {
      torrentResponse = await axios.get(torrentUrl, {
        responseType: 'arraybuffer',
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 300, // Only 2xx is success
        timeout: 10000,
      });

      console.log(`[qBittorrent] Got 2xx response, size=${torrentResponse.data.length} bytes`);

      // Check if response body contains a magnet link
      if (torrentResponse.data.length > 0) {
        const responseText = torrentResponse.data.toString();
        const magnetMatch = responseText.match(/^magnet:\?[^\s]+$/);
        if (magnetMatch) {
          console.log(`[qBittorrent] Response body is a magnet link`);
          return await this.addMagnetLink(magnetMatch[0], category, options);
        }
      }

      // Got valid torrent data (or will be validated below)
    } catch (error) {
      if (!axios.isAxiosError(error) || !error.response) {
        // Not an axios error or no response - re-throw
        console.error(`[qBittorrent] Request failed:`, error);
        throw error;
      }

      const status = error.response.status;

      // Handle 3xx redirects
      if (status >= 300 && status < 400) {
        const location = error.response.headers['location'];
        console.log(`[qBittorrent] Got ${status} redirect to: ${location}`);

        // Check if redirect target is a magnet link
        if (location && location.startsWith('magnet:')) {
          console.log(`[qBittorrent] Redirect target is magnet link`);
          return await this.addMagnetLink(location, category, options);
        }

        // Regular HTTP redirect - follow it manually
        if (location && (location.startsWith('http://') || location.startsWith('https://'))) {
          console.log(`[qBittorrent] Following HTTP redirect...`);
          try {
            torrentResponse = await axios.get(location, {
              responseType: 'arraybuffer',
              timeout: 30000,
              maxRedirects: 5,
            });
            console.log(`[qBittorrent] After following redirect: size=${torrentResponse.data.length} bytes`);
          } catch (redirectError) {
            console.error(`[qBittorrent] Failed to follow redirect:`, redirectError);
            throw new Error('Failed to download torrent file after redirect');
          }
        } else {
          throw new Error(`Invalid redirect location: ${location}`);
        }
      } else {
        // Non-redirect error (4xx, 5xx)
        console.error(`[qBittorrent] HTTP error ${status}:`, error.message);
        throw new Error(`Failed to download torrent: HTTP ${status}`);
      }
    }

    const torrentBuffer = Buffer.from(torrentResponse.data);
    console.log(`[qBittorrent] Processing torrent file: ${torrentBuffer.length} bytes`);

    // Parse .torrent file to extract info_hash (deterministic)
    let parsedTorrent: any;
    try {
      parsedTorrent = await parseTorrent(torrentBuffer);
    } catch (error) {
      console.error('[qBittorrent] Failed to parse .torrent file:', error);
      throw new Error('Invalid .torrent file - failed to parse');
    }

    const infoHash = parsedTorrent.infoHash;

    if (!infoHash) {
      throw new Error('Failed to extract info_hash from .torrent file');
    }

    console.log(`[qBittorrent] Extracted info_hash: ${infoHash}`);
    console.log(`[qBittorrent] Torrent name: ${parsedTorrent.name || 'Unknown'}`);

    // Check for duplicates
    try {
      const existing = await this.getTorrent(infoHash);
      console.log(`[qBittorrent] Torrent ${infoHash} already exists (duplicate), returning existing hash`);
      return infoHash;
    } catch {
      // Torrent doesn't exist, continue with adding
    }

    // Upload .torrent file content via multipart/form-data
    const formData = new FormData();

    const filename = parsedTorrent.name ? `${parsedTorrent.name}.torrent` : 'torrent.torrent';
    formData.append('torrents', torrentBuffer, {
      filename,
      contentType: 'application/x-bittorrent',
    });
    formData.append('savepath', options?.savePath || this.defaultSavePath);
    formData.append('category', category);
    formData.append('paused', options?.paused ? 'true' : 'false');
    formData.append('sequentialDownload', (options?.sequentialDownload !== false).toString());

    if (options?.tags) {
      formData.append('tags', options.tags.join(','));
    }

    console.log('[qBittorrent] Uploading .torrent file content...');

    const response = await this.client.post('/torrents/add', formData, {
      headers: {
        Cookie: this.cookie,
        ...formData.getHeaders(),
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    if (response.data !== 'Ok.') {
      throw new Error(`qBittorrent rejected .torrent file: ${response.data}`);
    }

    console.log(`[qBittorrent] Successfully added torrent: ${infoHash}`);
    return infoHash;
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
      // Don't log error here - caller handles it (e.g., duplicate checking)
      throw error;
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
   * Extract info_hash from magnet link
   */
  private extractHashFromMagnet(magnetUrl: string): string | null {
    // Extract hash from magnet:?xt=urn:btih:HASH
    const match = magnetUrl.match(/xt=urn:btih:([a-fA-F0-9]{40}|[a-zA-Z0-9]{32})/i);
    if (match) {
      return match[1].toLowerCase();
    }

    return null;
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
