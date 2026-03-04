/**
 * Component: Add Shelf Modal
 * Documentation: documentation/frontend/components.md
 */

'use client';

import React, { useState } from 'react';
import { Modal } from './Modal';
import { Input } from './Input';
import { Button } from './Button';
import { useAddGoodreadsShelf } from '@/lib/hooks/useGoodreadsShelves';
import { useAddHardcoverShelf } from '@/lib/hooks/useHardcoverShelves';

interface AddShelfModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const GOODREADS_RSS_PATTERN = /goodreads\.com\/review\/list_rss\//;

export function AddShelfModal({ isOpen, onClose }: AddShelfModalProps) {
  const [provider, setProvider] = useState<'goodreads' | 'hardcover'>(
    'goodreads',
  );

  // Goodreads State
  const [rssUrl, setRssUrl] = useState('');

  // Hardcover State
  const [apiToken, setApiToken] = useState('');
  const [listType, setListType] = useState<'status' | 'custom'>('status');
  const [statusId, setStatusId] = useState('1'); // 1 = Want to Read
  const [customListId, setCustomListId] = useState('');

  const [validationError, setValidationError] = useState('');
  const [success, setSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const {
    addShelf: addGoodreads,
    isLoading: isGoodreadsLoading,
    error: goodreadsError,
  } = useAddGoodreadsShelf();
  const {
    addShelf: addHardcover,
    isLoading: isHardcoverLoading,
    error: hardcoverError,
  } = useAddHardcoverShelf();

  const isLoading = isGoodreadsLoading || isHardcoverLoading;
  const currentError =
    provider === 'goodreads' ? goodreadsError : hardcoverError;

  const validateInput = (): boolean => {
    if (provider === 'goodreads') {
      if (!rssUrl.trim()) {
        setValidationError('RSS URL is required');
        return false;
      }
      if (!GOODREADS_RSS_PATTERN.test(rssUrl)) {
        setValidationError(
          'Must be a Goodreads shelf RSS URL (goodreads.com/review/list_rss/...)',
        );
        return false;
      }
    } else {
      if (!apiToken.trim()) {
        setValidationError('Hardcover API Token is required');
        return false;
      }
      if (listType === 'custom' && !customListId.trim()) {
        setValidationError('Hardcover List URL or Slug is required');
        return false;
      }
    }
    setValidationError('');
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateInput()) return;

    try {
      if (provider === 'goodreads') {
        const shelf = await addGoodreads(rssUrl);
        setSuccessMessage(`Added shelf "${shelf.name}" successfully!`);
        setRssUrl('');
      } else {
        const finalId =
          listType === 'status' ? `status-${statusId}` : customListId.trim();
        let cleanedToken = apiToken.trim();
        if (cleanedToken.toLowerCase().startsWith('bearer ')) {
          cleanedToken = cleanedToken.slice(7).trim();
        }
        const shelf = await addHardcover(cleanedToken, finalId);
        setSuccessMessage(`Added list "${shelf.name}" successfully!`);
        setApiToken('');
        setCustomListId('');
      }

      setSuccess(true);

      setTimeout(() => {
        setSuccess(false);
        onClose();
      }, 2000);
    } catch {
      // Error is handled by the hooks
    }
  };

  const handleClose = () => {
    setRssUrl('');
    setApiToken('');
    setCustomListId('');
    setValidationError('');
    setSuccess(false);
    setSuccessMessage('');
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Add Shelf" size="sm">
      <div className="space-y-5">
        {/* Provider Selection Tabs */}
        <div className="flex p-1 bg-gray-100 dark:bg-gray-800 rounded-lg">
          <button
            type="button"
            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${
              provider === 'goodreads'
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm ring-1 ring-gray-200 dark:ring-gray-600'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
            onClick={() => {
              setProvider('goodreads');
              setValidationError('');
            }}
          >
            Goodreads
          </button>
          <button
            type="button"
            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${
              provider === 'hardcover'
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm ring-1 ring-gray-200 dark:ring-gray-600'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
            onClick={() => {
              setProvider('hardcover');
              setValidationError('');
            }}
          >
            Hardcover
          </button>
        </div>

        {/* Visual header */}
        <div className="flex items-center gap-4 pb-4 border-b border-gray-100 dark:border-gray-700/50">
          {provider === 'goodreads' ? (
            <>
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-500/10 dark:to-orange-500/10 flex items-center justify-center ring-1 ring-amber-200/50 dark:ring-amber-500/10 flex-shrink-0">
                <img
                  src="/goodreads-icon.png"
                  alt="Goodreads"
                  className="w-5 h-5 object-contain"
                />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                  Paste your Goodreads shelf RSS URL. Books will be
                  automatically requested.
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-50 to-blue-50 dark:from-indigo-500/10 dark:to-blue-500/10 flex items-center justify-center ring-1 ring-indigo-200/50 dark:ring-indigo-500/10 flex-shrink-0">
                <img
                  src="/hardcover-icon.svg"
                  alt="Hardcover"
                  className="w-6 h-6 object-contain"
                />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                  Provide your Hardcover API token and select the list you want
                  to sync.
                </p>
              </div>
            </>
          )}
        </div>

        {/* Success alert */}
        {success && (
          <div className="flex items-center gap-3 p-3.5 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-xl">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
              <svg
                className="w-4 h-4 text-emerald-600 dark:text-emerald-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
              {successMessage}
            </p>
          </div>
        )}

        {/* Error alert */}
        {currentError && (
          <div className="flex items-center gap-3 p-3.5 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl">
            <div className="w-8 h-8 rounded-lg bg-red-100 dark:bg-red-500/20 flex items-center justify-center flex-shrink-0">
              <svg
                className="w-4 h-4 text-red-600 dark:text-red-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                />
              </svg>
            </div>
            <p className="text-sm font-medium text-red-700 dark:text-red-300">
              {currentError}
            </p>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          {provider === 'goodreads' ? (
            <div>
              <Input
                type="url"
                label="Goodreads RSS URL"
                value={rssUrl}
                onChange={(e) => {
                  setRssUrl(e.target.value);
                  if (validationError) setValidationError('');
                }}
                placeholder="https://www.goodreads.com/review/list_rss/..."
                error={validationError}
                disabled={isLoading || success}
              />
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 leading-relaxed">
                Find it on Goodreads: My Books &rarr; select a shelf &rarr; RSS
                link at the bottom of the page.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <Input
                type="text"
                label="API Token"
                value={apiToken}
                onChange={(e) => {
                  setApiToken(e.target.value);
                  if (validationError) setValidationError('');
                }}
                placeholder="eyJhb..."
                disabled={isLoading || success}
              />

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  List to Sync
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      className="form-radio text-indigo-600"
                      checked={listType === 'status'}
                      onChange={() => setListType('status')}
                      disabled={isLoading || success}
                    />
                    <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                      My Status
                    </span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      className="form-radio text-indigo-600"
                      checked={listType === 'custom'}
                      onChange={() => setListType('custom')}
                      disabled={isLoading || success}
                    />
                    <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                      Custom List
                    </span>
                  </label>
                </div>
              </div>

              {listType === 'status' ? (
                <div>
                  <select
                    className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-gray-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    value={statusId}
                    onChange={(e) => setStatusId(e.target.value)}
                    disabled={isLoading || success}
                  >
                    <option value="1">Want to Read</option>
                    <option value="2">Currently Reading</option>
                    <option value="3">Read</option>
                    <option value="4">Did Not Finish</option>
                  </select>
                </div>
              ) : (
                <Input
                  type="text"
                  label="List URL or Slug"
                  value={customListId}
                  onChange={(e) => {
                    setCustomListId(e.target.value);
                    if (validationError) setValidationError('');
                  }}
                  placeholder="https://hardcover.app/@username/lists/..."
                  error={validationError}
                  disabled={isLoading || success}
                />
              )}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClose}
              disabled={isLoading || success}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={isLoading}
              disabled={isLoading || success}
            >
              Add Shelf
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
