/**
 * Component: Adjust Search Terms Modal
 * Documentation: documentation/admin-dashboard.md
 */

'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { fetchWithAuth } from '@/lib/utils/api';
import { useToast } from '@/components/ui/Toast';

interface AdjustSearchTermsModalProps {
  isOpen: boolean;
  onClose: () => void;
  requestId: string;
  title: string;
  author: string;
  currentSearchTerms?: string | null;
  onSuccess?: () => void;
}

export function AdjustSearchTermsModal({
  isOpen,
  onClose,
  requestId,
  title,
  author,
  currentSearchTerms,
  onSuccess,
}: AdjustSearchTermsModalProps) {
  const toast = useToast();
  const [searchTerms, setSearchTerms] = useState(currentSearchTerms || title);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingAndSearching, setIsSavingAndSearching] = useState(false);

  // Reset state when modal opens
  const handleClose = () => {
    setSearchTerms(currentSearchTerms || title);
    onClose();
  };

  const save = async (triggerSearch: boolean) => {
    const setter = triggerSearch ? setIsSavingAndSearching : setIsSaving;
    setter(true);

    try {
      // If terms match the original title, clear the override
      const termsToSave = searchTerms.trim() === title ? null : searchTerms.trim() || null;

      const response = await fetchWithAuth(`/api/admin/requests/${requestId}/search-terms`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ searchTerms: termsToSave, triggerSearch }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to update search terms');
      }

      const data = await response.json();

      if (data.searchTriggered) {
        toast.success('Search terms saved and search triggered');
      } else {
        toast.success('Search terms saved');
      }

      onSuccess?.();
      onClose();
    } catch (error) {
      toast.error(`Failed to save: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setter(false);
    }
  };

  const handleReset = () => {
    setSearchTerms(title);
  };

  const isLoading = isSaving || isSavingAndSearching;
  const hasChanges = searchTerms.trim() !== (currentSearchTerms || title);
  const isCustom = searchTerms.trim() !== title;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Adjust Search Terms" size="sm">
      <div className="space-y-4">
        {/* Original info */}
        <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3 space-y-1">
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Original Title
          </div>
          <div className="text-sm text-gray-900 dark:text-gray-100 font-medium">{title}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">by {author}</div>
        </div>

        {/* Search terms input */}
        <div>
          <label
            htmlFor="search-terms"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
          >
            Search Terms
          </label>
          <input
            id="search-terms"
            type="text"
            value={searchTerms}
            onChange={(e) => setSearchTerms(e.target.value)}
            disabled={isLoading}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
            placeholder="Enter custom search terms..."
          />
          {isCustom && (
            <button
              onClick={handleReset}
              disabled={isLoading}
              className="mt-1.5 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors disabled:opacity-50"
            >
              Reset to original title
            </button>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={handleClose}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => save(false)}
            disabled={isLoading || !searchTerms.trim()}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={() => save(true)}
            disabled={isLoading || !searchTerms.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
          >
            {isSavingAndSearching ? 'Saving...' : 'Save & Search'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
