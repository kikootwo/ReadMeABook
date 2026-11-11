/**
 * Component: Lists Tab types
 * Documentation: documentation/backend/services/list-sync.md
 */

export type ListStatus = 'new' | 'ok' | 'syncing' | 'paused' | 'error';

export interface ListRun {
  startedAt: string;
  completedAt: string | null;
  fetched: number;
  newOnList: number;
  filtered: number;
  missed: number;
  alreadyHave: number;
  skipped: number;
  requested: number;
  stoppedReason: string | null;
}

export interface ImportListItem {
  id: string;
  name: string;
  listId: number;
  url: string;
  enabled: boolean;
  autoRequest: boolean;
  syncIntervalHours: number;
  topN: number;
  maxRequestsPerSync: number;
  filterProfileId: string | null;
  filterProfileName: string | null;
  sourceSize: number | null;
  status: ListStatus;
  lastSyncedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastError: string | null;
  lastRun: ListRun | null;
}

export interface FilterProfileItem {
  id: string;
  name: string;
  builtIn: boolean;
  listCount: number;
  skipPartsAndSets: boolean;
  titleExcludePatterns: string[];
  authorExcludePatterns: string[];
  requireAudibleAsin: boolean;
  allowAbridged: boolean;
  minRuntimeMinutes: number;
  maxRuntimeMinutes: number;
  minPublicationYear: number;
  maxPublicationYear: number;
  allowedLanguages: string[];
  excludedPublishers: string[];
  excludedNarrators: string[];
  excludedGenres: string[];
  includedGenres: string[];
  minAudibleRating: number;
}

export interface ListsStatus {
  freeGb: number | null;
  minFreeGb: number;
  maxRequestsPerHour: number;
  requestedLastHour: number;
  allowanceLeft: number;
  lowDisk: boolean;
  lists: { enabled: number; paused: number };
}

export type PreviewStatus = 'in_library' | 'requested' | 'ignored' | 'filtered' | 'no_match' | 'would_request';

export interface PreviewRow {
  rank: number;
  title: string;
  author: string;
  asin?: string;
  status: PreviewStatus;
  detail?: string;
  rating?: number;
  minutes?: number;
}

export interface PreviewState {
  listId: string;
  state: 'running' | 'done' | 'error';
  done: number;
  total: number;
  rows: PreviewRow[];
  counts: Record<PreviewStatus, number>;
  error?: string;
}

export interface SyncLogItem {
  id: string;
  startedAt: string;
  completedAt: string | null;
  fetched: number;
  newOnList: number;
  filtered: number;
  missed: number;
  alreadyHave: number;
  skipped: number;
  requested: number;
  stoppedReason: string | null;
  errorMessage: string | null;
  samples: Record<string, string[]>;
}

export const STATUS_STYLE: Record<ListStatus, { label: string; className: string }> = {
  new: { label: 'Not synced yet', className: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200' },
  ok: { label: 'Synced', className: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
  syncing: { label: 'Syncing…', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
  paused: { label: 'Paused', className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300' },
  error: { label: 'Error', className: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
};

export function timeAgo(value: string | null): string {
  if (!value) return 'never';
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 2) return 'just now';
  if (minutes < 120) return `${minutes} min ago`;
  if (minutes < 2880) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} days ago`;
}

export const inputClass =
  'w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500';
export const btnClass =
  'px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';
export const btnPrimaryClass =
  'px-3 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors';
export const btnDangerClass =
  'px-3 py-2 text-sm font-medium rounded-lg border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors';
