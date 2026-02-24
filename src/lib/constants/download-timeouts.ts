/**
 * Component: Download Client Timeout Constants
 * Documentation: documentation/phase3/download-clients.md
 *
 * Some indexers (e.g. YGGtorrent) enforce a ~30s wait before allowing
 * .torrent file downloads. 60s gives sufficient headroom.
 */

/** Timeout for download client API calls and .torrent file fetches (ms) */
export const DOWNLOAD_CLIENT_TIMEOUT = 60000;
