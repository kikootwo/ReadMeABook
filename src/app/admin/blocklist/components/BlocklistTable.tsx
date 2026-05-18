/**
 * Component: BlocklistTable
 * Documentation: documentation/admin-features/release-blocklist.md
 *
 * Desktop = sortable table, mobile = stacked cards. Sortable columns clickable
 * with explicit affordance (cursor + sort icon) — per zach.md UX rule on
 * intentional affordances.
 */

'use client';

import { useBlocklistUrlState } from '../hooks/useBlocklistUrlState';
import { BlockedReleaseRow, SortField } from '../types';
import { BlocklistRow } from './BlocklistRow';

interface BlocklistTableProps {
  entries: BlockedReleaseRow[];
  onUnblocked: (id: string) => void;
  onUnblockFailed: (entry: BlockedReleaseRow, error: string) => void;
}

interface SortableHeaderProps {
  field: SortField;
  label: string;
  className?: string;
}

function SortableHeader({ field, label, className = '' }: SortableHeaderProps) {
  const { filters, setFilters } = useBlocklistUrlState();
  const isActive = filters.sortBy === field;
  const order = filters.sortOrder;

  const handleClick = () => {
    if (isActive) {
      setFilters({ sortOrder: order === 'asc' ? 'desc' : 'asc' });
    } else {
      setFilters({ sortBy: field, sortOrder: 'desc' });
    }
  };

  return (
    <th
      className={`px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider ${className}`}
    >
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex items-center gap-1.5 hover:text-gray-900 dark:hover:text-gray-100 transition-colors uppercase tracking-wider font-medium"
        aria-label={`Sort by ${label}`}
      >
        {label}
        <SortGlyph active={isActive} order={order} />
      </button>
    </th>
  );
}

function SortGlyph({ active, order }: { active: boolean; order: 'asc' | 'desc' }) {
  if (!active) {
    return (
      <svg className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
      </svg>
    );
  }
  return order === 'asc' ? (
    <svg className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
    </svg>
  ) : (
    <svg className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

export function BlocklistTable({ entries, onUnblocked, onUnblockFailed }: BlocklistTableProps) {
  return (
    <>
      {/* Mobile cards */}
      <div className="space-y-3 sm:hidden">
        {entries.map((entry) => (
          <BlocklistRow.Mobile
            key={entry.id}
            entry={entry}
            onUnblocked={onUnblocked}
            onUnblockFailed={onUnblockFailed}
          />
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden sm:block bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <SortableHeader field="releaseName" label="Release name" />
                <SortableHeader field="reason" label="Reason" />
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Source
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Associated request
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Indexer
                </th>
                <SortableHeader field="createdAt" label="Blocked at" />
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {entries.map((entry) => (
                <BlocklistRow.Desktop
                  key={entry.id}
                  entry={entry}
                  onUnblocked={onUnblocked}
                  onUnblockFailed={onUnblockFailed}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
