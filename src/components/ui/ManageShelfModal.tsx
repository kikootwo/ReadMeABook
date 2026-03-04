'use client';

import React, { useState } from 'react';
import { Modal } from './Modal';
import { GenericShelf } from '@/lib/hooks/useShelves';
import { useUpdateGoodreadsShelf } from '@/lib/hooks/useGoodreadsShelves';
import { useUpdateHardcoverShelf } from '@/lib/hooks/useHardcoverShelves';
import { cn } from '@/lib/utils/cn';

interface ManageShelfModalProps {
  shelf: GenericShelf | null;
  isOpen: boolean;
  onClose: () => void;
}

export function ManageShelfModal({ shelf, isOpen, onClose }: ManageShelfModalProps) {
  const [rssUrl, setRssUrl] = useState(shelf?.type === 'goodreads' ? shelf.sourceId : '');
  const [listId, setListId] = useState(shelf?.type === 'hardcover' ? shelf.sourceId : '');
  const [apiToken, setApiToken] = useState('');

  const { updateShelf: updateGoodreads, isLoading: isUpdatingGoodreads } = useUpdateGoodreadsShelf();
  const { updateShelf: updateHardcover, isLoading: isUpdatingHardcover } = useUpdateHardcoverShelf();

  // Reset form when shelf changes
  React.useEffect(() => {
    if (shelf) {
      setRssUrl(shelf.type === 'goodreads' ? shelf.sourceId : '');
      setListId(shelf.type === 'hardcover' ? shelf.sourceId : '');
      setApiToken('');
    }
  }, [shelf]);

  if (!shelf) return null;

  const isUpdating = isUpdatingGoodreads || isUpdatingHardcover;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (shelf.type === 'goodreads') {
        if (!rssUrl.trim()) return;
        await updateGoodreads(shelf.id, rssUrl.trim());
      } else {
        if (!listId.trim()) return;
        await updateHardcover(shelf.id, {
          listId: listId.trim(),
          apiToken: apiToken.trim() || undefined,
        });
      }
      onClose();
    } catch (err) {
      // Error is handled by hook
    }
  };

  const isGoodreads = shelf.type === 'goodreads';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Manage ${shelf.name}`}>
      <div className="space-y-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          {isGoodreads ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Goodreads RSS URL
              </label>
              <input
                type="url"
                required
                value={rssUrl}
                onChange={(e) => setRssUrl(e.target.value)}
                placeholder="https://www.goodreads.com/review/list_rss/..."
                className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-800/50 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 dark:focus:ring-emerald-400 dark:text-white transition-colors"
                disabled={isUpdating}
              />
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Hardcover List ID or Slug
                </label>
                <input
                  type="text"
                  required
                  value={listId}
                  onChange={(e) => setListId(e.target.value)}
                  placeholder="e.g., 1234, want-to-read, status-1"
                  className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-800/50 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:focus:ring-indigo-400 dark:text-white transition-colors"
                  disabled={isUpdating}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  New API Token <span className="text-gray-400 dark:text-gray-500 font-normal">(Leave blank to keep current)</span>
                </label>
                <input
                  type="password"
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  placeholder="Paste your Hardcover token here..."
                  className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-800/50 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:focus:ring-indigo-400 dark:text-white transition-colors"
                  disabled={isUpdating}
                />
              </div>
            </>
          )}

          <div className="flex gap-3 justify-end pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              disabled={isUpdating}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isUpdating}
              className={cn(
                'px-6 py-2 text-sm font-medium text-white rounded-xl shadow-sm transition-colors',
                isGoodreads
                  ? 'bg-amber-600 hover:bg-amber-700'
                  : 'bg-indigo-600 hover:bg-indigo-700',
                isUpdating && 'opacity-50 cursor-not-allowed',
              )}
            >
              {isUpdating ? 'Saving...' : 'Update & Re-sync'}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
