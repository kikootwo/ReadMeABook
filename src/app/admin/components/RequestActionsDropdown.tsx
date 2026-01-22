/**
 * Component: Request Actions Dropdown
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * Dropdown menu for admin actions on requests
 */

'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { InteractiveTorrentSearchModal } from '@/components/requests/InteractiveTorrentSearchModal';
import { useSmartDropdownPosition } from '@/hooks/useSmartDropdownPosition';

export interface RequestActionsDropdownProps {
  request: {
    requestId: string;
    title: string;
    author: string;
    status: string;
    torrentUrl?: string | null;
  };
  onDelete: (requestId: string, title: string) => void;
  onManualSearch: (requestId: string) => Promise<void>;
  onCancel: (requestId: string) => Promise<void>;
  onFetchEbook?: (requestId: string) => Promise<void>;
  ebookSidecarEnabled?: boolean;
  isLoading?: boolean;
}

export function RequestActionsDropdown({
  request,
  onDelete,
  onManualSearch,
  onCancel,
  onFetchEbook,
  ebookSidecarEnabled = false,
  isLoading = false,
}: RequestActionsDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showInteractiveSearch, setShowInteractiveSearch] = useState(false);
  const { containerRef, dropdownRef, positionAbove, style } = useSmartDropdownPosition(isOpen);

  // Determine available actions based on status
  const canSearch = ['pending', 'failed', 'awaiting_search'].includes(request.status);
  const canCancel = ['pending', 'searching', 'downloading'].includes(request.status);
  const canDelete = true; // Admins can always delete
  // Only show "View Source" if we have a valid indexer page URL (not a magnet link)
  const canViewSource = !!request.torrentUrl &&
    !request.torrentUrl.startsWith('magnet:') &&
    ['downloading', 'processing', 'downloaded', 'available'].includes(request.status);
  const canFetchEbook = ebookSidecarEnabled && ['downloaded', 'available'].includes(request.status);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleManualSearch = async () => {
    setIsOpen(false);
    try {
      await onManualSearch(request.requestId);
    } catch (error) {
      console.error('Failed to trigger manual search:', error);
    }
  };

  const handleInteractiveSearch = () => {
    setIsOpen(false);
    setShowInteractiveSearch(true);
  };

  const handleCancel = async () => {
    setIsOpen(false);
    if (window.confirm(`Are you sure you want to cancel the request for "${request.title}"?`)) {
      try {
        await onCancel(request.requestId);
      } catch (error) {
        console.error('Failed to cancel request:', error);
      }
    }
  };

  const handleDelete = () => {
    setIsOpen(false);
    onDelete(request.requestId, request.title);
  };

  const handleFetchEbook = async () => {
    setIsOpen(false);
    if (onFetchEbook) {
      try {
        await onFetchEbook(request.requestId);
      } catch (error) {
        console.error('Failed to fetch e-book:', error);
      }
    }
  };

  // Dropdown menu content (rendered via portal)
  const dropdownMenu = isOpen && style && (
    <div
      ref={dropdownRef}
      style={style}
      className="w-56 rounded-lg shadow-lg bg-white dark:bg-gray-800 ring-1 ring-black ring-opacity-5 z-50 max-h-[calc(100vh-2rem)] overflow-y-auto"
    >
          <div className="py-1" role="menu">
            {/* Manual Search */}
            {canSearch && (
              <button
                onClick={handleManualSearch}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors"
                role="menuitem"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                Manual Search
              </button>
            )}

            {/* Interactive Search */}
            {canSearch && (
              <button
                onClick={handleInteractiveSearch}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors"
                role="menuitem"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                  />
                </svg>
                Interactive Search
              </button>
            )}

            {/* View Source */}
            {canViewSource && (
              <a
                href={request.torrentUrl!}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setIsOpen(false)}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors"
                role="menuitem"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                  />
                </svg>
                View Source
              </a>
            )}

            {/* Fetch E-book */}
            {canFetchEbook && (
              <button
                onClick={handleFetchEbook}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors"
                role="menuitem"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                  />
                </svg>
                Try to fetch Ebook
              </button>
            )}

            {/* Divider if we have search/view actions and other actions */}
            {(canSearch || canViewSource || canFetchEbook) && (canCancel || canDelete) && (
              <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
            )}

            {/* Cancel */}
            {canCancel && (
              <button
                onClick={handleCancel}
                className="w-full text-left px-4 py-2 text-sm text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 flex items-center gap-2 transition-colors"
                role="menuitem"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
                Cancel Request
              </button>
            )}

            {/* Divider before delete */}
            {canDelete && (canSearch || canCancel) && (
              <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
            )}

            {/* Delete */}
            {canDelete && (
              <button
                onClick={handleDelete}
                className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 transition-colors"
                role="menuitem"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
                Delete Request
              </button>
            )}
          </div>
        </div>
  );

  return (
    <>
      {/* Three-dot menu button */}
      <div className="relative" ref={containerRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          disabled={isLoading}
          className="inline-flex items-center justify-center w-8 h-8 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Actions"
        >
          <svg
            className="w-5 h-5 text-gray-600 dark:text-gray-400"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
          </svg>
        </button>
      </div>

      {/* Dropdown menu (rendered via portal) */}
      {typeof window !== 'undefined' && dropdownMenu && createPortal(dropdownMenu, document.body)}

      {/* Interactive Search Modal */}
      <InteractiveTorrentSearchModal
        isOpen={showInteractiveSearch}
        onClose={() => setShowInteractiveSearch(false)}
        requestId={request.requestId}
        audiobook={{
          title: request.title,
          author: request.author,
        }}
      />
    </>
  );
}
