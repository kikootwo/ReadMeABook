/**
 * Component: Selection Checkbox (admin table bulk actions)
 * Documentation: documentation/admin-features/bulk-request-actions.md
 *
 * Native checkboxes: one per row, and a tri-state header (checked, mixed, unchecked)
 * that selects or clears the visible page. The label gives a 44px hit area.
 */

'use client';

import { useEffect, useRef } from 'react';
import type { RequestSelection } from './useRequestSelection';

const LABEL = 'flex items-center justify-center min-w-[44px] min-h-[44px] -mx-3 -my-2 cursor-pointer has-[:disabled]:cursor-not-allowed';
const INPUT = 'h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 disabled:opacity-50';

export function SelectPageCheckbox({ pageIds, selection, disabled }: { pageIds: string[]; selection: RequestSelection; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const state = selection.headerState(pageIds);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some';
  }, [state]);
  return (
    <label className={LABEL}>
      <input
        ref={ref}
        type="checkbox"
        className={INPUT}
        aria-label="Select all requests on this page"
        checked={state === 'all'}
        disabled={disabled || pageIds.length === 0}
        onChange={() => selection.setPage(pageIds, state !== 'all')}
      />
    </label>
  );
}

export function SelectRowCheckbox({ id, title, selection, disabled }: { id: string; title: string; selection: RequestSelection; disabled?: boolean }) {
  return (
    <label className={LABEL}>
      <input
        type="checkbox"
        className={INPUT}
        aria-label={`Select ${title}`}
        checked={selection.ids.has(id)}
        disabled={disabled}
        onChange={() => selection.toggle(id)}
      />
    </label>
  );
}
