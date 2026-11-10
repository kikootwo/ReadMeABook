/**
 * Component: Manual Torrent Constants (admin Add Torrent; shared by the route and the dialog)
 * Documentation: documentation/phase3/manual-torrent-download.md
 */

export { MAX_UPLOADED_TORRENT_BYTES } from './download-source';

/** Refusal (409) and the dialog's notice when no enabled torrent client exists */
export const NO_TORRENT_CLIENT_MESSAGE =
  'No torrent client is set up. Add qBittorrent, Transmission or Deluge in Settings > Download Clients.';
