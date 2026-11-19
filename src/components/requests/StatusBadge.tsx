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
  /** Background and text classes in place of the status's own (the label stays). */
  color?: string;
  /** Below sm, an icon in place of the label (request cards) */
  compact?: boolean;
}

/** Label and colour of every request status (one source for status labels: badge, Library cards). */
function statusConfigFor(progress?: number): Record<string, { label: string; color: string }> {
  return {
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
    awaiting_approval: {
      label: 'Pending Approval',
      color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    },
    awaiting_release: {
      label: 'Awaiting Release',
      color: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200',
    },
    denied: {
      label: 'Request Denied',
      color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    },
  };
}

/** The display label of a request status (the raw value when unknown). */
export function statusLabel(status: string, progress?: number): string {
  return statusConfigFor(progress)[status]?.label ?? status;
}

/** 20x20 solid icon paths for the compact badge, by the kind of status */
const STATUS_ICON_PATHS = {
  done: 'M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 011.4-1.4L8 12.6l7.3-7.3a1 1 0 011.4 0z',
  waiting: 'M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.3.7l2.8 2.8a1 1 0 001.4-1.4L11 9.6V6z',
  searching: 'M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.9 3.5l4.8 4.8a1 1 0 01-1.4 1.4l-4.8-4.8A6 6 0 012 8z',
  downloading: 'M10 3a1 1 0 011 1v7.6l2.3-2.3a1 1 0 111.4 1.4l-4 4a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.4L9 11.6V4a1 1 0 011-1zM4 16a1 1 0 100 2h12a1 1 0 100-2H4z',
  working: 'M7.84 1.804A1 1 0 018.82 1h2.36a1 1 0 01.98.804l.331 1.652a6.993 6.993 0 011.929 1.115l1.598-.54a1 1 0 011.186.447l1.18 2.044a1 1 0 01-.205 1.251l-1.267 1.113a7.047 7.047 0 010 2.228l1.267 1.113a1 1 0 01.206 1.25l-1.18 2.045a1 1 0 01-1.187.447l-1.598-.54a6.993 6.993 0 01-1.929 1.115l-.33 1.652a1 1 0 01-.98.804H8.82a1 1 0 01-.98-.804l-.331-1.652a6.993 6.993 0 01-1.929-1.115l-1.598.54a1 1 0 01-1.186-.447l-1.18-2.044a1 1 0 01.205-1.251l1.267-1.114a7.05 7.05 0 010-2.227L1.821 7.773a1 1 0 01-.206-1.25l1.18-2.045a1 1 0 011.187-.447l1.598.54A6.993 6.993 0 017.51 3.456l.33-1.652zM10 13a3 3 0 100-6 3 3 0 000 6z',
  scheduled: 'M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zM4 8h12v8H4V8z',
  stopped: 'M5.3 5.3a1 1 0 011.4 0L10 8.6l3.3-3.3a1 1 0 111.4 1.4L11.4 10l3.3 3.3a1 1 0 01-1.4 1.4L10 11.4l-3.3 3.3a1 1 0 01-1.4-1.4L8.6 10 5.3 6.7a1 1 0 010-1.4z',
  warning: 'M8.3 3.1a2 2 0 013.4 0l6 10.4A2 2 0 0116 16.5H4a2 2 0 01-1.7-3l6-10.4zM10 7a1 1 0 00-1 1v3a1 1 0 102 0V8a1 1 0 00-1-1zm0 7.5a1 1 0 100-2 1 1 0 000 2z',
  cancelled: 'M4 10a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1z',
} as const;

const STATUS_ICON: Record<string, keyof typeof STATUS_ICON_PATHS> = {
  available: 'done', completed: 'done', downloaded: 'done',
  pending: 'waiting', awaiting_search: 'waiting', awaiting_approval: 'waiting',
  searching: 'searching',
  downloading: 'downloading',
  processing: 'working', awaiting_import: 'working',
  awaiting_release: 'scheduled',
  failed: 'stopped', denied: 'stopped',
  warn: 'warning',
  cancelled: 'cancelled',
};

export function StatusBadge({ status, progress, className, color, compact = false }: StatusBadgeProps) {
  const config = statusConfigFor(progress)[status] || {
    label: status,
    color: 'bg-gray-100 text-gray-800',
  };

  if (compact) {
    // Below sm only the icon shows; the label stays for screen readers and comes back from sm
    return (
      <span
        title={config.label}
        className={cn(
          'inline-flex items-center gap-1 px-1.5 sm:px-2.5 py-0.5 rounded-full text-xs font-medium',
          color ?? config.color,
          className
        )}
      >
        <svg className="w-3.5 h-3.5 sm:hidden" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" clipRule="evenodd" d={STATUS_ICON_PATHS[STATUS_ICON[status] ?? 'waiting']} />
        </svg>
        <span className="sr-only sm:not-sr-only">{config.label}</span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
        color ?? config.color,
        className
      )}
    >
      {config.label}
    </span>
  );
}
