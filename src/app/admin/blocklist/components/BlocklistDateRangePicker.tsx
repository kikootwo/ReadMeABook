/**
 * Component: Blocklist — Date Range Picker
 * Documentation: documentation/admin-features/release-blocklist.md
 *
 * Sibling of admin/logs/components/DateRangePicker — no pause-on-interact
 * registration since the blocklist page has no auto-refresh. Same preset list
 * (defined in @/lib/constants/log-filters which is shared, not logs-only).
 */

'use client';

import { useMemo, useState } from 'react';
import {
  DATE_PRESETS,
  getActivePresetId,
  presetToRange,
  type DatePresetId,
} from '@/lib/constants/log-filters';
import { INPUT_CLASS, LABEL_CLASS } from '@/app/admin/logs/components/filter-styles';

interface BlocklistDateRangePickerProps {
  dateFrom: string | null;
  dateTo: string | null;
  onChange: (next: { dateFrom: string | null; dateTo: string | null }) => void;
}

export default function BlocklistDateRangePicker({
  dateFrom,
  dateTo,
  onChange,
}: BlocklistDateRangePickerProps) {
  const [forceCustom, setForceCustom] = useState(false);
  const derivedPreset = useMemo(
    () => getActivePresetId(dateFrom, dateTo),
    [dateFrom, dateTo]
  );
  const activePreset: DatePresetId = forceCustom ? 'custom' : derivedPreset;
  const showCustom = activePreset === 'custom';

  const handlePresetChange = (id: DatePresetId) => {
    if (id === 'custom') {
      setForceCustom(true);
      return;
    }
    setForceCustom(false);
    onChange(presetToRange(id));
  };

  const handleCustomChange = (next: { dateFrom: string | null; dateTo: string | null }) => {
    setForceCustom(true);
    onChange(next);
  };

  return (
    <div>
      <label className={LABEL_CLASS} htmlFor="blocklist-date-preset">Date Range</label>
      <select
        id="blocklist-date-preset"
        value={activePreset}
        onChange={(e) => handlePresetChange(e.target.value as DatePresetId)}
        className={INPUT_CLASS}
      >
        {DATE_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </select>
      {showCustom && (
        <CustomDateInputs dateFrom={dateFrom} dateTo={dateTo} onChange={handleCustomChange} />
      )}
    </div>
  );
}

function CustomDateInputs({
  dateFrom,
  dateTo,
  onChange,
}: {
  dateFrom: string | null;
  dateTo: string | null;
  onChange: (next: { dateFrom: string | null; dateTo: string | null }) => void;
}) {
  const fromLocal = useMemo(() => isoToLocalInputValue(dateFrom), [dateFrom]);
  const toLocal = useMemo(() => isoToLocalInputValue(dateTo), [dateTo]);

  return (
    <div className="mt-2 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <input
          type="datetime-local"
          aria-label="Date from"
          value={fromLocal}
          onChange={(e) =>
            onChange({ dateFrom: localInputToIso(e.target.value), dateTo })
          }
          className={INPUT_CLASS}
        />
        <input
          type="datetime-local"
          aria-label="Date to"
          value={toLocal}
          onChange={(e) =>
            onChange({ dateFrom, dateTo: localInputToIso(e.target.value) })
          }
          className={INPUT_CLASS}
        />
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Times are in your local timezone (sent as UTC).
      </p>
    </div>
  );
}

function isoToLocalInputValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
