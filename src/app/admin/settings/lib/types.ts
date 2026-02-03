/**
 * Component: Admin Settings - Shared Types
 * Documentation: documentation/settings-pages.md
 */

/**
 * Main settings object structure
 */
export interface Settings {
  backendMode: 'plex' | 'audiobookshelf';
  hasLocalUsers: boolean;
  hasLocalAdmins: boolean;
  audibleRegion: string;
  plex: PlexSettings;
  audiobookshelf: AudiobookshelfSettings;
  oidc: OIDCSettings;
  registration: RegistrationSettings;
  prowlarr: ProwlarrSettings;
  downloadClient: DownloadClientSettings;
  paths: PathsSettings;
  ebook: EbookSettings;
}

/**
 * Plex library configuration
 */
export interface PlexSettings {
  url: string;
  token: string;
  libraryId: string;
  triggerScanAfterImport: boolean;
}

/**
 * Audiobookshelf library configuration
 */
export interface AudiobookshelfSettings {
  serverUrl: string;
  apiToken: string;
  libraryId: string;
  triggerScanAfterImport: boolean;
}

/**
 * OIDC authentication configuration
 */
export interface OIDCSettings {
  enabled: boolean;
  providerName: string;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  accessControlMethod: string;
  accessGroupClaim: string;
  accessGroupValue: string;
  allowedEmails: string;
  allowedUsernames: string;
  adminClaimEnabled: boolean;
  adminClaimName: string;
  adminClaimValue: string;
}

/**
 * Manual registration configuration
 */
export interface RegistrationSettings {
  enabled: boolean;
  requireAdminApproval: boolean;
}

/**
 * Prowlarr indexer configuration
 */
export interface ProwlarrSettings {
  url: string;
  apiKey: string;
}

/**
 * Download client (qBittorrent) configuration
 */
export interface DownloadClientSettings {
  type: string;
  url: string;
  username: string;
  password: string;
  disableSSLVerify: boolean;
  remotePathMappingEnabled: boolean;
  remotePath: string;
  localPath: string;
}

/**
 * File paths and processing configuration
 */
export interface PathsSettings {
  downloadDir: string;
  mediaDir: string;
  audiobookPathTemplate?: string;
  metadataTaggingEnabled: boolean;
  chapterMergingEnabled: boolean;
}

/**
 * E-book sidecar configuration
 * Supports two sources: Anna's Archive (direct HTTP) and Indexer Search (Prowlarr)
 */
export interface EbookSettings {
  // Source toggles
  annasArchiveEnabled: boolean;
  indexerSearchEnabled: boolean;
  // Anna's Archive specific settings
  baseUrl: string;
  flaresolverrUrl: string;
  // General settings (shared across sources)
  preferredFormat: string;
  autoGrabEnabled: boolean;
  // Kindle compatibility
  kindleFixEnabled: boolean;
}

/**
 * Plex library item
 */
export interface PlexLibrary {
  id: string;
  title: string;
  type: string;
}

/**
 * Audiobookshelf library item
 */
export interface ABSLibrary {
  id: string;
  name: string;
  type: string;
  itemCount: number;
}

/**
 * Prowlarr indexer configuration
 */
export interface IndexerConfig {
  id: number;
  name: string;
  protocol: string;
  privacy: string;
  enabled: boolean;
  priority: number;
  seedingTimeMinutes?: number; // Torrents only
  removeAfterProcessing?: boolean; // Usenet only
  rssEnabled: boolean;
  audiobookCategories?: number[]; // Category IDs for audiobook searches (default: [3030])
  ebookCategories?: number[]; // Category IDs for ebook searches (default: [7020])
  supportsRss?: boolean;
}

/**
 * Saved indexer configuration (subset for UI)
 */
export interface SavedIndexerConfig {
  id: number;
  name: string;
  protocol: string;
  priority: number;
  seedingTimeMinutes?: number; // Torrents only
  removeAfterProcessing?: boolean; // Usenet only
  rssEnabled: boolean;
  audiobookCategories: number[]; // Category IDs for audiobook searches (default: [3030])
  ebookCategories: number[]; // Category IDs for ebook searches (default: [7020])
}

/**
 * Pending user awaiting approval
 */
export interface PendingUser {
  id: string;
  plexUsername: string;
  plexEmail: string | null;
  authProvider: string | null;
  createdAt: string;
}

/**
 * Validation state for all settings sections
 */
export interface ValidationState {
  plex?: boolean;
  audiobookshelf?: boolean;
  oidc?: boolean;
  registration?: boolean;
  prowlarr?: boolean;
  download?: boolean;
  paths?: boolean;
}

/**
 * Test result for connection tests
 */
export interface TestResult {
  success: boolean;
  message: string;
  responseTime?: number;
  templateValidation?: {
    isValid: boolean;
    error?: string;
    previewPaths?: string[];
  };
}

/**
 * Message/notification display
 */
export interface Message {
  type: 'success' | 'error';
  text: string;
}

/**
 * BookDate AI provider configuration
 */
export interface BookDateConfig {
  provider: string;
  apiKey?: string;
  model: string;
  baseUrl?: string;
  isEnabled: boolean;
  isVerified: boolean;
}

/**
 * BookDate AI model option
 */
export interface BookDateModel {
  id: string;
  name: string;
}

/**
 * Tab identifier type
 */
export type SettingsTab = 'library' | 'auth' | 'prowlarr' | 'download' | 'paths' | 'ebook' | 'bookdate' | 'notifications';
