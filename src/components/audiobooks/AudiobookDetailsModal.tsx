/**
 * Component: Audiobook Details Modal
 * Documentation: documentation/frontend/components.md
 *
 * Premium modal design with mobile-first sticky actions
 * Matches the Apple-inspired card aesthetic
 */

'use client';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useAudiobookDetails } from '@/lib/hooks/useAudiobooks';
import { useCreateRequest, useEbookStatus, useFetchEbookByAsin } from '@/lib/hooks/useRequests';
import { useAuth } from '@/contexts/AuthContext';
import { usePreferences } from '@/contexts/PreferencesContext';
import { InteractiveTorrentSearchModal } from '@/components/requests/InteractiveTorrentSearchModal';
import { ReportIssueModal } from '@/components/audiobooks/ReportIssueModal';

interface AudiobookDetailsModalProps {
  asin: string;
  isOpen: boolean;
  onClose: () => void;
  onRequestSuccess?: () => void;
  isRequested?: boolean;
  requestStatus?: string | null;
  isAvailable?: boolean;
  requestedByUsername?: string | null;
  hideRequestActions?: boolean;
  hasReportedIssue?: boolean;
}

// Status helper
const getStatusInfo = (isAvailable: boolean, requestStatus: string | null, requestedByUsername: string | null) => {
  if (isAvailable || requestStatus === 'completed') {
    return { type: 'available', label: 'In Your Library', canRequest: false };
  }

  const processingStatuses = ['downloading', 'processing', 'downloaded', 'awaiting_import'];
  if (requestStatus && processingStatuses.includes(requestStatus)) {
    return { type: 'processing', label: 'Processing', canRequest: false };
  }

  const pendingStatuses = ['pending', 'awaiting_search', 'searching', 'awaiting_approval'];
  if (requestStatus && pendingStatuses.includes(requestStatus)) {
    const label = requestStatus === 'awaiting_approval'
      ? requestedByUsername ? `Pending Approval (${requestedByUsername})` : 'Pending Approval'
      : requestedByUsername ? `Requested by ${requestedByUsername}` : 'Requested';
    return { type: 'pending', label, canRequest: false };
  }

  if (requestStatus === 'denied') {
    return { type: 'denied', label: 'Request Denied', canRequest: true };
  }

  return { type: 'none', label: '', canRequest: true };
};

export function AudiobookDetailsModal({
  asin,
  isOpen,
  onClose,
  onRequestSuccess,
  isRequested = false,
  requestStatus = null,
  isAvailable = false,
  requestedByUsername = null,
  hideRequestActions = false,
  hasReportedIssue = false,
}: AudiobookDetailsModalProps) {
  const { user } = useAuth();
  const { squareCovers } = usePreferences();
  const { audiobook, audibleBaseUrl, isLoading, error } = useAudiobookDetails(isOpen ? asin : null);
  const { createRequest, isLoading: isRequesting } = useCreateRequest();
  const { ebookStatus, revalidate: revalidateEbookStatus } = useEbookStatus(isOpen && isAvailable ? asin : null);
  const { fetchEbook, isLoading: isFetchingEbook } = useFetchEbookByAsin();

  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error'>('success');
  const [mounted, setMounted] = useState(false);
  const [showInteractiveSearch, setShowInteractiveSearch] = useState(false);
  const [showInteractiveSearchEbook, setShowInteractiveSearchEbook] = useState(false);
  const [showReportIssue, setShowReportIssue] = useState(false);
  const [asinCopied, setAsinCopied] = useState(false);

  const status = getStatusInfo(isAvailable, requestStatus, requestedByUsername);
  const canShowEbookButtons = isAvailable && ebookStatus?.ebookSourcesEnabled && !ebookStatus?.hasActiveEbookRequest;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setToastMessage(message);
    setToastType(type);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3000);
  };

  const handleRequest = async () => {
    if (!user || !audiobook) {
      showNotification('Please log in to request audiobooks', 'error');
      return;
    }

    try {
      await createRequest(audiobook);
      showNotification('Request created!');
      setTimeout(onClose, 1500);
      onRequestSuccess?.();
    } catch (err) {
      showNotification(err instanceof Error ? err.message : 'Failed to create request', 'error');
    }
  };

  const handleInteractiveSearch = () => {
    if (!user || !audiobook) {
      showNotification('Please log in to request audiobooks', 'error');
      return;
    }
    setShowInteractiveSearch(true);
  };

  const handleFetchEbook = async () => {
    if (!user) {
      showNotification('Please log in to request ebooks', 'error');
      return;
    }

    try {
      const result = await fetchEbook(asin);
      revalidateEbookStatus();
      showNotification(result.needsApproval ? 'Ebook request submitted for approval!' : 'Ebook search started!');
    } catch (err) {
      showNotification(err instanceof Error ? err.message : 'Failed to request ebook', 'error');
    }
  };

  const handleCopyAsin = async () => {
    try {
      await navigator.clipboard.writeText(asin);
      setAsinCopied(true);
      setTimeout(() => setAsinCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy ASIN:', err);
    }
  };

  const formatDuration = (minutes?: number) => {
    if (!minutes) return null;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return null;
    try {
      return new Date(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return dateString;
    }
  };

  if (!isOpen || !mounted) return null;

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      style={{ height: '100dvh' }}
      onClick={onClose}
    >
      {/* Modal Container - uses dvh for PWA support */}
      <div
        className="relative w-full sm:max-w-2xl lg:max-w-3xl bg-white dark:bg-gray-900 sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-300"
        style={{
          maxHeight: 'calc(100dvh - env(safe-area-inset-top, 0px))',
          paddingTop: 'env(safe-area-inset-top, 0px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile: Sticky Header with Close */}
        <div className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md border-b border-gray-200/50 dark:border-gray-700/50 sm:hidden">
          <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Audiobook Details</span>
          <button
            onClick={onClose}
            className="p-2 -mr-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Desktop: Close Button */}
        <button
          onClick={onClose}
          className="hidden sm:flex absolute top-4 right-4 z-20 p-2 rounded-full bg-gray-100/80 dark:bg-gray-800/80 backdrop-blur-sm hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          aria-label="Close"
        >
          <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {/* Loading State */}
          {isLoading && (
            <div className="flex items-center justify-center min-h-[400px]">
              <div className="w-10 h-10 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {/* Error State */}
          {error && !isLoading && (
            <div className="p-8 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <p className="text-gray-900 dark:text-gray-100 font-medium">Failed to load details</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Please try again later</p>
            </div>
          )}

          {/* Content */}
          {audiobook && !isLoading && (
            <div className="p-4 sm:p-6 lg:p-8">
              {/* Hero Section - Cover + Title/Author */}
              <div className="flex flex-col sm:flex-row gap-5 sm:gap-6">
                {/* Cover Art */}
                <div className="flex-shrink-0 mx-auto sm:mx-0">
                  <div className={`
                    relative overflow-hidden rounded-2xl shadow-xl shadow-black/20 dark:shadow-black/40
                    ${squareCovers ? 'w-40 sm:w-44 lg:w-52 aspect-square' : 'w-32 sm:w-40 lg:w-48 aspect-[2/3]'}
                    ${status.type === 'available' ? 'ring-2 ring-emerald-400/60' : ''}
                  `}>
                    {audiobook.coverArtUrl ? (
                      <Image
                        src={audiobook.coverArtUrl}
                        alt=""
                        fill
                        className="object-cover"
                        sizes="200px"
                        priority
                      />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-800 flex items-center justify-center">
                        <svg className="w-12 h-12 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                        </svg>
                      </div>
                    )}

                    {/* Rating Badge */}
                    {audiobook.rating && audiobook.rating > 0 && (
                      <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-1 rounded-lg bg-black/60 backdrop-blur-sm text-white text-xs font-medium">
                        <svg className="w-3.5 h-3.5 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                        <span>{audiobook.rating.toFixed(1)}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Title & Author */}
                <div className="flex-1 text-center sm:text-left min-w-0">
                  <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-900 dark:text-gray-100 leading-tight">
                    {audiobook.title}
                  </h2>
                  <p className="mt-2 text-base sm:text-lg text-gray-600 dark:text-gray-300">
                    {audiobook.authorAsin ? (
                      <Link
                        href={`/authors/${audiobook.authorAsin}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onClose();
                        }}
                        className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                      >
                        {audiobook.author}
                      </Link>
                    ) : (
                      audiobook.author
                    )}
                  </p>
                  {audiobook.narrator && (
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      Narrated by {audiobook.narrator}
                    </p>
                  )}
                  {audiobook.series && (
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      {audiobook.seriesAsin ? (
                        <Link
                          href={`/series/${audiobook.seriesAsin}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onClose();
                          }}
                          className="hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                        >
                          {audiobook.series}{audiobook.seriesPart ? `, Book ${audiobook.seriesPart}` : ''}
                        </Link>
                      ) : (
                        <span>{audiobook.series}{audiobook.seriesPart ? `, Book ${audiobook.seriesPart}` : ''}</span>
                      )}
                    </p>
                  )}

                  {/* Status Badge */}
                  {status.type !== 'none' && (
                    <div className="mt-4 inline-flex">
                      <span className={`
                        inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium
                        ${status.type === 'available' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' : ''}
                        ${status.type === 'processing' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' : ''}
                        ${status.type === 'pending' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' : ''}
                        ${status.type === 'denied' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' : ''}
                      `}>
                        {status.type === 'available' && (
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                        )}
                        {status.type === 'processing' && (
                          <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                        )}
                        {status.label}
                      </span>
                    </div>
                  )}

                  {/* Issue Reported Badge */}
                  {isAvailable && hasReportedIssue && (
                    <div className="mt-2 inline-flex">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
                        </svg>
                        Issue Reported
                      </span>
                    </div>
                  )}

                  {/* Report Issue Button - inline with metadata, not in action bar */}
                  {isAvailable && !hasReportedIssue && user && (
                    <div className="mt-2 inline-flex">
                      <button
                        onClick={() => setShowReportIssue(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
                        </svg>
                        Report Issue
                      </button>
                    </div>
                  )}

                  {/* Quick Metadata */}
                  <div className="mt-4 flex flex-wrap items-center justify-center sm:justify-start gap-3 text-sm text-gray-500 dark:text-gray-400">
                    {audiobook.durationMinutes && (
                      <span className="flex items-center gap-1">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {formatDuration(audiobook.durationMinutes)}
                      </span>
                    )}
                    {audiobook.releaseDate && (
                      <span>{formatDate(audiobook.releaseDate)}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Genres */}
              {audiobook.genres && audiobook.genres.length > 0 && (
                <div className="mt-6 flex flex-wrap gap-2">
                  {audiobook.genres.map((genre: string) => (
                    <span
                      key={genre}
                      className="px-3 py-1 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm rounded-full"
                    >
                      {genre}
                    </span>
                  ))}
                </div>
              )}

              {/* Description */}
              {audiobook.description && (
                <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700/50">
                  <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                    Summary
                  </h3>
                  <p className="text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap text-[15px]">
                    {audiobook.description}
                  </p>
                </div>
              )}

              {/* Details Grid */}
              <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700/50">
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                  Details
                </h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {/* ASIN */}
                  <div>
                    <p className="text-gray-500 dark:text-gray-400">ASIN</p>
                    <button
                      onClick={handleCopyAsin}
                      className="flex items-center gap-1.5 font-mono text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                    >
                      {asin}
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        {asinCopied ? (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        ) : (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        )}
                      </svg>
                    </button>
                  </div>

                  {/* Audible Link */}
                  <div>
                    <p className="text-gray-500 dark:text-gray-400">Source</p>
                    <a
                      href={`${audibleBaseUrl}/pd/${asin}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-orange-600 dark:text-orange-400 hover:underline"
                    >
                      Audible
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  </div>
                </div>
              </div>

              {/* Ebook Status */}
              {ebookStatus?.hasActiveEbookRequest && (
                <div className="mt-4 p-3 rounded-xl bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800/50">
                  <div className="flex items-center gap-2 text-orange-700 dark:text-orange-400 text-sm">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                    <span>
                      Ebook: {ebookStatus.existingEbookStatus === 'awaiting_approval'
                        ? 'Pending Approval'
                        : ebookStatus.existingEbookStatus === 'available' || ebookStatus.existingEbookStatus === 'downloaded'
                          ? 'Available'
                          : 'In Progress'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sticky Action Bar - hidden when opened from bookdate */}
        {audiobook && !isLoading && !hideRequestActions && (
          <div
            className="sticky bottom-0 z-20 p-4 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md border-t border-gray-200/50 dark:border-gray-700/50"
            style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
          >
            <div className="flex items-center gap-3">
              {/* Main Action */}
              <div className="flex-1">
                {status.type === 'available' ? (
                  <button
                    disabled
                    className="w-full py-3 px-4 rounded-xl font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/30"
                  >
                    In Your Library
                  </button>
                ) : status.canRequest ? (
                  <button
                    onClick={handleRequest}
                    disabled={isRequesting || !user}
                    className="w-full py-3 px-4 rounded-xl font-semibold text-white bg-blue-600 hover:bg-blue-700 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isRequesting ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Requesting...
                      </span>
                    ) : !user ? 'Sign in to Request' : 'Request Audiobook'}
                  </button>
                ) : (
                  <button
                    disabled
                    className={`
                      w-full py-3 px-4 rounded-xl font-semibold
                      ${status.type === 'processing' ? 'text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30' : ''}
                      ${status.type === 'pending' ? 'text-blue-700 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30' : ''}
                      ${status.type === 'denied' ? 'text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-900/30' : ''}
                    `}
                  >
                    {status.type === 'processing' && (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Processing
                      </span>
                    )}
                    {status.type === 'pending' && status.label}
                    {status.type === 'denied' && 'Request Denied'}
                  </button>
                )}
              </div>

              {/* Interactive Search - only if not available and user has permission */}
              {status.type !== 'available' && (user?.role === 'admin' || user?.permissions?.interactiveSearch !== false) && (
                <button
                  onClick={handleInteractiveSearch}
                  disabled={!user}
                  className="p-3 rounded-xl bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 hover:bg-purple-200 dark:hover:bg-purple-900/50 transition-colors disabled:opacity-50"
                  title="Interactive Search"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </button>
              )}

              {/* Ebook Buttons - only when available and enabled */}
              {canShowEbookButtons && user && (
                <>
                  <button
                    onClick={handleFetchEbook}
                    disabled={isFetchingEbook}
                    className="p-3 rounded-xl bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 hover:bg-orange-200 dark:hover:bg-orange-900/50 transition-colors disabled:opacity-50"
                    title="Grab Ebook"
                  >
                    {isFetchingEbook ? (
                      <svg className="w-6 h-6 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                      </svg>
                    )}
                  </button>
                  {(user?.role === 'admin' || user?.permissions?.interactiveSearch !== false) && (
                    <button
                      onClick={() => setShowInteractiveSearchEbook(true)}
                      className="p-3 rounded-xl bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 hover:bg-orange-200 dark:hover:bg-orange-900/50 transition-colors"
                      title="Search Ebook Sources"
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                      </svg>
                    </button>
                  )}
                </>
              )}

            </div>
          </div>
        )}

        {/* Toast Notification */}
        {showToast && (
          <div className={`
            absolute bottom-20 left-1/2 -translate-x-1/2 z-30
            px-4 py-2.5 rounded-xl shadow-lg backdrop-blur-md
            ${toastType === 'success' ? 'bg-emerald-500/95 text-white' : 'bg-red-500/95 text-white'}
            animate-in fade-in slide-in-from-bottom-2 duration-200
          `}>
            <p className="text-sm font-medium whitespace-nowrap">{toastMessage}</p>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {createPortal(modalContent, document.body)}

      {/* Interactive Search Modal (Audiobook) */}
      {showInteractiveSearch && audiobook && createPortal(
        <div className="fixed inset-0 z-[60]">
          <InteractiveTorrentSearchModal
            isOpen={showInteractiveSearch}
            onClose={() => {
              setShowInteractiveSearch(false);
              onClose();
            }}
            onSuccess={() => {
              onRequestSuccess?.();
            }}
            audiobook={{
              title: audiobook.title,
              author: audiobook.author,
            }}
            fullAudiobook={audiobook}
          />
        </div>,
        document.body
      )}

      {/* Interactive Search Modal (Ebook) */}
      {showInteractiveSearchEbook && audiobook && createPortal(
        <div className="fixed inset-0 z-[60]">
          <InteractiveTorrentSearchModal
            isOpen={showInteractiveSearchEbook}
            onClose={() => {
              setShowInteractiveSearchEbook(false);
              revalidateEbookStatus();
            }}
            onSuccess={() => {
              revalidateEbookStatus();
              showNotification('Ebook download started!');
            }}
            asin={asin}
            audiobook={{
              title: audiobook.title,
              author: audiobook.author,
            }}
            searchMode="ebook"
          />
        </div>,
        document.body
      )}

      {/* Report Issue Modal */}
      {showReportIssue && audiobook && (
        <ReportIssueModal
          isOpen={showReportIssue}
          onClose={() => setShowReportIssue(false)}
          onSuccess={() => {
            setShowReportIssue(false);
            showNotification('Issue reported!');
          }}
          asin={asin}
          bookTitle={audiobook.title}
          bookAuthor={audiobook.author}
          coverArtUrl={audiobook.coverArtUrl}
        />
      )}
    </>
  );
}
