/**
 * Component: Blocklist — Active Filter Chips
 * Documentation: documentation/admin-features/release-blocklist.md
 *
 * Dismissable chip strip showing every active filter PLUS the search term.
 * Each chip is a real <button> with aria-label="Remove filter: <name>" and a
 * visible × glyph (per zach.md UX rule on intentional affordances).
 */

'use client';

import {
  DATE_PRESETS,
  getActivePresetId,
} from '@/lib/constants/log-filters';
import { useBlocklistUrlState } from '../hooks/useBlocklistUrlState';
import { SOURCE_LABELS } from '../types';

export default function BlocklistActiveFilterChips() {
  const { filters, setFilters, removeFilter } = useBlocklistUrlState();

  const chips: ChipDescriptor[] = [];

  if (filters.search !== '') {
    chips.push({
      key: 'search',
      name: 'search',
      label: `Search: "${filters.search}"`,
      onRemove: () => removeFilter('search'),
    });
  }
  if (filters.source !== 'all') {
    chips.push({
      key: 'source',
      name: 'source',
      label: `Source: ${SOURCE_LABELS[filters.source] ?? filters.source}`,
      onRemove: () => removeFilter('source'),
    });
  }
  if (filters.requestId !== null) {
    chips.push({
      key: 'requestId',
      name: 'request',
      label: `Request: ${filters.requestId}`,
      onRemove: () => removeFilter('requestId'),
    });
  }
  if (filters.dateFrom !== null || filters.dateTo !== null) {
    chips.push({
      key: 'date',
      name: 'date range',
      label: `Date: ${formatDateChipLabel(filters.dateFrom, filters.dateTo)}`,
      onRemove: () => setFilters({ dateFrom: null, dateTo: null }),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Active filters">
      {chips.map((chip) => (
        <Chip key={chip.key} chip={chip} />
      ))}
    </div>
  );
}

interface ChipDescriptor {
  key: string;
  name: string;
  label: string;
  onRemove: () => void;
}

function Chip({ chip }: { chip: ChipDescriptor }) {
  return (
    <button
      type="button"
      onClick={chip.onRemove}
      aria-label={`Remove filter: ${chip.name}`}
      className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200 rounded-full text-sm font-medium hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors min-h-[36px]"
    >
      <span className="truncate max-w-[20rem]">{chip.label}</span>
      <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
}

function formatDateChipLabel(dateFrom: string | null, dateTo: string | null): string {
  const presetId = getActivePresetId(dateFrom, dateTo);
  if (presetId === 'custom') {
    return `${formatLocal(dateFrom)} – ${formatLocal(dateTo)}`;
  }
  const preset = DATE_PRESETS.find((p) => p.id === presetId);
  return preset?.label ?? 'Custom';
}

function formatLocal(iso: string | null): string {
  if (!iso) return '…';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '…';
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
