/**
 * Component: Library active filter chips (each removable) and Clear all
 * Documentation: documentation/features/library-view.md
 */

'use client';

import React from 'react';
import type { LibraryResponse, LibrarySource, StatusGroup } from '@/lib/library-view/types';
import type { LibraryQuery } from '@/lib/hooks/useLibraryQuery';
import { SOURCE_LABELS, STATUS_GROUP_DOTS, STATUS_GROUP_LABELS, requesterLabel } from './card-display';

interface ActiveChipsProps {
  query: LibraryQuery;
  hideAvailable: boolean;
  requesters: LibraryResponse['facets']['requestedBy'];
  onClearSearch: () => void;
  onToggleStatus: (s: StatusGroup) => void;
  onToggleSource: (s: LibrarySource) => void;
  onToggleRequestedBy: (id: string) => void;
  onShowAvailable: () => void;
  onClearAll: () => void;
}

function Chip({ label, dot, onRemove }: { label: string; dot?: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 max-w-full pl-3 pr-1 py-1 rounded-full text-sm bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200 border border-blue-200/70 dark:border-blue-800/70">
      {dot && <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} aria-hidden="true" />}
      <span className="truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className="p-0.5 rounded-full hover:bg-blue-100 dark:hover:bg-blue-900"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </span>
  );
}

export function ActiveChips({
  query,
  hideAvailable,
  requesters,
  onClearSearch,
  onToggleStatus,
  onToggleSource,
  onToggleRequestedBy,
  onShowAvailable,
  onClearAll,
}: ActiveChipsProps) {
  const names = new Map(requesters.map((r) => [r.userId, requesterLabel(r)]));
  const chips: React.ReactNode[] = [];
  if (query.q) chips.push(<Chip key="q" label={`Search: ${query.q}`} onRemove={onClearSearch} />);
  for (const s of query.status) {
    chips.push(<Chip key={`s-${s}`} label={STATUS_GROUP_LABELS[s]} dot={STATUS_GROUP_DOTS[s]} onRemove={() => onToggleStatus(s)} />);
  }
  for (const s of query.source) {
    chips.push(<Chip key={`src-${s}`} label={SOURCE_LABELS[s]} onRemove={() => onToggleSource(s)} />);
  }
  for (const id of query.requestedBy) {
    const name = names.get(id);
    if (name) chips.push(<Chip key={`u-${id}`} label={`Requested by ${name}`} onRemove={() => onToggleRequestedBy(id)} />);
  }
  if (hideAvailable) chips.push(<Chip key="hide" label="Hiding available" onRemove={onShowAvailable} />);
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Active filters">
      {chips}
      <button
        type="button"
        onClick={onClearAll}
        className="px-2 py-1 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400"
      >
        Clear all
      </button>
    </div>
  );
}
