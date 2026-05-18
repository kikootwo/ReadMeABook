/**
 * Component: Clear Filtered Confirm Modal
 * Documentation: documentation/admin-features/release-blocklist.md
 *
 * Bulk-clear guardrail: admin must type "CLEAR" before the destructive button
 * activates. UI-only friction (not a server security boundary — auth+admin is).
 * Per product brief: "red confirmation modal, requires typing 'CLEAR' or similar."
 */

'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { fetchWithAuth } from '@/lib/utils/api';

const REQUIRED_TOKEN = 'CLEAR';

interface ClearFilteredConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCleared: () => void;
  total: number;
  filtersActive: boolean;
  /** Pre-built filter query string (no page/limit/sort) — DELETE body. */
  queryString: string;
}

export function ClearFilteredConfirmModal({
  isOpen,
  onClose,
  onCleared,
  total,
  filtersActive,
  queryString,
}: ClearFilteredConfirmModalProps) {
  const toast = useToast();
  const [token, setToken] = useState('');
  const [isClearing, setIsClearing] = useState(false);

  // Reset typed token whenever the modal opens.
  useEffect(() => {
    if (isOpen) setToken('');
  }, [isOpen]);

  const canConfirm = token.trim().toUpperCase() === REQUIRED_TOKEN && !isClearing;

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setIsClearing(true);
    try {
      const url = queryString
        ? `/api/admin/blocklist?${queryString}`
        : '/api/admin/blocklist';
      const response = await fetchWithAuth(url, { method: 'DELETE' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to clear blocklist');
      }
      const { count } = await response.json();
      toast.success(
        count === 1
          ? 'Unblocked 1 release'
          : `Unblocked ${count.toLocaleString()} releases`
      );
      onCleared();
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to clear blocklist'
      );
    } finally {
      setIsClearing(false);
    }
  };

  const title = filtersActive ? 'Clear filtered entries' : 'Clear all entries';
  const description = filtersActive
    ? `This will unblock ${total.toLocaleString()} ${total === 1 ? 'release' : 'releases'} matching the current filters. Future searches will be free to grab them again.`
    : `This will unblock all ${total.toLocaleString()} ${total === 1 ? 'release' : 'releases'} in the blocklist. Future searches will be free to grab them again.`;

  return (
    <Modal isOpen={isOpen} onClose={isClearing ? () => {} : onClose} title={title} size="sm" showCloseButton={false}>
      <div className="space-y-5">
        <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
          {description}
        </p>

        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/60 px-4 py-3">
          <p className="text-sm font-medium text-red-800 dark:text-red-200">
            This cannot be undone.
          </p>
          <p className="text-xs text-red-700 dark:text-red-300 mt-1">
            Type <span className="font-mono font-bold">CLEAR</span> below to confirm.
          </p>
        </div>

        <div>
          <label
            htmlFor="blocklist-clear-token"
            className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5"
          >
            Confirmation
          </label>
          <input
            id="blocklist-clear-token"
            type="text"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={isClearing}
            autoComplete="off"
            placeholder="Type CLEAR"
            aria-label="Type CLEAR to confirm"
            className="w-full px-3 py-2.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-red-500 focus:outline-none text-sm font-mono uppercase min-h-[44px]"
          />
        </div>

        <div className="flex gap-3 justify-end">
          <Button onClick={onClose} variant="outline" disabled={isClearing}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            variant="danger"
            loading={isClearing}
            disabled={!canConfirm}
          >
            {filtersActive ? `Clear ${total.toLocaleString()}` : `Clear all ${total.toLocaleString()}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
