/**
 * Component: qBittorrent Integration Service
 * Documentation: documentation/phase3/qbittorrent.md
 */

import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { RMAB_USER_AGENT } from '../utils/user-agent';
import https from 'https';
import path from 'path';
import { DOWNLOAD_CLIENT_TIMEOUT } from '../constants/download-timeouts';
import * as parseTorrentModule from 'parse-torrent';
import FormData from 'form-data';
import { RMABLogger } from '../utils/logger';
import { DownloadSourceTimeoutError, fetchDownloadSource, type SourceAuth } from './download-source';
import { urlForLog } from '../utils/prowlarr-url';
import { PathMapper, PathMappingConfig } from '../utils/path-mapper';
import { qbittorrentProbeList } from './torrent-probe';
import { acceptedAddId, candidateIds, decodedMagnet, findTorrent, lookupTorrent, magnetHashes, normalizeTorrentId, SharedRequest, TorrentHashes, TorrentIdMap, torrentFileHashes, TorrentListUnavailableError, validTorrentId } from './qbittorrent-ids';
import {
  IDownloadClient,
  DownloadClientType,
  ProtocolType,
  DownloadInfo,
  DownloadStatus,
  AddDownloadOptions,
  AddDownloadResult,
  DownloadProbe,
  ConnectionTestResult,
  DownloadSourceError,
  UnusableDownloadSourceError,
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
  sourceAuth?: SourceAuth;
}

export interface TorrentInfo {
  hash: string; // qBittorrent's ID: v1 info hash, or truncated v2 for hybrid/v2 (libtorrent 2)
  infohash_v1?: string; // 4.4+; '' for v2-only torrents
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
  private authOptional: boolean;
  private defaultSavePath: string;
  private defaultCategory: string;
  private disableSSLVerify: boolean;
  private httpsAgent?: https.Agent;
  private pathMappingConfig: PathMappingConfig;
  private knownIds = new TorrentIdMap(); // stored ID → the client's current ID
  private fullList = new SharedRequest<AxiosResponse>(); // one unfiltered /torrents/info at a time

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
    this.authOptional = !username && !password;
    this.defaultSavePath = defaultSavePath;
    this.defaultCategory = defaultCategory;
    this.disableSSLVerify = disableSSLVerify;
    this.pathMappingConfig = pathMappingConfig || { enabled: false, remotePath: '', localPath: '' };

    if (this.authOptional) {
      logger.info('[QBittorrent] No credentials configured — running in auth-optional mode (suitable for IP-whitelisted qBittorrent or auth-less proxies like Decypharr)');
    }

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
      headers: { 'User-Agent': RMAB_USER_AGENT },
      // Support nginx/Apache reverse proxy with HTTP Basic Auth
      auth: {
        username: this.username,
        password: this.password,
      },
    });
  }

  /**
   * Build request headers including the session cookie when one exists.
   * In auth-optional mode no cookie is set and the Cookie header is omitted.
   */
  private authHeaders(): Record<string, string> {
    return this.cookie ? { Cookie: this.cookie } : {};
  }

  /**
   * Authenticate and establish session.
   * In auth-optional mode (no username/password configured) this is a no-op.
   */
  async login(): Promise<void> {
    if (this.authOptional) {
      logger.debug('[QBittorrent] Skipping login — auth-optional mode');
      return;
    }

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
  async addTorrent(url: string, options?: AddTorrentOptions, retried = false): Promise<AddDownloadResult> {
    // Validate URL parameter
    if (!url || typeof url !== 'string' || url.trim() === '') {
      logger.error('Invalid download URL', { url });
      throw new Error('Invalid download URL: URL is required and must be a non-empty string');
    }

    // Ensure we're authenticated
    if (!this.cookie && !this.authOptional) {
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
      // Preserve source/indexer failures so the processor can try another release
      // (unusable source) or Bull can retry (fetch deadline).
      if (
        error instanceof DownloadSourceError ||
        error instanceof UnusableDownloadSourceError ||
        error instanceof DownloadSourceTimeoutError ||
        error instanceof TorrentListUnavailableError // a client error: the request retries, no other release
      ) {
        throw error;
      }

      // Try re-authenticating once if we get a 403 — only meaningful when credentials are configured.
      // In auth-optional mode a 403 means the server actually wants auth (e.g. IP no longer whitelisted),
      // so retrying login is pointless and would mask the real error.
      if (!retried && !this.authOptional && axios.isAxiosError(error) && error.response?.status === 403) {
        logger.info('[QBittorrent] Session expired, re-authenticating...');
        await this.login();
        return this.addTorrent(url, options, true);
      }

      logger.error('Failed to add torrent', { error: error instanceof Error ? error.message : String(error) });
      throw new Error('Failed to add torrent to qBittorrent');
    }
  }

  /** POST /torrents/add. 5.2+ answers 409 Conflict when every add failed (duplicates too). */
  private async postAdd(body: unknown, config: Record<string, unknown>): Promise<{ data: unknown; conflict: boolean }> {
    try {
      return { data: (await this.client.post('/torrents/add', body, config)).data, conflict: false };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 409) return { data: error.response.data, conflict: true };
      throw error;
    }
  }

  /**
   * The client's ID for this torrent, or null when it is absent: every candidate ID filtered first
   * (lookup errors count as "no"), then with `scan` one unfiltered lookup matching `hash` or
   * `infohash_v1`, which finds a hybrid listed under its v2 ID. A non-hex ID keeps the candidate's.
   */
  private async presentId(hashes: TorrentHashes, scan: boolean): Promise<string | null> {
    const ids = candidateIds(hashes);
    for (const id of ids) {
      const hit = await this.getTorrent(id, false).catch(() => null);
      if (hit) return validTorrentId(hit.hash) ?? id;
    }
    const hit = scan ? await findTorrent([], ids, (hashes) => this.strictList(hashes), true) : null;
    return hit ? validTorrentId(hit.hash) ?? ids[0] : null;
  }

  /**
   * A rejected add (qBittorrent rejects duplicates: "Fails." up to 5.1, 409 from 5.2): check once
   * more. Present now = it was already in the client (taken over); otherwise the rejection stands.
   */
  private async recheckRejectedAdd(hashes: TorrentHashes, rejection: string): Promise<AddDownloadResult> {
    const id = await this.presentId(hashes, true).catch(() => null); // a failed lookup keeps the rejection
    if (!id) throw new Error(rejection);
    logger.warn(`qBittorrent rejected the add of ${id} but already has it: recorded as already in the client`);
    return { id, alreadyInClient: true, infoHash: hashes.v1 };
  }

  /** A rejected /torrents/add body as log text: strings as is, JSON receipts serialized (capped). */
  private describeAddResponse(data: unknown): string {
    if (typeof data === 'string') return data;
    return (JSON.stringify(data) ?? String(data)).slice(0, 500);
  }

  /**
   * Shared by magnet and .torrent adds: the pre-add check, the add, and the ID to record.
   * The pre-add check ends with the full list: the torrent may be listed under another ID (a hybrid
   * under its v2 ID; a btih or truncated btmh equal to another torrent's v1), and qBittorrent up to 5.1
   * can answer "Ok." to that duplicate. If that list can't be read, nothing is added (fail closed).
   */
  private async addOnce(
    hashes: TorrentHashes,
    kind: string,
    post: () => Promise<{ data: unknown; conflict: boolean }>
  ): Promise<AddDownloadResult> {
    // Already in the client: taken over, never added (or later removed) by RMAB
    const present = await this.presentId(hashes, true).catch((error: unknown) => {
      if (axios.isAxiosError(error) && error.response?.status === 403) throw error; // re-login, then retry
      logger.error(`Nothing added: couldn't read the torrent list to check for an existing copy (${error instanceof Error ? error.message : String(error)})`);
      throw new TorrentListUnavailableError();
    });
    if (present) {
      logger.info(` Torrent ${present} is already in qBittorrent (not added by RMAB)`);
      return { id: present, alreadyInClient: true, infoHash: hashes.v1 };
    }

    logger.info(`[QBittorrent] Uploading ${kind}...`);
    const { data, conflict } = await post();
    const accepted = conflict ? null : acceptedAddId(data, hashes);
    if (!accepted) {
      const detail = `${this.describeAddResponse(data)}${conflict ? ' (HTTP 409)' : ''}`;
      return this.recheckRejectedAdd(hashes, `qBittorrent rejected ${kind}: ${detail}`);
    }

    // "Ok." names no ID: libtorrent 2 lists a hybrid by its v2 form, 1.2 by v1 (also the fallback)
    const id = data === 'Ok.' && hashes.v2 ? (await this.presentId(hashes, false)) ?? accepted : accepted;
    logger.info(` Successfully added ${kind}: ${id}`);
    return { id, alreadyInClient: false, infoHash: hashes.v1 };
  }

  /**
   * Add magnet link - hashes are extractable from URI (deterministic)
   */
  protected async addMagnetLink(
    magnetUrl: string,
    category: string,
    options?: AddTorrentOptions
  ): Promise<AddDownloadResult> {
    // Extract the btih (v1, hex or base32) and btmh (v2) hashes from the magnet link
    const magnet = decodedMagnet(magnetUrl); // the string parsed is the string sent
    const hashes = magnetHashes(magnet);

    if (!hashes) {
      throw new Error('Invalid magnet link - could not extract info_hash');
    }

    logger.info(` Extracted info_hash from magnet: ${hashes.v1 ?? ''}${hashes.v2 ? ` (v2 ${hashes.v2})` : ''}`);

    // Upload via 'urls' parameter
    // Note: savepath is intentionally omitted — the category (managed by ensureCategory)
    // defines the save path. Omitting per-torrent savepath allows qBittorrent to use
    // Automatic Torrent Management, respecting the user's "incomplete downloads" temp folder.
    // sequentialDownload is also omitted — left to qBittorrent's own settings.
    // ratioLimit and seedingTimeLimit are set to -1 (unlimited) so qBittorrent's
    // global seeding rules don't remove the torrent prematurely.
    // RMAB manages torrent lifecycle via the cleanup-seeded-torrents processor.
    const form = new URLSearchParams({
      urls: magnet,
      category,
      paused: options?.paused ? 'true' : 'false',
      ratioLimit: '-1',
      seedingTimeLimit: '-1',
    });

    if (options?.tags) {
      form.append('tags', options.tags.join(','));
    }

    return this.addOnce(hashes, 'magnet link', () => this.postAdd(form, {
      headers: {
        ...this.authHeaders(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }));
  }

  /**
   * Add .torrent file - download, parse, extract hashes, upload content (deterministic)
   */
  protected async addTorrentFile(
    torrentUrl: string,
    category: string,
    options?: AddTorrentOptions
  ): Promise<AddDownloadResult> {
    logger.info(` Downloading .torrent file from: ${urlForLog(torrentUrl)}`);

    // Shared fetcher: follows every redirect hop (relative or absolute), resolves a
    // magnet at any hop, and scopes the Prowlarr key to Prowlarr download hops.
    const source = await fetchDownloadSource(torrentUrl, {
      sourceAuth: options?.sourceAuth,
      allowMagnet: true,
      timeoutMs: DOWNLOAD_CLIENT_TIMEOUT,
    });
    if (source.kind === 'magnet') {
      logger.info(' Download source resolved to a magnet link');
      return await this.addMagnetLink(source.magnetUrl, category, options);
    }

    const torrentBuffer = source.data;
    logger.info(` Processing torrent file: ${torrentBuffer.length} bytes`);

    // Parse .torrent file to extract info_hash (deterministic)
    let parsedTorrent: any;
    try {
      parsedTorrent = await parseTorrent(torrentBuffer);
    } catch (error) {
      logger.error('Failed to parse .torrent file', { error: error instanceof Error ? error.message : String(error) });
      throw new Error('Invalid .torrent file - failed to parse');
    }

    // v1 = SHA-1 of the info dict; v2 = its SHA-256 for hybrid (meta version 2) torrents
    const hashes = torrentFileHashes(parsedTorrent);

    if (!hashes) {
      throw new Error('Failed to extract info_hash from .torrent file');
    }

    logger.info(` Extracted info_hash: ${hashes.v1}${hashes.v2 ? ` (hybrid, v2 ${hashes.v2})` : ''}`);
    logger.info(` Torrent name: ${parsedTorrent.name || 'Unknown'}`);

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

    return this.addOnce(hashes, '.torrent file', () => this.postAdd(formData, {
      headers: {
        ...this.authHeaders(),
        ...formData.getHeaders(),
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    }));
  }

  /**
   * Ensure category exists in qBittorrent with correct save path
   * Checks existing categories first, then creates or updates as needed
   * Applies reverse path mapping (local → remote) for remote seedbox scenarios
   */
  protected async ensureCategory(category: string): Promise<void> {
    if (!this.cookie && !this.authOptional) {
      await this.login();
    }

    // Apply reverse path mapping (local → remote) to get the path qBittorrent expects
    const remoteSavePath = PathMapper.reverseTransform(this.defaultSavePath, this.pathMappingConfig);

    try {
      // First, get all categories to check if it exists and what save path it has
      const categoriesResponse = await this.client.get('/torrents/categories', {
        headers: this.authHeaders(),
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
              ...this.authHeaders(),
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
                ...this.authHeaders(),
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
   * Get torrent status and progress. Matches the reported `hash` or `infohash_v1`: a hybrid can be
   * stored by its v1 hash, and some qBittorrent-compatible clients (e.g. RDTClient) ignore the
   * hashes filter and return all torrents. With `scan`, an empty answer gets one unfiltered lookup.
   */
  async getTorrent(hash: string, scan = true): Promise<TorrentInfo> {
    if (!this.cookie && !this.authOptional) {
      await this.login();
    }

    // Don't log errors here - the caller handles them (e.g., duplicate checking)
    const match = await lookupTorrent(hash, this.knownIds, async (hashes) => {
      try {
        const torrents = (await this.queryTorrents(hashes))?.data;
        if (!torrents) return [];
        if (!Array.isArray(torrents)) throw new Error(`qBittorrent answered the lookup of ${hash} with ${typeof torrents}, not a torrent list`);
        return torrents as TorrentInfo[];
      } catch (error) {
        if (hashes === undefined) return []; // the unfiltered lookup is best effort here
        throw error;
      }
    }, scan);
    if (!match) {
      throw new Error(`Torrent ${hash} not found`);
    }
    return match;
  }

  /** GET /torrents/info by `hashes`, or the whole list (one request shared by concurrent callers) */
  private queryTorrents(hashes?: string): Promise<AxiosResponse> {
    const get = () => this.client.get('/torrents/info', { headers: this.authHeaders(), params: hashes === undefined ? {} : { hashes } });
    return hashes === undefined ? this.fullList.run(get) : get();
  }

  /** /torrents/info as a list; anything but HTTP 200 and a JSON list throws */
  private async strictList(hashes?: string): Promise<TorrentInfo[]> {
    const response = await this.queryTorrents(hashes);
    return qbittorrentProbeList(response.status, response.data, hashes ?? 'all torrents') as unknown as TorrentInfo[];
  }

  /** The client's ID for an action: learned by the lookup every caller makes first, else looked up; never a list or `all` */
  private async actionId(hash: string): Promise<string> {
    const stored = normalizeTorrentId(hash);
    if (stored.includes('|') || stored.toLowerCase() === 'all') throw new Error(`Invalid torrent ID: ${hash}`);
    return this.knownIds.get(stored) ?? validTorrentId((await this.getTorrent(stored).catch(() => null))?.hash) ?? stored;
  }

  /**
   * Get all torrents (optionally filtered by category)
   */
  async getTorrents(category?: string): Promise<TorrentInfo[]> {
    if (!this.cookie && !this.authOptional) {
      await this.login();
    }

    try {
      const params: Record<string, string> = {};
      if (category) {
        params.category = category;
      }

      const response = await this.client.get('/torrents/info', {
        headers: this.authHeaders(),
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
    if (!this.cookie && !this.authOptional) {
      await this.login();
    }

    try {
      await this.client.post(
        '/torrents/pause',
        new URLSearchParams({ hashes: await this.actionId(hash) }),
        {
          headers: {
            ...this.authHeaders(),
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
    if (!this.cookie && !this.authOptional) {
      await this.login();
    }

    try {
      await this.client.post(
        '/torrents/resume',
        new URLSearchParams({ hashes: await this.actionId(hash) }),
        {
          headers: {
            ...this.authHeaders(),
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
    if (!this.cookie && !this.authOptional) {
      await this.login();
    }

    try {
      await this.client.post(
        '/torrents/delete',
        new URLSearchParams({
          hashes: await this.actionId(hash),
          deleteFiles: deleteFiles.toString(),
        }),
        {
          headers: {
            ...this.authHeaders(),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      this.knownIds.delete(normalizeTorrentId(hash));
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
    if (!this.cookie && !this.authOptional) {
      await this.login();
    }

    try {
      const response = await this.client.get('/torrents/files', {
        headers: this.authHeaders(),
        params: { hash: await this.actionId(hash) },
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
    if (!this.cookie && !this.authOptional) {
      await this.login();
    }

    try {
      const response = await this.client.get('/torrents/categories', {
        headers: this.authHeaders(),
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
    if (!this.cookie && !this.authOptional) {
      await this.login();
    }

    try {
      await this.client.post(
        '/torrents/setCategory',
        new URLSearchParams({
          hashes: await this.actionId(hash),
          category,
        }),
        {
          headers: {
            ...this.authHeaders(),
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
   * Test connection to qBittorrent.
   * In auth-optional mode the /app/version probe IS the connectivity check, so it must succeed.
   * In credentialed mode login() is the connectivity check and version is best-effort.
   */
  async testConnection(): Promise<ConnectionTestResult> {
    try {
      await this.login(); // no-op when authOptional; throws on real auth failure

      try {
        const versionResponse = await this.client.get('/app/version', {
          headers: this.authHeaders(),
        });
        const raw = versionResponse.data || '';
        const version = typeof raw === 'string' ? raw.replace(/^v/i, '') : undefined;
        return { success: true, version, message: `Connected to qBittorrent${version ? ` ${version}` : ''}` };
      } catch (versionError) {
        if (this.authOptional) {
          // No login happened — version probe was our only connectivity signal.
          const status = axios.isAxiosError(versionError) ? versionError.response?.status : undefined;
          const baseMessage = versionError instanceof Error ? versionError.message : 'Connection failed';
          const message = status === 401 || status === 403
            ? `qBittorrent requires authentication (HTTP ${status}). Provide username/password or whitelist this app's IP in qBittorrent.`
            : `Failed to reach qBittorrent: ${baseMessage}`;
          logger.error('[QBittorrent] Auth-optional connection probe failed', { status, message: baseMessage });
          return { success: false, message };
        }
        // Credentialed path: login already succeeded, version is nice-to-have.
        logger.debug('Could not fetch qBittorrent version');
        return { success: true, message: 'Connected to qBittorrent' };
      }
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
    const authOptional = !username && !password;

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
      authOptional,
    });

    try {
      if (authOptional) {
        // No credentials provided — skip /auth/login and probe /app/version directly.
        // Works for IP-whitelisted qBittorrent and auth-less qBit-compatible proxies (e.g. Decypharr).
        logger.info('[QBittorrent] No credentials provided, probing /app/version directly');
        const versionResponse = await axios.get(`${baseUrl}/api/v2/app/version`, {
          httpsAgent,
          timeout: DOWNLOAD_CLIENT_TIMEOUT,
        });
        logger.info('[QBittorrent] Auth-optional version check successful', {
          version: versionResponse.data,
        });
        const rawVersion = versionResponse.data || '';
        return typeof rawVersion === 'string' ? rawVersion.replace(/^v/i, '') || 'Connected' : 'Connected';
      }

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
          if (authOptional) {
            throw new Error(
              `qBittorrent requires authentication (HTTP ${status}). Provide username/password, or whitelist this app's IP in qBittorrent's Web UI settings.`
            );
          }
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
  async addDownload(url: string, options?: AddDownloadOptions): Promise<AddDownloadResult> {
    return this.addTorrent(url, {
      category: options?.category,
      paused: options?.paused,
      tags: ['audiobook'],
      sourceAuth: options?.sourceAuth,
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
        // One unfiltered lookup per call at most (first attempt); the retries stay filtered
        const torrent = await this.getTorrent(id, attempt === 0);
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

  /**
   * Strict probe for the seeding cleanup: no not-found retries (one lookup by ID, plus one unfiltered
   * lookup when that answer is empty, for a hybrid stored by its v1 hash); a 403 re-logs in once
   */
  async probeDownload(id: string, retried = false): Promise<DownloadProbe> {
    if (!this.cookie && !this.authOptional) {
      await this.login();
    }
    try {
      const torrent = await lookupTorrent(id, this.knownIds, (hashes) => this.strictList(hashes), true);
      return torrent ? { found: true, info: this.mapTorrentToDownloadInfo(torrent) } : { found: false };
    } catch (error) {
      if (!retried && !this.authOptional && axios.isAxiosError(error) && error.response?.status === 403) {
        await this.login();
        return this.probeDownload(id, true);
      }
      throw error;
    }
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
      addedAt: torrent.added_on > 0 ? new Date(torrent.added_on * 1000) : undefined,
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
