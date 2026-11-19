/**
 * Component: Ebook Pill
 * Documentation: documentation/frontend/components.md
 */

import React from 'react';
import { cn } from '@/lib/utils/cn';

/** The orange Ebook pill on request cards; `compact` shows only the book icon below sm */
export function EbookPill({ compact = false }: { compact?: boolean }) {
  return (
    <span
      title="Ebook"
      className={cn(
        'inline-flex items-center gap-1 py-0.5 text-xs font-medium rounded-full whitespace-nowrap flex-shrink-0',
        compact ? 'px-1.5 sm:px-2' : 'px-2'
      )}
      style={{ backgroundColor: '#f16f1920', color: '#f16f19' }}
    >
      <svg className={compact ? 'w-3.5 h-3.5 sm:w-3 sm:h-3' : 'w-3 h-3'} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
      </svg>
      <span className={compact ? 'sr-only sm:not-sr-only' : undefined}>Ebook</span>
    </span>
  );
}
