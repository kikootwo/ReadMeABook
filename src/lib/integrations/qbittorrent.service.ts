/**
 * Component: qBittorrent Integration Service
 * Documentation: documentation/phase3/qbittorrent.md
 */

import axios, { AxiosInstance } from 'axios';
import https from 'https';
import path from 'path';
import { DOWNLOAD_CLIENT_TIMEOUT } from '../constants/download-timeouts';
import * as parseTorrentModule from 'parse-torrent';
import FormData from 'form-data';
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

// Module-level logger
const logger = RMABLogger.create('QBittorrent');

export interface AddTorrentOptions {
  category?: string;
  tags?: string[];
  paused?: boolean;
  skipChecking?: boolean;
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
  content_path?: string; // Absolute path to torrent content (file or directory)
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
  | 'allocating'
  // Forced states (user clicked "Force Resume" in qBittorrent UI)
  | 'forcedDL'
  | 'forcedUP'
  // Metadata fetching states
  | 'metaDL'
  | 'forcedMetaDL'
  // qBittorrent v5.0+ renamed paused → stopped
  | 'stoppedDL'
  | 'stoppedUP'
  // Other states
  | 'checkingResumeData'
  | 'moving';

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

export class QBittorrentService implements IDownloadClient {
  readonly clientType: DownloadClientType = 'qbittorrent';
  readonly protocol: ProtocolType = 'torrent';

  private client: AxiosInstance;
  private baseUrl: string;
  private username: string;
  private password: string;
  private cookie?: string;
  private defaultSavePath: string;
  private defaultCategory: string;
  private disableSSLVerify: boolean;
  private httpsAgent?: https.Agent;
  private pathMappingConfig: PathMappingConfig;

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

    // Create HTTPS agent if SSL verification is disabled
    if (disableSSLVerify && this.baseUrl.startsWith('https')) {
      this.httpsAgent = new https.Agent({
        rejectUnauthorized: false,
      });
      logger.info('[QBittorrent] SSL certificate verification disabled');
    }

    this.client = axios.create({
      baseURL: `${this.baseUrl}/api/v2`,
      timeout: DOWNLOAD_CLIENT_TIMEOUT,
      httpsAgent: this.httpsAgent,
      // Support nginx/Apache reverse proxy with HTTP Basic Auth
      auth: {
        username: this.username,
        password: this.password,
      },
    });
  }

  /**
   * Authenticate and establish session
   */
  async login(): Promise<void> {
    const loginUrl = `${this.baseUrl}/api/v2/auth/login`;

    logger.debug('[QBittorrent] Attempting login', {
      url: loginUrl,
      baseUrl: this.baseUrl,
      username: this.username,
      hasPassword: !!this.password,
      passwordLength: this.password?.length,
      sslVerifyDisabled: this.disableSSLVerify,
    });

    try {
      const response = await axios.post(
        loginUrl,
        new URLSearchParams({
          username: this.username,
          password: this.password,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': this.baseUrl,
            'Origin': this.baseUrl,
          },
          httpsAgent: this.httpsAgent,
          // Support nginx/Apache reverse proxy with HTTP Basic Auth
          auth: {
            username: this.username,
            password: this.password,
          },
        }
      );

      logger.debug('[QBittorrent] Login response received', {
        status: response.status,
        statusText: response.statusText,
        data: response.data,
        hasSetCookie: !!response.headers['set-cookie'],
        setCookieCount: response.headers['set-cookie']?.length || 0,
      });

      // Extract cookie from response
      const cookies = response.headers['set-cookie'];
      if (cookies && cookies.length > 0) {
        this.cookie = cookies[0].split(';')[0];
        logger.debug('[QBittorrent] Cookie extracted', {
          cookieName: this.cookie.split('=')[0],
          cookieLength: this.cookie.length,
        });
      }

      if (!this.cookie) {
        logger.error('[QBittorrent] No cookie received in response');
        throw new Error('Failed to authenticate with qBittorrent');
      }

      logger.info('Successfully authenticated');
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error('[QBittorrent] Login failed with axios error', {
          message: error.message,
          code: error.code,
          status: error.response?.status,
          statusText: error.response?.statusText,
          responseData: error.response?.data,
          requestUrl: error.config?.url,
          requestHeaders: error.config?.headers,
        });
      } else {
        logger.error('Login failed', { error: error instanceof Error ? error.message : String(error) });
      }
      throw new Error('Failed to authenticate with qBittorrent');
    }
  }

  /**
   * Add torrent (magnet link or file URL) - Enterprise Implementation
   */
  async addTorrent(url: string, options?: AddTorrentOptions, retried = false): Promise<string> {
    // Validate URL parameter
    if (!url || typeof url !== 'string' || url.trim() === '') {
      logger.error('Invalid download URL', { url });
      throw new Error('Invalid download URL: URL is required and must be a non-empty string');
    }

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
        logger.info('[QBittorrent] Detected magnet link');
        return await this.addMagnetLink(url, category, options);
      } else {
        logger.info('[QBittorrent] Detected .torrent file URL');
        return await this.addTorrentFile(url, category, options);
      }
    } catch (error) {
      // Try re-authenticating once if we get a 403
      if (!retried && axios.isAxiosError(error) && error.response?.status === 403) {
        logger.info('[QBittorrent] Session expired, re-authenticating...');
        await this.login();
        return this.addTorrent(url, options, true);
      }

      logger.error('Failed to add torrent', { error: error instanceof Error ? error.message : String(error) });
      throw new Error('Failed to add torrent to qBittorrent');
    }
  }

  /**
   * Add magnet link - hash is extractable from URI (deterministic)
   */
  protected async addMagnetLink(
    magnetUrl: string,
    category: string,
    options?: AddTorrentOptions
  ): Promise<string> {
    // Extract info_hash from magnet link (deterministic)
    const infoHash = this.extractHashFromMagnet(magnetUrl);

    if (!infoHash) {
      throw new Error('Invalid magnet link - could not extract info_hash');
    }

    logger.info(` Extracted info_hash from magnet: ${infoHash}`);

    // Check for duplicates
    try {
      const existing = await this.getTorrent(infoHash);
      logger.info(` Torrent ${infoHash} already exists (duplicate), returning existing hash`);
      return infoHash;
    } catch {
      // Torrent doesn't exist, continue with adding
    }

    // Upload via 'urls' parameter
    // Note: savepath is intentionally omitted — the category (managed by ensureCategory)
    // defines the save path. Omitting per-torrent savepath allows qBittorrent to use
    // Automatic Torrent Management, respecting the user's "incomplete downloads" temp folder.
    // sequentialDownload is also omitted — left to qBittorrent's own settings.
    // ratioLimit and seedingTimeLimit are set to -1 (unlimited) so qBittorrent's
    // global seeding rules don't remove the torrent prematurely.
    // RMAB manages torrent lifecycle via the cleanup-seeded-torrents processor.
    const form = new URLSearchParams({
      urls: magnetUrl,
      category,
      paused: options?.paused ? 'true' : 'false',
      ratioLimit: '-1',
      seedingTimeLimit: '-1',
    });

    if (options?.tags) {
      form.append('tags', options.tags.join(','));
    }

    logger.info('[QBittorrent] Uploading magnet link...');

    const response = await this.client.post('/torrents/add', form, {
      headers: {
        Cookie: this.cookie,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    if (response.data !== 'Ok.') {
      throw new Error(`qBittorrent rejected magnet link: ${response.data}`);
    }

    logger.info(` Successfully added magnet link: ${infoHash}`);
    return infoHash;
  }

  /**
   * Add .torrent file - download, parse, extract hash, upload content (deterministic)
   */
  protected async addTorrentFile(
    torrentUrl: string,
    category: string,
    options?: AddTorrentOptions
  ): Promise<string> {
    logger.info(` Downloading .torrent file from: ${torrentUrl}`);

    // Make initial request with maxRedirects: 0 to intercept redirects
    // Some Prowlarr indexers return HTTP URLs that redirect to magnet: links
    let torrentResponse;
    try {
      torrentResponse = await axios.get(torrentUrl, {
        responseType: 'arraybuffer',
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 300, // Only 2xx is success
        timeout: DOWNLOAD_CLIENT_TIMEOUT,
      });

      logger.info(` Got 2xx response, size=${torrentResponse.data.length} bytes`);

      // Check if response body contains a magnet link
      if (torrentResponse.data.length > 0) {
        const responseText = torrentResponse.data.toString();
        const magnetMatch = responseText.match(/^magnet:\?[^\s]+$/);
        if (magnetMatch) {
          logger.info(` Response body is a magnet link`);
          return await this.addMagnetLink(magnetMatch[0], category, options);
        }
      }

      // Got valid torrent data (or will be validated below)
    } catch (error) {
      if (!axios.isAxiosError(error) || !error.response) {
        // Not an axios error or no response - re-throw
        logger.error('Request failed', { error: error instanceof Error ? error.message : String(error) });
        throw error;
      }

      const status = error.response.status;

      // Handle 3xx redirects
      if (status >= 300 && status < 400) {
        const location = error.response.headers['location'];
        logger.info(` Got ${status} redirect to: ${location}`);

        // Check if redirect target is a magnet link
        if (location && location.startsWith('magnet:')) {
          logger.info(` Redirect target is magnet link`);
          return await this.addMagnetLink(location, category, options);
        }

        // Regular HTTP redirect - follow it manually
        if (location && (location.startsWith('http://') || location.startsWith('https://'))) {
          logger.info(` Following HTTP redirect...`);
          try {
            torrentResponse = await axios.get(location, {
              responseType: 'arraybuffer',
              timeout: DOWNLOAD_CLIENT_TIMEOUT,
              maxRedirects: 5,
            });
            logger.info(` After following redirect: size=${torrentResponse.data.length} bytes`);
          } catch (redirectError) {
            logger.error('Failed to follow redirect', { error: redirectError instanceof Error ? redirectError.message : String(redirectError) });
            throw new Error('Failed to download torrent file after redirect');
          }
        } else {
          throw new Error(`Invalid redirect location: ${location}`);
        }
      } else {
        // Non-redirect error (4xx, 5xx)
        logger.error(`HTTP error ${status}`, { error: error.message });
        throw new Error(`Failed to download torrent: HTTP ${status}`);
      }
    }

    const torrentBuffer = Buffer.from(torrentResponse.data);
    logger.info(` Processing torrent file: ${torrentBuffer.length} bytes`);

    // Parse .torrent file to extract info_hash (deterministic)
    let parsedTorrent: any;
    try {
      parsedTorrent = await parseTorrent(torrentBuffer);
    } catch (error) {
      logger.error('Failed to parse .torrent file', { error: error instanceof Error ? error.message : String(error) });
      throw new Error('Invalid .torrent file - failed to parse');
    }

    const infoHash = parsedTorrent.infoHash;

    if (!infoHash) {
      throw new Error('Failed to extract info_hash from .torrent file');
    }

    logger.info(` Extracted info_hash: ${infoHash}`);
    logger.info(` Torrent name: ${parsedTorrent.name || 'Unknown'}`);

    // Check for duplicates
    try {
      const existing = await this.getTorrent(infoHash);
      logger.info(` Torrent ${infoHash} already exists (duplicate), returning existing hash`);
      return infoHash;
    } catch {
      // Torrent doesn't exist, continue with adding
    }

    // Upload .torrent file content via multipart/form-data
    // Note: savepath is intentionally omitted — the category (managed by ensureCategory)
    // defines the save path. Omitting per-torrent savepath allows qBittorrent to use
    // Automatic Torrent Management, respecting the user's "incomplete downloads" temp folder.
    // sequentialDownload is also omitted — left to qBittorrent's own settings.
    // ratioLimit and seedingTimeLimit override qBittorrent's global seeding rules —
    // RMAB manages torrent lifecycle via the cleanup-seeded-torrents processor.
    const formData = new FormData();

    const filename = parsedTorrent.name ? `${parsedTorrent.name}.torrent` : 'torrent.torrent';
    formData.append('torrents', torrentBuffer, {
      filename,
      contentType: 'application/x-bittorrent',
    });
    formData.append('category', category);
    formData.append('paused', options?.paused ? 'true' : 'false');
    formData.append('ratioLimit', '-1');
    formData.append('seedingTimeLimit', '-1');

    if (options?.tags) {
      formData.append('tags', options.tags.join(','));
    }

    logger.info('[QBittorrent] Uploading .torrent file content...');

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

    logger.info(` Successfully added torrent: ${infoHash}`);
    return infoHash;
  }

  /**
   * Ensure category exists in qBittorrent with correct save path
   * Checks existing categories first, then creates or updates as needed
   * Applies reverse path mapping (local → remote) for remote seedbox scenarios
   */
  protected async ensureCategory(category: string): Promise<void> {
    if (!this.cookie) {
      await this.login();
    }

    // Apply reverse path mapping (local → remote) to get the path qBittorrent expects
    const remoteSavePath = PathMapper.reverseTransform(this.defaultSavePath, this.pathMappingConfig);

    try {
      // First, get all categories to check if it exists and what save path it has
      const categoriesResponse = await this.client.get('/torrents/categories', {
        headers: { Cookie: this.cookie },
      });

      const categories = categoriesResponse.data;
      const existingCategory = categories[category];

      if (!existingCategory) {
        // Category doesn't exist - create it
        logger.info(` Creating category "${category}" with save path: ${remoteSavePath}`);

        await this.client.post(
          '/torrents/createCategory',
          new URLSearchParams({
            category,
            savePath: remoteSavePath,
          }),
          {
            headers: {
              Cookie: this.cookie,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          }
        );

        logger.info(` Category "${category}" created successfully`);
      } else {
        // Category exists - check if save path needs updating
        const currentSavePath = existingCategory.savePath || existingCategory.save_path;

        if (currentSavePath !== remoteSavePath) {
          logger.info(` Updating category "${category}" save path from "${currentSavePath}" to "${remoteSavePath}"`);

          await this.client.post(
            '/torrents/editCategory',
            new URLSearchParams({
              category,
              savePath: remoteSavePath,
            }),
            {
              headers: {
                Cookie: this.cookie,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
            }
          );

          logger.info(` Category "${category}" save path updated successfully`);
        } else {
          logger.info(` Category "${category}" already has correct save path: ${remoteSavePath}`);
        }
      }
    } catch (error) {
      // If we can't ensure the category, log error but don't throw
      // Torrents can still be added with per-torrent savepath parameter
      if (axios.isAxiosError(error)) {
        logger.error(` Failed to ensure category "${category}":`, {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          requestedPath: remoteSavePath,
        });
      } else {
        logger.error('Failed to ensure category', { error: error instanceof Error ? error.message : String(error) });
      }
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

      // Find the torrent with the exact matching hash.
      // Some qBittorrent-compatible clients (e.g. RDTClient) ignore the hashes
      // filter and return all torrents, so we must verify the hash ourselves.
      const normalizedHash = hash.toLowerCase();
      const match = torrents.find(
        (t: TorrentInfo) => t.hash?.toLowerCase() === normalizedHash
      );

      if (!match) {
        throw new Error(`Torrent ${hash} not found`);
      }

      return match;
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
      logger.error('Failed to get torrents', { error: error instanceof Error ? error.message : String(error) });
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

      logger.info(`Paused torrent: ${hash}`);
    } catch (error) {
      logger.error('Failed to pause torrent', { error: error instanceof Error ? error.message : String(error) });
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

      logger.info(`Resumed torrent: ${hash}`);
    } catch (error) {
      logger.error('Failed to resume torrent', { error: error instanceof Error ? error.message : String(error) });
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

      logger.info(`Deleted torrent: ${hash}`);
    } catch (error) {
      logger.error('Failed to delete torrent', { error: error instanceof Error ? error.message : String(error) });
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
      logger.error('Failed to get torrent files', { error: error instanceof Error ? error.message : String(error) });
      throw new Error('Failed to get torrent files');
    }
  }

  /**
   * Get all configured categories from qBittorrent
   */
  async getCategories(): Promise<string[]> {
    if (!this.cookie) {
      await this.login();
    }

    try {
      const response = await this.client.get('/torrents/categories', {
        headers: { Cookie: this.cookie },
      });

      return Object.keys(response.data || {});
    } catch (error) {
      logger.error('Failed to get categories', { error: error instanceof Error ? error.message : String(error) });
      return [];
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

      logger.info(`Set category for torrent ${hash}: ${category}`);
    } catch (error) {
      logger.error('Failed to set category', { error: error instanceof Error ? error.message : String(error) });
      throw new Error('Failed to set torrent category');
    }
  }

  /**
   * Test connection to qBittorrent
   */
  async testConnection(): Promise<ConnectionTestResult> {
    try {
      await this.login();

      // Fetch version after successful login
      let version: string | undefined;
      try {
        const versionResponse = await this.client.get('/app/version', {
          headers: { Cookie: this.cookie },
        });
        const raw = versionResponse.data || '';
        version = typeof raw === 'string' ? raw.replace(/^v/i, '') : undefined;
      } catch {
        // Version fetch is non-critical - connection is still valid
        logger.debug('Could not fetch qBittorrent version');
      }

      return { success: true, version, message: `Connected to qBittorrent${version ? ` ${version}` : ''}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed';
      logger.error('Connection test failed', { error: message });
      return { success: false, message };
    }
  }

  /**
   * Static method to test connection with custom credentials (for setup wizard)
   */
  static async testConnectionWithCredentials(
    url: string,
    username: string,
    password: string,
    disableSSLVerify: boolean = false
  ): Promise<string> {
    const baseUrl = url.replace(/\/$/, '');
    const loginUrl = `${baseUrl}/api/v2/auth/login`;

    // Create HTTPS agent if SSL verification is disabled
    let httpsAgent: https.Agent | undefined;
    if (disableSSLVerify && baseUrl.startsWith('https')) {
      httpsAgent = new https.Agent({
        rejectUnauthorized: false,
      });
      logger.info('[QBittorrent] SSL certificate verification disabled for test connection');
    }

    logger.debug('[QBittorrent] Test connection attempt', {
      loginUrl,
      baseUrl,
      username,
      hasPassword: !!password,
      passwordLength: password?.length,
      sslVerifyDisabled: disableSSLVerify,
      hasHttpsAgent: !!httpsAgent,
    });

    try {
      const requestBody = new URLSearchParams({ username, password });
      const requestHeaders = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': baseUrl,
        'Origin': baseUrl,
      };

      logger.debug('[QBittorrent] Sending login request', {
        body: requestBody.toString(),
        headers: requestHeaders,
      });

      const response = await axios.post(
        loginUrl,
        requestBody,
        {
          headers: requestHeaders,
          httpsAgent,
          // Support nginx/Apache reverse proxy with HTTP Basic Auth
          auth: {
            username,
            password,
          },
        }
      );

      logger.debug('[QBittorrent] Login response received', {
        status: response.status,
        statusText: response.statusText,
        data: response.data,
        hasSetCookie: !!response.headers['set-cookie'],
        setCookieCount: response.headers['set-cookie']?.length || 0,
        allHeaders: Object.keys(response.headers),
      });

      // Get version to confirm connection
      const cookies = response.headers['set-cookie'];
      if (!cookies || cookies.length === 0) {
        logger.error('[QBittorrent] No cookies in response', {
          responseHeaders: response.headers,
        });
        throw new Error('Failed to authenticate - no session cookie received');
      }

      const cookie = cookies[0].split(';')[0];
      logger.debug('[QBittorrent] Cookie extracted', {
        cookieName: cookie.split('=')[0],
        cookieLength: cookie.length,
      });

      const versionResponse = await axios.get(`${baseUrl}/api/v2/app/version`, {
        headers: { Cookie: cookie },
        httpsAgent,
        // Support nginx/Apache reverse proxy with HTTP Basic Auth
        auth: {
          username,
          password,
        },
      });

      logger.info('[QBittorrent] Version check successful', {
        version: versionResponse.data,
      });

      const rawVersion = versionResponse.data || '';
      return typeof rawVersion === 'string' ? rawVersion.replace(/^v/i, '') || 'Connected' : 'Connected';
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error('[QBittorrent] Test connection failed with axios error', {
          message: error.message,
          code: error.code,
          status: error.response?.status,
          statusText: error.response?.statusText,
          responseData: error.response?.data,
          requestUrl: error.config?.url,
          requestHeaders: error.config?.headers,
          responseHeaders: error.response?.headers,
        });
      } else {
        logger.error('Connection test failed', { error: error instanceof Error ? error.message : String(error) });
      }

      // Enhanced error messages for common issues
      if (axios.isAxiosError(error)) {
        const code = error.code;
        const status = error.response?.status;
        const url = error.config?.url;

        // SSL/TLS certificate errors
        if (code === 'DEPTH_ZERO_SELF_SIGNED_CERT') {
          throw new Error(
            `SSL certificate verification failed: self-signed certificate detected. ` +
            `If you trust this server, enable "Disable SSL Verification" below.`
          );
        }
        if (code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
          throw new Error(
            `SSL certificate verification failed: unable to verify certificate chain. ` +
            `If you trust this server, enable "Disable SSL Verification" below.`
          );
        }
        if (code === 'CERT_HAS_EXPIRED') {
          throw new Error(
            `SSL certificate verification failed: certificate has expired. ` +
            `Update the certificate or enable "Disable SSL Verification" below.`
          );
        }
        if (code?.includes('CERT') || code?.includes('SSL') || code?.includes('TLS')) {
          throw new Error(
            `SSL certificate verification failed (${code}). ` +
            `If you trust this server, enable "Disable SSL Verification" below.`
          );
        }

        // Connection errors
        if (code === 'ECONNREFUSED') {
          throw new Error(
            `Connection refused. Check if qBittorrent is running and accessible at: ${baseUrl}`
          );
        }
        if (code === 'ETIMEDOUT' || code === 'ECONNABORTED') {
          throw new Error(
            `Connection timeout. Verify the URL is correct and the server is reachable: ${baseUrl}`
          );
        }
        if (code === 'ENOTFOUND') {
          throw new Error(
            `Host not found. Verify the domain/IP address is correct: ${baseUrl}`
          );
        }

        // HTTP status errors
        if (status === 401 || status === 403) {
          throw new Error(
            `Authentication failed (HTTP ${status}). Check your username and password.`
          );
        }
        if (status === 404) {
          throw new Error(
            `qBittorrent Web UI not found (HTTP 404). Verify the URL path is correct: ${baseUrl}`
          );
        }
        if (status && status >= 500) {
          throw new Error(
            `qBittorrent server error (HTTP ${status}). Check server logs.`
          );
        }

        // Generic axios error with more context
        throw new Error(
          `Failed to connect to qBittorrent at ${baseUrl}: ${error.message}`
        );
      }

      // Non-axios error
      throw new Error(
        error instanceof Error ? error.message : 'Failed to connect to qBittorrent'
      );
    }
  }

  // =========================================================================
  // IDownloadClient Implementation
  // =========================================================================

  /**
   * Add a download via the unified interface.
   * Delegates to addTorrent with sensible defaults for audiobook downloads.
   */
  async addDownload(url: string, options?: AddDownloadOptions): Promise<string> {
    return this.addTorrent(url, {
      category: options?.category,
      paused: options?.paused,
      tags: ['audiobook'],
    });
  }

  /**
   * Get download status via the unified interface.
   * Includes retry logic to handle the race condition where a torrent
   * isn't immediately available after being added.
   */
  async getDownload(id: string): Promise<DownloadInfo | null> {
    const maxRetries = 3;
    const initialDelayMs = 500;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const torrent = await this.getTorrent(id);
        return this.mapTorrentToDownloadInfo(torrent);
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        const isNotFound = message.includes('not found');

        // If not a "not found" error, don't retry
        if (!isNotFound) {
          throw error;
        }

        // If this is the last attempt, return null
        if (attempt === maxRetries) {
          return null;
        }

        // Exponential backoff: 500ms, 1000ms, 2000ms
        const delayMs = initialDelayMs * Math.pow(2, attempt);
        logger.warn(`Torrent ${id} not found, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    return null;
  }

  /** Pause a download via the unified interface */
  async pauseDownload(id: string): Promise<void> {
    return this.pauseTorrent(id);
  }

  /** Resume a download via the unified interface */
  async resumeDownload(id: string): Promise<void> {
    return this.resumeTorrent(id);
  }

  /** Delete a download via the unified interface */
  async deleteDownload(id: string, deleteFiles: boolean = false): Promise<void> {
    return this.deleteTorrent(id, deleteFiles);
  }

  /**
   * Post-download cleanup via the unified interface.
   * No-op for qBittorrent — torrents continue seeding until the
   * cleanup-seeded-torrents job removes them after meeting seeding requirements.
   */
  async postProcess(_id: string): Promise<void> {
    // No-op: torrents are managed by the seeding cleanup scheduler
  }

  /**
   * Map a TorrentInfo object to the unified DownloadInfo format.
   */
  protected mapTorrentToDownloadInfo(torrent: TorrentInfo): DownloadInfo {
    const status = this.mapStateToDownloadStatus(torrent.state);

    // content_path is the canonical path from qBittorrent — always use it directly.
    // It correctly handles all torrent structures (multi-file folders, single files,
    // single files in wrapper folders, name mismatches).
    // For TempPathEnabled race detection, we expose save_path so the monitor can
    // compare and wait for files to relocate before triggering file organization.
    const downloadPath = torrent.content_path || path.join(torrent.save_path, torrent.name);

    return {
      id: torrent.hash,
      name: torrent.name,
      size: torrent.size,
      bytesDownloaded: torrent.downloaded,
      progress: torrent.progress,
      status,
      downloadSpeed: torrent.dlspeed,
      eta: torrent.eta,
      category: torrent.category,
      downloadPath,
      savePath: torrent.save_path,
      completedAt: torrent.completion_on > 0 ? new Date(torrent.completion_on * 1000) : undefined,
      seedingTime: torrent.seeding_time,
      ratio: torrent.ratio,
    };
  }

  /**
   * Map qBittorrent torrent state to unified DownloadStatus.
   */
  private mapStateToDownloadStatus(state: TorrentState): DownloadStatus {
    const stateMap: Record<TorrentState, DownloadStatus> = {
      downloading: 'downloading',
      uploading: 'seeding',
      stalledDL: 'downloading',
      stalledUP: 'seeding',
      pausedDL: 'paused',
      // pausedUP = download finished, paused on upload side (e.g. ratio met)
      pausedUP: 'seeding',
      queuedDL: 'queued',
      queuedUP: 'seeding',
      checkingDL: 'checking',
      checkingUP: 'checking',
      error: 'failed',
      missingFiles: 'failed',
      allocating: 'downloading',
      // Forced states (user clicked "Force Resume" in qBittorrent UI)
      forcedDL: 'downloading',
      forcedUP: 'seeding',
      // Metadata fetching states
      metaDL: 'downloading',
      forcedMetaDL: 'downloading',
      // qBittorrent v5.0+ renamed paused → stopped
      stoppedDL: 'paused',
      // stoppedUP = download finished, stopped on upload side (qBittorrent v5.0+)
      stoppedUP: 'seeding',
      // Other states
      checkingResumeData: 'checking',
      moving: 'downloading',
    };

    return stateMap[state] || 'downloading';
  }

  // =========================================================================
  // Legacy Methods (used internally and by direct callers)
  // =========================================================================

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
      // pausedUP = download finished, paused on upload side (e.g. ratio met)
      pausedUP: 'completed',
      queuedDL: 'queued',
      queuedUP: 'completed',
      checkingDL: 'checking',
      checkingUP: 'completed',
      error: 'failed',
      missingFiles: 'failed',
      allocating: 'downloading',
      // Forced states (user clicked "Force Resume" in qBittorrent UI)
      forcedDL: 'downloading',
      forcedUP: 'completed',
      // Metadata fetching states
      metaDL: 'downloading',
      forcedMetaDL: 'downloading',
      // qBittorrent v5.0+ renamed paused → stopped
      stoppedDL: 'paused',
      // stoppedUP = download finished, stopped on upload side (qBittorrent v5.0+)
      stoppedUP: 'completed',
      // Other states
      checkingResumeData: 'checking',
      moving: 'downloading',
    };

    return stateMap[state] || 'unknown';
  }

  /**
   * Extract info_hash from magnet link
   */
  protected extractHashFromMagnet(magnetUrl: string): string | null {
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

/**
 * Invalidate the qBittorrent service singleton
 * Call this after updating download_dir or qBittorrent connection settings
 * Forces service to reload configuration from database on next use
 */
export function invalidateQBittorrentService(): void {
  logger.info('[QBittorrent] Invalidating service singleton - will reload config on next use');
  qbittorrentService = null;
  configLoaded = false;
}

export async function getQBittorrentService(): Promise<QBittorrentService> {
  // Always recreate if config hasn't been loaded successfully
  if (!qbittorrentService || !configLoaded) {
    try {
      // Get configuration from download client manager (uses new multi-client config format)
      const { getConfigService } = await import('@/lib/services/config.service');
      const { getDownloadClientManager } = await import('@/lib/services/download-client-manager.service');
      const configService = await getConfigService();
      const manager = getDownloadClientManager(configService);

      logger.info('[QBittorrent] Loading configuration from download client manager...');
      const clientConfig = await manager.getClientForProtocol('torrent');

      if (!clientConfig) {
        throw new Error('qBittorrent is not configured. Please configure a qBittorrent client in the admin settings.');
      }

      if (clientConfig.type !== 'qbittorrent') {
        throw new Error(`Expected qBittorrent client but found ${clientConfig.type}`);
      }

      logger.info('[QBittorrent] Config loaded:', {
        name: clientConfig.name,
        hasUrl: !!clientConfig.url,
        hasUsername: !!clientConfig.username,
        hasPassword: !!clientConfig.password,
        disableSSLVerify: clientConfig.disableSSLVerify,
        pathMappingEnabled: clientConfig.remotePathMappingEnabled,
      });

      // Validate required fields (only URL is required - username/password optional for whitelist users)
      if (!clientConfig.url) {
        throw new Error('qBittorrent is not fully configured. Please check your configuration in admin settings.');
      }

      // Get download_dir from main config, applying customPath if configured
      const baseDir = await configService.get('download_dir') || '/downloads';
      const downloadDir = clientConfig.customPath
        ? require('path').join(baseDir, clientConfig.customPath)
        : baseDir;

      // Path mapping configuration
      const pathMappingConfig: PathMappingConfig = {
        enabled: clientConfig.remotePathMappingEnabled,
        remotePath: clientConfig.remotePath || '',
        localPath: clientConfig.localPath || '',
      };

      logger.info('[QBittorrent] Creating service instance...');
      qbittorrentService = new QBittorrentService(
        clientConfig.url,
        clientConfig.username || '',
        clientConfig.password || '',
        downloadDir,
        clientConfig.category || 'readmeabook',
        clientConfig.disableSSLVerify,
        pathMappingConfig
      );

      // Test connection
      logger.info('[QBittorrent] Testing connection...');
      const connectionResult = await qbittorrentService.testConnection();
      if (!connectionResult.success) {
        logger.warn('[QBittorrent] Connection test failed', { message: connectionResult.message });
        throw new Error(connectionResult.message || 'qBittorrent connection test failed. Please check your configuration in admin settings.');
      } else {
        logger.info('[QBittorrent] Connection test successful');
        configLoaded = true; // Mark as successfully loaded
      }
    } catch (error) {
      logger.error('Failed to initialize service', { error: error instanceof Error ? error.message : String(error) });
      qbittorrentService = null; // Reset service on error
      configLoaded = false;
      throw error;
    }
  }

  return qbittorrentService;
}
