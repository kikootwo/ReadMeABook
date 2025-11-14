/**
 * Component: Status Badge
 * Documentation: documentation/frontend/components.md
 */

'use client';

import React from 'react';
import { cn } from '@/lib/utils/cn';

interface StatusBadgeProps {
  status: string;
  progress?: number;
  className?: string;
}

export function StatusBadge({ status, progress, className }: StatusBadgeProps) {
  const statusConfig: Record<string, { label: string; color: string }> = {
    pending: {
      label: 'Pending',
      color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    },
    awaiting_search: {
      label: 'Awaiting Search',
      color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    },
    searching: {
      label: 'Searching...',
      color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    },
    downloading: {
      label: progress !== undefined && progress === 0 ? 'Initializing...' : 'Downloading',
      color: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
    },
    downloaded: {
      label: 'Downloaded',
      color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    },
    processing: {
      label: 'Processing',
      color: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
    },
    awaiting_import: {
      label: 'Awaiting Import',
      color: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
    },
    available: {
      label: 'Available',
      color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    },
    completed: {
      label: 'Available',
      color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    },
    failed: {
      label: 'Failed',
      color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    },
    warn: {
      label: 'Warning',
      color: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
    },
    cancelled: {
      label: 'Cancelled',
      color: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
    },
  };

  const config = statusConfig[status] || {
    label: status,
    color: 'bg-gray-100 text-gray-800',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
        config.color,
        className
      )}
    >
      {config.label}
    </span>
  );
}
