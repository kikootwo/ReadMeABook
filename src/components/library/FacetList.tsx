/**
 * Component: Library facets (status, source, requested by; counts; Clear per facet). Rail and sheet.
 * Documentation: documentation/features/library-view.md
 */

'use client';

import React, { useState } from 'react';
import { SOURCES, STATUS_GROUPS } from '@/lib/library-view/constants';
import type { LibraryResponse, LibrarySource, StatusGroup } from '@/lib/library-view/types';
import type { LibraryQuery } from '@/lib/hooks/useLibraryQuery';
import { SOURCE_LABELS, STATUS_GROUP_DOTS, STATUS_GROUP_LABELS, requesterLabel } from './card-display';

/** Requesters shown before "Show all". */
export const REQUESTERS_SHOWN = 8;

interface FacetListProps {
  facets: LibraryResponse['facets'] | null;
  query: LibraryQuery;
  onToggleStatus: (s: StatusGroup) => void;
  onToggleSource: (s: LibrarySource) => void;
  onToggleRequestedBy: (id: string) => void;
  onClearFacet: (facet: 'status' | 'source' | 'requestedBy') => void;
}

function Section({ title, onClear, children }: { title: string; onClear?: () => void; children: React.ReactNode }) {
  // min-w-0: a fieldset is min-content wide by default, which pushed the counts out of the 220 px rail
  return (
    <fieldset className="min-w-0 space-y-1">
      <div className="flex items-center justify-between mb-1">
        <legend className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</legend>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
            aria-label={`Clear ${title}`}
          >
            Clear
          </button>
        )}
      </div>
      {children}
    </fieldset>
  );
}

function Option({
  label,
  count,
  checked,
  onChange,
  marker,
}: {
  label: string;
  count: number;
  checked: boolean;
  onChange: () => void;
  marker?: React.ReactNode;
}) {
  return (
    <label
      className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-sm transition-colors ${
        checked
          ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-900 dark:text-blue-100'
          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
      />
      {marker}
      <span className="flex-1 min-w-0 truncate">{label}</span>
      <span className="text-xs tabular-nums text-gray-500 dark:text-gray-400">{count.toLocaleString()}</span>
    </label>
  );
}

export function FacetList({ facets, query, onToggleStatus, onToggleSource, onToggleRequestedBy, onClearFacet }: FacetListProps) {
  const [showAll, setShowAll] = useState(false);
  const requesters = (facets?.requestedBy ?? []).filter((r) => r.count > 0 || query.requestedBy.includes(r.userId));
  const shownRequesters = showAll ? requesters : requesters.slice(0, REQUESTERS_SHOWN);

  return (
    <div className="space-y-6">
      <Section title="Status" onClear={query.status.length ? () => onClearFacet('status') : undefined}>
        {STATUS_GROUPS.map((s) => (
          <Option
            key={s}
            label={STATUS_GROUP_LABELS[s]}
            count={facets?.status[s] ?? 0}
            checked={query.status.includes(s)}
            onChange={() => onToggleStatus(s)}
            marker={<span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_GROUP_DOTS[s]}`} aria-hidden="true" />}
          />
        ))}
      </Section>

      <Section title="Source" onClear={query.source.length ? () => onClearFacet('source') : undefined}>
        {SOURCES.map((s) => (
          <Option
            key={s}
            label={SOURCE_LABELS[s]}
            count={facets?.source[s] ?? 0}
            checked={query.source.includes(s)}
            onChange={() => onToggleSource(s)}
          />
        ))}
      </Section>

      {requesters.length > 0 && (
        <Section title="Requested by" onClear={query.requestedBy.length ? () => onClearFacet('requestedBy') : undefined}>
          {shownRequesters.map((r) => (
            <Option
              key={r.userId}
              label={requesterLabel(r)}
              count={r.count}
              checked={query.requestedBy.includes(r.userId)}
              onChange={() => onToggleRequestedBy(r.userId)}
              marker={
                <span
                  className="w-5 h-5 rounded-full flex-shrink-0 bg-gray-200 dark:bg-gray-700 text-[10px] font-semibold text-gray-700 dark:text-gray-200 flex items-center justify-center"
                  aria-hidden="true"
                >
                  {r.username.charAt(0).toUpperCase()}
                </span>
              }
            />
          ))}
          {requesters.length > REQUESTERS_SHOWN && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="px-2 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
            >
              {showAll ? 'Show fewer' : `Show all ${requesters.length}`}
            </button>
          )}
        </Section>
      )}
    </div>
  );
}
