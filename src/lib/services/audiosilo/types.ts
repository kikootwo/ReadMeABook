/**
 * Component: AudioSilo API Types
 * Documentation: documentation/features/audiosilo-integration.md
 *
 * Only the fields ReadMeABook reads. Source: docs.audiosilo.app/developers/server/api
 */

export interface AudioSiloServerInfo {
  name: string;
  version: string;
  /** Stable per-install identity (never changes for the life of the install) */
  server_id: string;
  api?: string;
}

export interface AudioSiloLibrary {
  id: number;
  name: string;
  /** 'books' or 'podcasts' */
  kind: string;
  /** Only sent to admins */
  root?: string;
}

export interface AudioSiloBook {
  /** Index value, not guaranteed to survive a re-index: identify books by rel_path */
  id: number;
  library_id: number;
  /** Library-relative path; the identity RMAB stores */
  rel_path: string;
  is_folder?: boolean;
  title: string;
  author?: string;
  narrator?: string;
  subtitle?: string;
  series?: string;
  series_index?: number;
  /** Seconds */
  duration?: number;
  /** RFC 3339; AudioSilo has no updated_at */
  added_at?: string;
  published?: string;
  /** Only present when known */
  asin?: string | null;
  isbn?: string | null;
  /** Item endpoint only */
  description?: string;
  ebook?: boolean;
}
