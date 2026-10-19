/**
 * Component: Download Source Fetch Constants
 * Documentation: documentation/phase3/download-clients.md
 */

/** Max redirect hops followed when resolving a .torrent/.nzb source URL */
export const MAX_SOURCE_REDIRECT_HOPS = 5;

/** Max size of a fetched .torrent/.nzb file (bytes) */
export const MAX_SOURCE_FILE_BYTES = 50 * 1024 * 1024;

/** Bodies at or below this size are checked for a bare magnet link */
export const MAX_MAGNET_BODY_BYTES = 16 * 1024;

/** Placeholder written in place of a redacted secret */
export const REDACTED_VALUE = 'REDACTED';
