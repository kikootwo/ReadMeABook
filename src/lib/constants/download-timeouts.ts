/**
 * Component: Download Client Timeout Constants
 * Documentation: documentation/phase3/download-clients.md
 *
 * Some indexers (e.g. YGGtorrent) enforce a ~30s wait before allowing
 * .torrent file downloads. 60s gives sufficient headroom.
 */

/** Timeout for download client API calls and .torrent file fetches (ms) */
export const DOWNLOAD_CLIENT_TIMEOUT = 60000;

/** Timeout for a Prowlarr search (ms): one search waits on every indexer, and slow ones exceed 60s (#601) */
export const PROWLARR_SEARCH_TIMEOUT = 180000;
