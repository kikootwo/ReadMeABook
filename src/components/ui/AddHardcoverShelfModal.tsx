/**
 * Component: Add Hardcover Shelf Modal
 * Documentation: documentation/frontend/components.md
 */

'use client';

import React, { useState } from 'react';
import { Modal } from './Modal';
import { Input } from './Input';
import { Button } from './Button';
import { useAddHardcoverShelf } from '@/lib/hooks/useHardcoverShelves';

interface AddHardcoverShelfModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AddHardcoverShelfModal({
  isOpen,
  onClose,
}: AddHardcoverShelfModalProps) {
  const [apiToken, setApiToken] = useState('');
  const [listId, setListId] = useState('');
  const [validationError, setValidationError] = useState('');
  const [success, setSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const { addShelf, isLoading, error } = useAddHardcoverShelf();

  const validateInput = (): boolean => {
    if (!apiToken.trim()) {
      setValidationError('Hardcover API Token is required');
      return false;
    }
    if (!listId.trim()) {
      setValidationError('Hardcover List ID or Status ID is required');
      return false;
    }
    setValidationError('');
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateInput()) return;

    try {
      const shelf = await addShelf(apiToken.trim(), listId.trim());
      setSuccess(true);
      setSuccessMessage(`Added list "${shelf.name}" successfully!`);
      setApiToken('');
      setListId('');

      setTimeout(() => {
        setSuccess(false);
        onClose();
      }, 2000);
    } catch {
      // Error is handled by the hook
    }
  };

  const handleClose = () => {
    setApiToken('');
    setListId('');
    setValidationError('');
    setSuccess(false);
    setSuccessMessage('');
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Add Hardcover List"
      size="sm"
    >
      <div className="space-y-5">
        {/* Visual header */}
        <div className="flex items-center gap-4 pb-4 border-b border-gray-100 dark:border-gray-700/50">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-50 to-blue-50 dark:from-indigo-500/10 dark:to-blue-500/10 flex items-center justify-center ring-1 ring-indigo-200/50 dark:ring-indigo-500/10 flex-shrink-0">
            <svg
              className="w-5 h-5 text-indigo-600 dark:text-indigo-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
              />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
              Provides your Hardcover API token and the ID of the list you want
              to sync.
            </p>
          </div>
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
        {error && (
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
              {error}
            </p>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-3">
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
            <Input
              type="text"
              label="List ID or Status ID"
              value={listId}
              onChange={(e) => {
                setListId(e.target.value);
                if (validationError) setValidationError('');
              }}
              placeholder="1234 or uuid"
              error={validationError}
              disabled={isLoading || success}
            />
          </div>

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
              Add List
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
