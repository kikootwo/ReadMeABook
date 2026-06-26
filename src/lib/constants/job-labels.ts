/**
 * Component: Job Type Display Labels
 * Documentation: documentation/backend/services/scheduler.md
 */

// Short, human-readable labels for every job type that can appear in the
// admin Logs page or scheduled-jobs dropdown. Insertion order is the display
// order used by the Logs filter dropdown.
export const JOB_TYPE_LABELS: Record<string, string> = {
  search_indexers: 'Search Indexers',
  download_torrent: 'Download Torrent',
  monitor_download: 'Monitor Download',
  organize_files: 'Organize Files',
  scan_plex: 'Library Scan',
  match_plex: 'Library Match',
  plex_library_scan: 'Library Scan (Scheduled)',
  plex_recently_added_check: 'Recently Added Check',
  audible_refresh: 'Audible Refresh',
  retry_missing_torrents: 'Retry Missing Torrents',
  retry_failed_imports: 'Retry Failed Imports',
  cleanup_seeded_torrents: 'Cleanup Seeded Torrents',
  monitor_rss_feeds: 'Monitor RSS Feeds',
  find_missing_ebooks: 'Find Missing Ebooks',
  retry_unavailable_ebooks: 'Retry Unavailable Ebooks',
  sync_reading_shelves: 'Sync Reading Shelves',
  check_watched_lists: 'Check Watched Lists',
};
