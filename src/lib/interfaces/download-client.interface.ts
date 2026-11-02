/**
 * Component: Download Client Interface
 * Documentation: documentation/phase3/download-clients.md
 *
 * Defines the contract all download clients must implement.
 * Enables protocol-agnostic download management across torrent and usenet clients.
 */

import type { SourceAuth } from '@/lib/integrations/download-source';

// =========================================================================
// TYPE DEFINITIONS
// =========================================================================

/** Supported download client types — single source of truth */
export const SUPPORTED_CLIENT_TYPES = ['qbittorrent', 'sabnzbd', 'nzbget', 'transmission', 'deluge'] as const;

/** Identifies the specific download client software */
export type DownloadClientType = (typeof SUPPORTED_CLIENT_TYPES)[number];

/** Human-readable display names for each client type */
export const CLIENT_DISPLAY_NAMES: Record<DownloadClientType, string> = {
  qbittorrent: 'qBittorrent',
  sabnzbd: 'SABnzbd',
  nzbget: 'NZBGet',
  transmission: 'Transmission',
  deluge: 'Deluge',
};

/** Get display name for a client type, falling back to the raw type */
export function getClientDisplayName(type: string): string {
  return CLIENT_DISPLAY_NAMES[type as DownloadClientType] || type;
}

/** The download protocol a client operates on */
export type ProtocolType = 'torrent' | 'usenet';

/** Maps each client type to its download protocol */
export const CLIENT_PROTOCOL_MAP: Record<DownloadClientType, ProtocolType> = {
  qbittorrent: 'torrent',
  sabnzbd: 'usenet',
  nzbget: 'usenet',
  transmission: 'torrent',
  deluge: 'torrent',
};

/** Unified download status across all clients */
export type DownloadStatus =
  | 'downloading'
  | 'completed'
  | 'seeding'
  | 'paused'
  | 'queued'
  | 'failed'
  | 'processing'
  | 'checking';

// =========================================================================
// DATA INTERFACES
// =========================================================================

/**
 * Unified download information returned by all clients.
 * Normalizes torrent and NZB data into a single shape.
 */
export interface DownloadInfo {
  /** Client-assigned identifier (torrent hash or NZB ID) */
  id: string;
  /** Display name of the download */
  name: string;
  /** Total size in bytes */
  size: number;
  /** Bytes downloaded so far */
  bytesDownloaded: number;
  /** Download progress from 0.0 to 1.0 */
  progress: number;
  /** Normalized download status */
  status: DownloadStatus;
  /** Current download speed in bytes/sec */
  downloadSpeed: number;
  /** Estimated time remaining in seconds */
  eta: number;
  /** Category/label assigned to this download */
  category: string;
  /** Filesystem path where download is stored (available after completion) */
  downloadPath?: string;
  /** Configured save directory (torrent clients only, used for path readiness detection) */
  savePath?: string;
  /** When the download completed */
  completedAt?: Date;
  /** Error message if download failed */
  errorMessage?: string;
  /** Time spent seeding in seconds (torrent clients only) */
  seedingTime?: number;
  /** Upload/download ratio (torrent clients only) */
  ratio?: number;
  /** When the client added it (torrent clients; unset when the client reports none or 0) */
  addedAt?: Date;
}

/** Result of addDownload */
export interface AddDownloadResult {
  /** Client-assigned identifier (torrent hash or NZB ID) */
  id: string;
  /**
   * True when the torrent was already in the client, so RMAB did not add it (taken over).
   * RMAB never removes such a torrent or changes it. SABnzbd: true when it reuses a job it
   * already holds (a duplicate NZB, or a retried add); otherwise false.
   */
  alreadyInClient: boolean;
  /** BitTorrent v1 info hash, when the client knows it (may differ from `id` for hybrid torrents) */
  infoHash?: string;
  /** SABnzbd: the job it already held waits paused in its queue */
  paused?: boolean;
}

/**
 * Answer of the strict probe (seeding cleanup). `found: false` only on a well-formed
 * answer without the torrent; anything unclear throws.
 */
export type DownloadProbe = { found: true; info: DownloadInfo } | { found: false };

/** Options for adding a new download */
export interface AddDownloadOptions {
  /** Category/label to assign */
  category?: string;
  /** Priority level (interpretation varies by client) */
  priority?: string;
  /** Whether to add in paused state */
  paused?: boolean;
  /** Prowlarr credentials; the key is sent only to Prowlarr proxy-download hops (see download-source.ts) */
  sourceAuth?: SourceAuth;
  /**
   * A retried attempt of this grab (Bull retry): an earlier add may have reached the client
   * even though it failed here (timeout). SABnzbd checks for that job before uploading again.
   */
  retry?: boolean;
  /** The release's title from the indexer (SABnzbd matches an existing job by it, #329) */
  releaseTitle?: string;
}

/**
 * Failure while fetching a .torrent or .nzb from its source URL.
 * Keeping this distinct from download-client API failures lets the pipeline
 * try another release without blaming a healthy download client.
 */
export class DownloadSourceError extends Error {
  readonly name = 'DownloadSourceError';

  constructor(
    message: string,
    public readonly status: number | undefined,
    public readonly sourceUrl: string,
    public readonly originalError?: unknown
  ) {
    super(message);
  }
}

/** HTTP source failures that may clear on their own or succeed via another indexer. */
/**
 * The release's source can't be used at all (redirect to an invalid or malformed
 * location, magnet for a usenet client, redirect loop). The processor skips it
 * and tries the next ranked release. With `blocklistReason` (the release itself is
 * unusable, e.g. a duplicate NZB whose files are gone) it also blocklists the release.
 */
export class UnusableDownloadSourceError extends Error {
  readonly name = 'UnusableDownloadSourceError';

  constructor(message: string, public readonly blocklistReason?: string) {
    super(message);
  }
}

export function isRetryableDownloadSourceError(
  error: unknown
): error is DownloadSourceError {
  return error instanceof DownloadSourceError
    && typeof error.status === 'number'
    && (error.status === 429 || (error.status >= 500 && error.status < 600));
}

/** Result of a connection test */
export interface ConnectionTestResult {
  success: boolean;
  message?: string;
  version?: string;
}

// =========================================================================
// DOWNLOAD CLIENT INTERFACE
// =========================================================================

/**
 * IDownloadClient — the contract every download client must implement.
 *
 * Provides a unified API for managing downloads across different protocols
 * and client software. Processors interact with this interface exclusively,
 * enabling new download clients to be added without modifying consumer code.
 *
 * To add a new client (e.g., Transmission):
 * 1. Create a service class implementing IDownloadClient
 * 2. Add the type to DownloadClientType
 * 3. Add factory case in DownloadClientManager
 */
export interface IDownloadClient {
  /** Identifies the client software (e.g., 'qbittorrent', 'sabnzbd') */
  readonly clientType: DownloadClientType;
  /** The protocol this client operates on */
  readonly protocol: ProtocolType;

  /**
   * Test the connection to the download client.
   * @returns Connection test result with success/failure and optional version
   */
  testConnection(): Promise<ConnectionTestResult>;

  /**
   * Add a new download.
   * @param url - Download URL (magnet link, .torrent URL, or .nzb URL)
   * @param options - Optional download settings
   * @returns Client-assigned download ID, and whether the torrent was already in the client
   */
  addDownload(url: string, options?: AddDownloadOptions): Promise<AddDownloadResult>;

  /**
   * Get current status of a download.
   * Includes retry logic for race conditions (e.g., torrent not immediately available after adding).
   * @param id - Download ID returned by addDownload
   * @returns Download info, or null if not found
   */
  getDownload(id: string): Promise<DownloadInfo | null>;

  /**
   * Strict "is it still there" check for the seeding cleanup: one request, no retries.
   * Torrent clients only. Missing only on a well-formed answer without the torrent
   * (contract per client: documentation/phase3/download-clients.md); anything else throws.
   */
  probeDownload?(id: string): Promise<DownloadProbe>;

  /**
   * Pause a download.
   * @param id - Download ID
   */
  pauseDownload(id: string): Promise<void>;

  /**
   * Resume a paused download.
   * @param id - Download ID
   */
  resumeDownload(id: string): Promise<void>;

  /**
   * Delete a download from the client.
   * @param id - Download ID
   * @param deleteFiles - Whether to also delete downloaded files (default: false)
   */
  deleteDownload(id: string, deleteFiles?: boolean): Promise<void>;

  /**
   * Perform post-download cleanup specific to the client.
   * - qBittorrent: No-op (torrents continue seeding, handled by cleanup job)
   * - SABnzbd: Archives the completed NZB from history
   * @param id - Download ID
   */
  postProcess(id: string): Promise<void>;

  /**
   * Get available categories/labels from the download client.
   * - qBittorrent: Returns configured category names
   * - Transmission: Returns empty array (uses free-form labels)
   * - Usenet clients: Returns empty array (feature scoped to torrent clients)
   */
  getCategories(): Promise<string[]>;

  /**
   * Set the category/label for a download.
   * - qBittorrent: Sets torrent category
   * - Transmission: Sets torrent label
   * - Usenet clients: No-op
   * @param id - Download ID
   * @param category - Category/label name to assign
   */
  setCategory(id: string, category: string): Promise<void>;
}
