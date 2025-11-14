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
  message: string;
  confirmText?: string;
  cancelText?: string;
  isLoading?: boolean;
  variant?: 'danger' | 'primary';
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
  variant = 'primary',
}: ConfirmModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm" showCloseButton={false}>
      <div className="space-y-6">
        <p className="text-gray-600 dark:text-gray-400">{message}</p>

        <div className="flex gap-3 justify-end">
          <Button onClick={onClose} variant="outline" disabled={isLoading}>
            {cancelText}
          </Button>
          <Button
            onClick={onConfirm}
            variant={variant}
            loading={isLoading}
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
