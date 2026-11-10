/**
 * Component: Add Torrent Menu Item (admin request actions)
 * Documentation: documentation/phase3/manual-torrent-download.md
 */

'use client';

import { ADVANCEABLE_FROM_INTERACTIVE_SEARCH } from '@/lib/constants/request-statuses';

/** Shown on audiobook requests in the statuses the Add Torrent route accepts */
export function canAddTorrent(request: { status: string; type?: 'audiobook' | 'ebook' }): boolean {
  return request.type !== 'ebook' && (ADVANCEABLE_FROM_INTERACTIVE_SEARCH as readonly string[]).includes(request.status);
}

export function AddTorrentMenuItem({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors"
      role="menuitem"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
      </svg>
      Add Torrent
    </button>
  );
}
