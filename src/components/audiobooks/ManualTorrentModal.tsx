/**
 * Component: Manual Torrent Modal
 * Documentation: documentation/phase3/manual-torrent-download.md
 *
 * Sub-modal for attaching a user-supplied magnet link or .torrent file to an
 * existing request. Rendered via portal at z-[60] to layer above
 * AudiobookDetailsModal.
 */

'use client';

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchWithAuth } from '@/lib/utils/api';

/** Keep in sync with MAX_TORRENT_FILE_BYTES in the manual-download route */
const MAX_TORRENT_FILE_BYTES = 5 * 1024 * 1024;

interface ManualTorrentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  requestId: string;
  bookTitle: string;
}

export function ManualTorrentModal({
  isOpen,
  onClose,
  onSuccess,
  requestId,
  bookTitle,
}: ManualTorrentModalProps) {
  const [magnet, setMagnet] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = (magnet.trim().length > 0 || !!file) && !isSubmitting;

  const reset = () => {
    setMagnet('');
    setFile(null);
    setError(null);
    setIsDragging(false);
  };

  const handleClose = () => {
    if (isSubmitting) return;
    reset();
    onClose();
  };

  const acceptFile = (selected: File | null | undefined) => {
    if (!selected) return;

    if (!selected.name.toLowerCase().endsWith('.torrent')) {
      setError('File must be a .torrent file');
      return;
    }
    if (selected.size > MAX_TORRENT_FILE_BYTES) {
      setError('.torrent file must be 5 MB or smaller');
      return;
    }

    setError(null);
    setFile(selected);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const formData = new FormData();
      if (file) {
        formData.append('file', file);
      } else {
        formData.append('magnet', magnet.trim());
      }

      const response = await fetchWithAuth(`/api/requests/${requestId}/manual-download`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.message || 'Failed to start manual download');
      }

      reset();
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start manual download');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const modalContent = (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={handleClose}
    >
      <div
        className="mx-5 w-full max-w-sm bg-white dark:bg-gray-800 rounded-2xl shadow-2xl shadow-black/20 overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 dark:bg-blue-400/15 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5m6.5-6.5l1.5-1.5a4 4 0 115.656 5.656l-3 3a4 4 0 01-5.656 0" />
              </svg>
            </div>
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold text-gray-900 dark:text-white">
                Manual Torrent
              </h3>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">
                {bookTitle}
              </p>
            </div>
          </div>

          {/* Magnet link */}
          <div className="space-y-2">
            <label htmlFor="manual-torrent-magnet" className="block text-xs font-medium text-gray-500 dark:text-gray-400 px-1">
              Magnet link
            </label>
            <input
              id="manual-torrent-magnet"
              type="text"
              value={magnet}
              onChange={(e) => {
                setMagnet(e.target.value);
                if (error) setError(null);
              }}
              placeholder="magnet:?xt=urn:btih:..."
              disabled={isSubmitting || !!file}
              className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-white/[0.06] rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-blue-500/40 focus:ring-1 focus:ring-blue-500/20 transition-all disabled:opacity-50"
            />
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 my-3">
            <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
            <span className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">or</span>
            <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
          </div>

          {/* .torrent upload */}
          <label
            htmlFor="manual-torrent-file"
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              acceptFile(e.dataTransfer?.files?.[0]);
            }}
            className={`block px-3.5 py-4 rounded-xl border border-dashed text-center cursor-pointer transition-colors ${
              isDragging
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10'
                : 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-white/[0.06] hover:border-blue-400'
            } ${isSubmitting || magnet.trim() ? 'opacity-50 pointer-events-none' : ''}`}
          >
            <span className="block text-sm text-gray-700 dark:text-gray-200 truncate">
              {file ? file.name : 'Drop a .torrent file or browse'}
            </span>
            <span className="block text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">Max 5 MB</span>
            <input
              id="manual-torrent-file"
              type="file"
              accept=".torrent"
              className="hidden"
              disabled={isSubmitting || !!magnet.trim()}
              onChange={(e) => acceptFile(e.target.files?.[0])}
            />
          </label>

          {file && (
            <button
              onClick={() => setFile(null)}
              disabled={isSubmitting}
              className="mt-2 text-xs text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors px-1"
            >
              Remove file
            </button>
          )}

          <div className="min-h-[1.25rem] mt-2 px-1">
            {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
          </div>
        </div>

        {/* Actions */}
        <div className="flex border-t border-gray-200/80 dark:border-gray-700/50">
          <button
            onClick={handleClose}
            disabled={isSubmitting}
            className="flex-1 px-4 py-3 text-[15px] font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors disabled:opacity-40 border-r border-gray-200/80 dark:border-gray-700/50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex-1 px-4 py-3 text-[15px] font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-blue-300 dark:border-blue-600 border-t-blue-600 dark:border-t-blue-400 rounded-full animate-spin" />
                Starting...
              </span>
            ) : (
              'Start Download'
            )}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
