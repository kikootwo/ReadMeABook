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
import { AdjustSearchTermsModal } from './AdjustSearchTermsModal';
import { useSmartDropdownPosition } from '@/hooks/useSmartDropdownPosition';

export interface RequestActionsDropdownProps {
  request: {
    requestId: string;
    title: string;
    author: string;
    status: string;
    type?: 'audiobook' | 'ebook';
    asin?: string | null;
    torrentUrl?: string | null;
    downloadAttempts?: number;
    customSearchTerms?: string | null;
  };
  onDelete: (requestId: string, title: string) => void;
  onManualSearch: (requestId: string) => Promise<void>;
  onCancel: (requestId: string) => Promise<void>;
  onRetryDownload?: (requestId: string) => Promise<void>;
  onViewDetails?: (asin: string) => void;
  onFetchEbook?: (requestId: string) => Promise<void>;
  onSearchTermsUpdated?: () => void;
  ebookSidecarEnabled?: boolean;
  annasArchiveBaseUrl?: string;
  isLoading?: boolean;
}

export function RequestActionsDropdown({
  request,
  onDelete,
  onManualSearch,
  onCancel,
  onRetryDownload,
  onViewDetails,
  onFetchEbook,
  onSearchTermsUpdated,
  ebookSidecarEnabled = false,
  annasArchiveBaseUrl = 'https://annas-archive.li',
  isLoading = false,
}: RequestActionsDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showInteractiveSearch, setShowInteractiveSearch] = useState(false);
  const [showInteractiveSearchEbook, setShowInteractiveSearchEbook] = useState(false);
  const [showAdjustSearchTerms, setShowAdjustSearchTerms] = useState(false);
  const { containerRef, dropdownRef, positionAbove, style } = useSmartDropdownPosition(isOpen);

  // Determine request type
  const isEbook = request.type === 'ebook';

  // View Details: available when ASIN exists (audiobook requests only)
  const canViewDetails = !isEbook && !!request.asin && !!onViewDetails;

  // Determine available actions based on status
  const canSearch = ['pending', 'failed', 'awaiting_search'].includes(request.status);
  const canAdjustSearchTerms = ['pending', 'failed', 'awaiting_search', 'searching'].includes(request.status);
  const canRetryDownload = request.status === 'failed' && (request.downloadAttempts ?? 0) > 0 && !!onRetryDownload;
  const canCancel = ['pending', 'searching', 'downloading'].includes(request.status);
  const canDelete = true; // Admins can always delete

  // View Source: For ebooks, extract MD5 from slow download URL and link to Anna's Archive
  // For audiobooks and indexer-sourced ebooks, show indexer page URL (not magnet links)
  let viewSourceUrl: string | null = null;
  if (isEbook && request.torrentUrl) {
    // torrentUrl for ebooks can be:
    // 1. JSON array of slow download URLs (Anna's Archive) - extract MD5
    // 2. Plain URL string (indexer source) - use directly
    try {
      const urls = JSON.parse(request.torrentUrl);
      if (Array.isArray(urls) && urls.length > 0) {
        const md5Match = urls[0].match(/\/slow_download\/([a-f0-9]{32})\//i);
        if (md5Match) {
          viewSourceUrl = `${annasArchiveBaseUrl.replace(/\/+$/, '')}/md5/${md5Match[1]}`;
        }
      }
    } catch {
      // Not JSON - it's a plain URL from indexer source
      // Use it directly if it's not a magnet link
      if (!request.torrentUrl.startsWith('magnet:')) {
        viewSourceUrl = request.torrentUrl;
      }
    }
  } else if (request.torrentUrl && !request.torrentUrl.startsWith('magnet:')) {
    viewSourceUrl = request.torrentUrl;
  }

  const canViewSource = !!viewSourceUrl &&
    ['downloading', 'processing', 'downloaded', 'available'].includes(request.status);

  // Ebook actions (Grab Ebook, Interactive Search Ebook) only for audiobook requests
  const canFetchEbook = !isEbook && ebookSidecarEnabled && ['downloaded', 'available'].includes(request.status);

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
    if (isEbook) {
      setShowInteractiveSearchEbook(true);
    } else {
      setShowInteractiveSearch(true);
    }
  };

  const handleAdjustSearchTerms = () => {
    setIsOpen(false);
    setShowAdjustSearchTerms(true);
  };

  const handleInteractiveSearchEbook = () => {
    setIsOpen(false);
    setShowInteractiveSearchEbook(true);
  };

  const handleRetryDownload = async () => {
    setIsOpen(false);
    if (onRetryDownload) {
      try {
        await onRetryDownload(request.requestId);
      } catch (error) {
        console.error('Failed to retry download:', error);
      }
    }
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

  const handleViewDetails = () => {
    setIsOpen(false);
    if (request.asin && onViewDetails) {
      onViewDetails(request.asin);
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
            {/* View Details */}
            {canViewDetails && (
              <button
                onClick={handleViewDetails}
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
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </svg>
                View Details
              </button>
            )}

            {/* Divider after View Details */}
            {canViewDetails && (canSearch || canViewSource || canFetchEbook || canCancel || canDelete) && (
              <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
            )}

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

            {/* Adjust Search Terms */}
            {canAdjustSearchTerms && (
              <button
                onClick={handleAdjustSearchTerms}
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
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                  />
                </svg>
                <span className="flex items-center gap-1.5">
                  Adjust Search Terms
                  {request.customSearchTerms && (
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                  )}
                </span>
              </button>
            )}

            {/* View Source */}
            {canViewSource && viewSourceUrl && (
              <a
                href={viewSourceUrl}
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

            {/* Grab E-book (automatic) */}
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
                Grab Ebook
              </button>
            )}

            {/* Interactive Search E-book */}
            {canFetchEbook && (
              <button
                onClick={handleInteractiveSearchEbook}
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
                Interactive Search Ebook
              </button>
            )}

            {/* Retry Download */}
            {canRetryDownload && (
              <button
                onClick={handleRetryDownload}
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
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
                Retry Download
              </button>
            )}

            {/* Divider if we have search/view/retry actions and other actions */}
            {(canSearch || canViewSource || canFetchEbook || canRetryDownload) && (canCancel || canDelete) && (
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
            {canDelete && (canSearch || canRetryDownload || canCancel) && (
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

      {/* Interactive Search Modal (Audiobook) */}
      <InteractiveTorrentSearchModal
        isOpen={showInteractiveSearch}
        onClose={() => setShowInteractiveSearch(false)}
        requestId={request.requestId}
        audiobook={{
          title: request.title,
          author: request.author,
        }}
        customSearchTerms={request.customSearchTerms}
      />

      {/* Interactive Search Modal (Ebook) */}
      <InteractiveTorrentSearchModal
        isOpen={showInteractiveSearchEbook}
        onClose={() => setShowInteractiveSearchEbook(false)}
        requestId={request.requestId}
        audiobook={{
          title: request.title,
          author: request.author,
        }}
        searchMode="ebook"
        customSearchTerms={request.customSearchTerms}
      />

      {/* Adjust Search Terms Modal */}
      <AdjustSearchTermsModal
        isOpen={showAdjustSearchTerms}
        onClose={() => setShowAdjustSearchTerms(false)}
        requestId={request.requestId}
        title={request.title}
        author={request.author}
        currentSearchTerms={request.customSearchTerms}
        onSuccess={onSearchTermsUpdated}
      />
    </>
  );
}
