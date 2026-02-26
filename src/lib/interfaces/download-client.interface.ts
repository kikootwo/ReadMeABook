/**
 * Component: Download Client Interface
 * Documentation: documentation/phase3/download-clients.md
 *
 * Defines the contract all download clients must implement.
 * Enables protocol-agnostic download management across torrent and usenet clients.
 */

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
}

/** Options for adding a new download */
export interface AddDownloadOptions {
  /** Category/label to assign */
  category?: string;
  /** Priority level (interpretation varies by client) */
  priority?: string;
  /** Whether to add in paused state */
  paused?: boolean;
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
   * @returns Client-assigned download ID (torrent hash or NZB ID)
   */
  addDownload(url: string, options?: AddDownloadOptions): Promise<string>;

  /**
   * Get current status of a download.
   * Includes retry logic for race conditions (e.g., torrent not immediately available after adding).
   * @param id - Download ID returned by addDownload
   * @returns Download info, or null if not found
   */
  getDownload(id: string): Promise<DownloadInfo | null>;

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
