/**
 * Component: Interactive Torrent Search Modal
 * Documentation: documentation/phase3/prowlarr.md
 *
 * Supports two search modes:
 * - audiobook: Search for audiobook torrents/NZBs (default)
 * - ebook: Search for ebooks from Anna's Archive + indexers
 */

'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { TorrentResult, RankedTorrent } from '@/lib/utils/ranking-algorithm';
import {
  useInteractiveSearch,
  useSelectTorrent,
  useSearchTorrents,
  useRequestWithTorrent,
  useInteractiveSearchEbook,
  useSelectEbook,
  useInteractiveSearchEbookByAsin,
  useSelectEbookByAsin,
} from '@/lib/hooks/useRequests';
import { useReplaceWithTorrent } from '@/lib/hooks/useReportedIssues';
import { Audiobook } from '@/lib/hooks/useAudiobooks';

interface InteractiveTorrentSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  requestId?: string; // Optional - only provided when called from existing request
  asin?: string; // Optional - ASIN for ebook mode when no request exists
  audiobook: {
    title: string;
    author: string;
  };
  fullAudiobook?: Audiobook; // Optional - only provided when called from details modal
  onSuccess?: () => void;
  searchMode?: 'audiobook' | 'ebook'; // Search mode - defaults to audiobook
  replaceIssueId?: string; // Optional - when set, confirm handler calls replace endpoint instead
  onConfirm?: (torrent: TorrentResult) => Promise<void>; // Optional - overrides default confirm handler
}

// Format relative time from publish date
const formatAge = (date: Date | string): string => {
  const now = new Date();
  const d = new Date(date);
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 0) return 'Soon';
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return '1d ago';
  if (diffDays < 30) return `${diffDays}d ago`;
  const months = Math.floor(diffDays / 30.44);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(diffDays / 365.25);
  return `${years}y ago`;
};

// Format file size
const formatSize = (bytes: number): string => {
  const gb = bytes / (1024 ** 3);
  const mb = bytes / (1024 ** 2);
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
};

// Score badge color scheme
const getScoreStyle = (score: number) => {
  if (score >= 90) return { bg: 'bg-emerald-500/15 dark:bg-emerald-400/15', text: 'text-emerald-700 dark:text-emerald-400' };
  if (score >= 70) return { bg: 'bg-blue-500/15 dark:bg-blue-400/15', text: 'text-blue-700 dark:text-blue-400' };
  if (score >= 50) return { bg: 'bg-amber-500/15 dark:bg-amber-400/15', text: 'text-amber-700 dark:text-amber-400' };
  return { bg: 'bg-gray-500/10 dark:bg-gray-400/10', text: 'text-gray-500 dark:text-gray-400' };
};

// Skeleton widths for loading state (deterministic to avoid hydration mismatch)
const skeletonRows = [
  { title: '72%', meta: '48%' },
  { title: '85%', meta: '58%' },
  { title: '64%', meta: '42%' },
  { title: '78%', meta: '52%' },
  { title: '68%', meta: '45%' },
];

export function InteractiveTorrentSearchModal({
  isOpen,
  onClose,
  requestId,
  asin,
  audiobook,
  fullAudiobook,
  onSuccess,
  searchMode = 'audiobook',
  replaceIssueId,
  onConfirm,
}: InteractiveTorrentSearchModalProps) {
  // Hooks for existing audiobook request flow
  const { searchTorrents: searchByRequestId, isLoading: isSearchingByRequest, error: searchByRequestError } = useInteractiveSearch();
  const { selectTorrent, isLoading: isSelectingTorrent, error: selectTorrentError } = useSelectTorrent();

  // Hook for reported issue replacement flow
  const { replaceWithTorrent, isLoading: isReplacing, error: replaceError } = useReplaceWithTorrent();

  // Hooks for new audiobook flow
  const { searchTorrents: searchByAudiobook, isLoading: isSearchingByAudiobook, error: searchByAudiobookError } = useSearchTorrents();
  const { requestWithTorrent, isLoading: isRequestingWithTorrent, error: requestWithTorrentError } = useRequestWithTorrent();

  // Hooks for ebook flow (request ID-based - admin)
  const { searchEbooks, isLoading: isSearchingEbooks, error: searchEbooksError } = useInteractiveSearchEbook();
  const { selectEbook, isLoading: isSelectingEbook, error: selectEbookError } = useSelectEbook();

  // Hooks for ebook flow (ASIN-based - user)
  const { searchEbooks: searchEbooksByAsin, isLoading: isSearchingEbooksByAsin, error: searchEbooksByAsinError } = useInteractiveSearchEbookByAsin();
  const { selectEbook: selectEbookByAsin, isLoading: isSelectingEbookByAsin, error: selectEbookByAsinError } = useSelectEbookByAsin();

  const [results, setResults] = useState<(RankedTorrent & { qualityScore?: number; source?: string; ebookFormat?: string })[]>([]);
  const [confirmTorrent, setConfirmTorrent] = useState<TorrentResult | null>(null);
  const [searchTitle, setSearchTitle] = useState(audiobook.title);
  const [isCustomConfirming, setIsCustomConfirming] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Stable close handler via ref
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const handleClose = useCallback(() => { onCloseRef.current(); }, []);

  // Determine which mode we're in
  const isEbookMode = searchMode === 'ebook';
  const hasRequestId = !!requestId;
  const hasAsin = !!asin;
  const useAsinMode = isEbookMode && hasAsin && !hasRequestId;

  // Loading/error state based on mode
  const isSearching = isEbookMode
    ? (useAsinMode ? isSearchingEbooksByAsin : isSearchingEbooks)
    : (hasRequestId ? isSearchingByRequest : isSearchingByAudiobook);
  const isDownloading = isCustomConfirming
    ? true
    : replaceIssueId
      ? isReplacing
      : isEbookMode
        ? (useAsinMode ? isSelectingEbookByAsin : isSelectingEbook)
        : (hasRequestId ? isSelectingTorrent : isRequestingWithTorrent);
  const error = replaceIssueId
    ? (replaceError || (hasRequestId ? searchByRequestError : searchByAudiobookError))
    : isEbookMode
      ? (useAsinMode ? (searchEbooksByAsinError || selectEbookByAsinError) : (searchEbooksError || selectEbookError))
      : (hasRequestId
          ? (searchByRequestError || selectTorrentError)
          : (searchByAudiobookError || requestWithTorrentError));

  // Mount tracking for portal
  useEffect(() => { setMounted(true); }, []);

  // Reset search title when modal opens/closes or audiobook changes
  useEffect(() => {
    setSearchTitle(audiobook.title);
    setResults([]);
  }, [isOpen, audiobook.title]);

  // Perform search when modal opens
  useEffect(() => {
    if (isOpen && results.length === 0) {
      performSearch();
    }
  }, [isOpen]);

  // ESC key and body scroll lock
  // ESC dismisses confirmation first, then closes modal
  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmTorrent) {
          setConfirmTorrent(null);
        } else {
          handleClose();
        }
      }
    };
    document.addEventListener('keydown', handleEsc);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleClose, confirmTorrent]);

  const performSearch = async () => {
    setResults([]);
    try {
      let data;
      if (isEbookMode) {
        const customTitle = searchTitle !== audiobook.title ? searchTitle : undefined;
        if (useAsinMode && asin) {
          data = await searchEbooksByAsin(asin, customTitle);
        } else if (requestId) {
          data = await searchEbooks(requestId, customTitle);
        } else {
          console.error('Ebook search requires either requestId or asin');
          return;
        }
      } else if (hasRequestId) {
        const customTitle = searchTitle !== audiobook.title ? searchTitle : undefined;
        data = await searchByRequestId(requestId, customTitle);
      } else {
        const audiobookAsin = fullAudiobook?.asin || asin;
        data = await searchByAudiobook(searchTitle, audiobook.author, audiobookAsin);
      }
      setResults(data || []);
    } catch (err) {
      console.error('Search failed:', err);
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') performSearch();
  };

  const handleDownloadClick = (torrent: TorrentResult) => {
    setConfirmTorrent(torrent);
  };

  const handleConfirmDownload = async () => {
    if (!confirmTorrent) return;
    try {
      if (onConfirm) {
        // Custom confirm handler (e.g., admin approve-with-torrent flow)
        setIsCustomConfirming(true);
        await onConfirm(confirmTorrent);
      } else if (replaceIssueId) {
        // Reported issue replacement flow
        await replaceWithTorrent(replaceIssueId, confirmTorrent);
      } else if (isEbookMode) {
        if (useAsinMode && asin) {
          await selectEbookByAsin(asin, confirmTorrent);
        } else if (requestId) {
          await selectEbook(requestId, confirmTorrent);
        } else {
          throw new Error('Request ID or ASIN required for ebook selection');
        }
      } else if (hasRequestId) {
        await selectTorrent(requestId, confirmTorrent);
      } else {
        if (!fullAudiobook) throw new Error('Audiobook data required to create request');
        await requestWithTorrent(fullAudiobook, confirmTorrent);
      }
      onSuccess?.();
      setConfirmTorrent(null);
      onClose();
    } catch (err) {
      console.error('Failed to download:', err);
      setConfirmTorrent(null);
    } finally {
      setIsCustomConfirming(false);
    }
  };

  // UI text based on mode
  const modalTitle = isEbookMode ? 'Find Ebook' : 'Find Audiobook';
  const noResultsText = isEbookMode ? 'No ebooks found' : 'No results found';
  const resultCountText = (count: number) =>
    isEbookMode
      ? `${count} ebook${count !== 1 ? 's' : ''} found`
      : `${count} result${count !== 1 ? 's' : ''} found`;
  const confirmModalTitle = isEbookMode ? 'Download Ebook' : 'Confirm Download';

  if (!isOpen || !mounted) return null;

  const modalContent = (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      style={{ height: '100dvh' }}
      onClick={handleClose}
    >
      <div
        className="relative w-full sm:max-w-2xl lg:max-w-3xl bg-white dark:bg-gray-900 sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-300"
        style={{
          maxHeight: 'calc(100dvh - env(safe-area-inset-top, 0px) - 1rem)',
          paddingTop: 'env(safe-area-inset-top, 0px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md border-b border-gray-200/50 dark:border-gray-700/50">
          <h2 className="text-[17px] font-semibold text-gray-900 dark:text-white">{modalTitle}</h2>
          <button
            onClick={handleClose}
            className="p-1.5 -mr-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          <div className="p-4 sm:p-5 space-y-4">

            {/* Search Bar */}
            <div>
              <div className="flex items-center gap-2.5 bg-gray-100/80 dark:bg-white/[0.06] rounded-xl px-3.5 py-2.5 border border-transparent focus-within:border-blue-500/40 focus-within:bg-white dark:focus-within:bg-white/[0.08] focus-within:shadow-sm focus-within:shadow-blue-500/10 transition-all duration-200">
                <svg className="w-[18px] h-[18px] text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={searchTitle}
                  onChange={(e) => setSearchTitle(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Search title..."
                  disabled={isSearching}
                  className="flex-1 bg-transparent outline-none text-[15px] text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 disabled:opacity-50 min-w-0"
                />
                {isSearching ? (
                  <div className="flex-shrink-0 w-5 h-5 border-2 border-gray-300 dark:border-gray-600 border-t-blue-500 rounded-full animate-spin" />
                ) : (
                  <button
                    onClick={performSearch}
                    disabled={!searchTitle.trim()}
                    className="flex-shrink-0 px-3 py-1 text-[13px] font-semibold text-white bg-blue-600 hover:bg-blue-700 active:scale-[0.97] rounded-lg transition-all disabled:opacity-30 disabled:pointer-events-none"
                  >
                    Search
                  </button>
                )}
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5 ml-1 truncate">
                by {audiobook.author}
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2.5 px-3.5 py-3 bg-red-50/80 dark:bg-red-500/10 rounded-xl border border-red-200/60 dark:border-red-500/20">
                <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-red-600 dark:text-red-400 leading-snug">{error}</p>
              </div>
            )}

            {/* Loading Skeleton */}
            {isSearching && (
              <div className="space-y-0.5">
                {skeletonRows.map((widths, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-3.5 rounded-xl animate-pulse">
                    <div className="w-11 h-11 rounded-xl bg-gray-200/80 dark:bg-gray-700/50 flex-shrink-0" />
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="h-3.5 rounded-lg bg-gray-200/80 dark:bg-gray-700/50" style={{ width: widths.title }} />
                      <div className="h-3 rounded-lg bg-gray-100 dark:bg-gray-800/60" style={{ width: widths.meta }} />
                    </div>
                    <div className="w-14 h-[30px] rounded-full bg-gray-200/80 dark:bg-gray-700/50 flex-shrink-0" />
                  </div>
                ))}
              </div>
            )}

            {/* Empty State */}
            {!isSearching && results.length === 0 && !error && (
              <div className="flex flex-col items-center justify-center py-14">
                <div className="w-14 h-14 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-3">
                  <svg className="w-7 h-7 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <p className="text-[15px] font-medium text-gray-500 dark:text-gray-400">{noResultsText}</p>
                <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Try adjusting your search terms</p>
                <button
                  onClick={performSearch}
                  className="mt-4 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                >
                  Search Again
                </button>
              </div>
            )}

            {/* Results List */}
            {!isSearching && results.length > 0 && (
              <div className="space-y-0.5">
                {results.map((result) => {
                  const score = Math.round(result.score);
                  const style = getScoreStyle(score);
                  const isUsenet = result.protocol === 'usenet';
                  const isAnnasArchive = isEbookMode && result.source === 'annas_archive';
                  const displayFormat = result.format || result.ebookFormat;

                  return (
                    <div
                      key={result.guid}
                      className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50/80 dark:hover:bg-white/[0.03] transition-colors group"
                    >
                      {/* Score Badge */}
                      <div
                        className={`flex-shrink-0 w-11 h-11 rounded-xl ${style.bg} flex flex-col items-center justify-center`}
                        title={`Score: ${score} (Match: ${Math.round(result.breakdown?.matchScore ?? 0)}, Format: ${Math.round(result.breakdown?.formatScore ?? 0)}, Size: ${Math.round(result.breakdown?.sizeScore ?? 0)}, Seeds: ${Math.round(result.breakdown?.seederScore ?? 0)})`}
                      >
                        <span className={`text-[15px] font-bold leading-none tabular-nums ${style.text}`}>
                          {score}
                        </span>
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        {/* Title Row */}
                        <div className="flex items-center gap-1.5">
                          <a
                            href={result.infoUrl || result.guid}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-medium text-gray-900 dark:text-white truncate hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                            title={result.title}
                          >
                            {result.title}
                          </a>
                        </div>

                        {/* Metadata Row */}
                        <div className="flex items-center gap-1 mt-0.5 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
                          {/* Rank */}
                          <span className="text-gray-400 dark:text-gray-500 font-medium">#{result.rank}</span>
                          <span className="text-gray-300 dark:text-gray-600 select-none">&middot;</span>

                          {/* Indexer / Source */}
                          {isAnnasArchive ? (
                            <span className="text-orange-600 dark:text-orange-400 font-medium">Anna&apos;s Archive</span>
                          ) : (
                            <span>{result.indexer}</span>
                          )}

                          {/* Size */}
                          {result.size > 0 && (
                            <>
                              <span className="text-gray-300 dark:text-gray-600 select-none">&middot;</span>
                              <span>{formatSize(result.size)}</span>
                            </>
                          )}

                          {/* Format */}
                          {displayFormat && (
                            <>
                              <span className="text-gray-300 dark:text-gray-600 select-none">&middot;</span>
                              <span className="px-1 py-px text-[10px] font-semibold uppercase tracking-wide rounded bg-purple-100 dark:bg-purple-500/15 text-purple-700 dark:text-purple-300">
                                {displayFormat}
                              </span>
                            </>
                          )}

                          {/* Protocol (torrent vs usenet) - only show for non-Anna's Archive */}
                          {!isAnnasArchive && (
                            <>
                              <span className="text-gray-300 dark:text-gray-600 select-none">&middot;</span>
                              {isUsenet ? (
                                <span className="flex items-center gap-0.5 text-sky-600 dark:text-sky-400">
                                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                                  </svg>
                                  NZB
                                </span>
                              ) : (
                                <span className="flex items-center gap-0.5">
                                  <svg className="w-3 h-3 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                                  </svg>
                                  <span className="text-emerald-600 dark:text-emerald-400">{result.seeders ?? 0}</span>
                                </span>
                              )}
                            </>
                          )}

                          {/* Age */}
                          {result.publishDate && (
                            <>
                              <span className="text-gray-300 dark:text-gray-600 select-none">&middot;</span>
                              <span>{formatAge(result.publishDate)}</span>
                            </>
                          )}

                          {/* Bonus Points */}
                          {result.bonusPoints > 0 && (
                            <>
                              <span className="text-gray-300 dark:text-gray-600 select-none">&middot;</span>
                              <span className="text-blue-600 dark:text-blue-400 font-medium">+{Math.round(result.bonusPoints)}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Action Button */}
                      <button
                        onClick={() => handleDownloadClick(result)}
                        disabled={isDownloading}
                        className="flex-shrink-0 px-4 py-1.5 text-[13px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 dark:bg-blue-400/10 dark:hover:bg-blue-400/20 rounded-full transition-all active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
                      >
                        Get
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Sticky Footer */}
        {!isSearching && results.length > 0 && (
          <div className="flex items-center justify-between px-5 py-3 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md border-t border-gray-200/50 dark:border-gray-700/50">
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {resultCountText(results.length)}
            </p>
            <button
              onClick={performSearch}
              disabled={isSearching}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors disabled:opacity-40"
            >
              Refresh
            </button>
          </div>
        )}

        {/* Inline Confirmation Overlay */}
        {confirmTorrent && (
          <div
            className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
            onClick={() => !isDownloading && setConfirmTorrent(null)}
          >
            <div
              className="mx-5 w-full max-w-sm bg-white dark:bg-gray-800 rounded-2xl shadow-2xl shadow-black/20 overflow-hidden animate-in zoom-in-95 duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Confirm Header */}
              <div className="px-5 pt-5 pb-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/10 dark:bg-blue-400/15 flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-[15px] font-semibold text-gray-900 dark:text-white">
                      {confirmModalTitle}
                    </h3>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                      This will start the download
                    </p>
                  </div>
                </div>

                {/* Selected Item Preview */}
                <div className="bg-gray-50 dark:bg-white/[0.04] rounded-xl px-3.5 py-3 border border-gray-100 dark:border-gray-700/50">
                  <p className="text-sm font-medium text-gray-900 dark:text-white leading-snug line-clamp-2">
                    {confirmTorrent.title}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1.5 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
                    <span>{confirmTorrent.indexer}</span>
                    {confirmTorrent.size > 0 && (
                      <>
                        <span className="text-gray-300 dark:text-gray-600">&middot;</span>
                        <span>{formatSize(confirmTorrent.size)}</span>
                      </>
                    )}
                    {confirmTorrent.format && (
                      <>
                        <span className="text-gray-300 dark:text-gray-600">&middot;</span>
                        <span className="uppercase font-medium">{confirmTorrent.format}</span>
                      </>
                    )}
                    {confirmTorrent.protocol === 'usenet' ? (
                      <>
                        <span className="text-gray-300 dark:text-gray-600">&middot;</span>
                        <span className="text-sky-600 dark:text-sky-400">NZB</span>
                      </>
                    ) : confirmTorrent.seeders !== undefined && (
                      <>
                        <span className="text-gray-300 dark:text-gray-600">&middot;</span>
                        <span className="text-emerald-600 dark:text-emerald-400">{confirmTorrent.seeders} seeds</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Confirm Actions */}
              <div className="flex border-t border-gray-200/80 dark:border-gray-700/50">
                <button
                  onClick={() => setConfirmTorrent(null)}
                  disabled={isDownloading}
                  className="flex-1 px-4 py-3 text-[15px] font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors disabled:opacity-40 border-r border-gray-200/80 dark:border-gray-700/50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmDownload}
                  disabled={isDownloading}
                  className="flex-1 px-4 py-3 text-[15px] font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors disabled:opacity-60"
                >
                  {isDownloading ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-blue-300 dark:border-blue-600 border-t-blue-600 dark:border-t-blue-400 rounded-full animate-spin" />
                      Downloading...
                    </span>
                  ) : (
                    'Download'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
