/**
 * Component: Bulk Import Shared Types
 * Documentation: documentation/features/bulk-import.md
 */

/** Root directory entry from the filesystem browse API. */
export interface RootEntry {
  name: string;
  path: string;
  icon: string;
}

/** Directory entry from the filesystem browse API. */
export interface DirectoryEntry {
  name: string;
  type: 'directory';
}

/** Audible match data for a discovered audiobook. */
export interface AudibleMatch {
  asin: string;
  title: string;
  author: string;
  narrator?: string;
  coverArtUrl?: string;
  durationMinutes?: number;
}

/** A scanned audiobook result with its Audible match status. */
export interface ScannedBook {
  index: number;
  folderPath: string;
  folderName: string;
  relativePath: string;
  audioFileCount: number;
  totalSizeBytes: number;
  metadataSource: 'tags' | 'file_name';
  searchTerm: string;
  audioFiles: string[];
  match: AudibleMatch | null;
  inLibrary: boolean;
  hasActiveRequest: boolean;
  /** User toggle: true = skip this book during import. */
  skipped: boolean;
}

/** Progress event from the SSE scan stream. */
export interface ScanProgressEvent {
  phase: 'discovering' | 'reading_metadata' | 'grouping';
  foldersScanned: number;
  audiobooksFound: number;
  currentFolder?: string;
}

/** Matching progress event from the SSE scan stream. */
export interface MatchingProgressEvent {
  current: number;
  total: number;
  folderName: string;
  searchTerm: string;
}

/** Discovery complete event from the SSE scan stream. */
export interface DiscoveryCompleteEvent {
  totalFound: number;
  message: string;
}

/** Wizard step identifiers. */
export type WizardStep = 'select_folder' | 'scanning' | 'review';

/** Format bytes into a human-readable string. */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
