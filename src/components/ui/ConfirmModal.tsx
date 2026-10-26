/**
 * Component: Confirmation Modal
 * Documentation: documentation/frontend/components.md
 */

'use client';

import React from 'react';
import { Modal } from './Modal';
import { Button } from './Button';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string | React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  isLoading?: boolean;
  /** Disables Confirm (e.g. nothing changed yet). */
  confirmDisabled?: boolean;
  variant?: 'danger' | 'primary';
  /** Optional third choice, shown between Cancel and Confirm. */
  secondaryText?: string;
  onSecondary?: () => void;
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  isLoading = false,
  confirmDisabled = false,
  variant = 'primary',
  secondaryText,
  onSecondary,
}: ConfirmModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm" showCloseButton={false}>
      <div className="space-y-6">
        <div className="text-gray-600 dark:text-gray-400">
          {typeof message === 'string' ? <p>{message}</p> : message}
        </div>

        <div className="flex gap-3 justify-end">
          <Button onClick={onClose} variant="outline" disabled={isLoading}>
            {cancelText}
          </Button>
          {secondaryText && onSecondary && (
            <Button onClick={onSecondary} variant="outline" disabled={isLoading}>
              {secondaryText}
            </Button>
          )}
          <Button
            onClick={onConfirm}
            variant={variant}
            loading={isLoading}
            disabled={confirmDisabled}
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
