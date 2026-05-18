/**
 * Component: Admin Logs — Filter Constants & Helpers
 * Documentation: documentation/admin-dashboard.md
 *
 * Owns: date-range preset definitions + helpers, status dropdown labels.
 * Does NOT own: VALID_LIMITS, VALID_STATUSES, DEFAULT_LIMIT — those live in
 * `src/app/admin/logs/types.ts` (the Stage-0 contract). This module imports
 * `VALID_STATUSES` from there so status labels track the canonical value list.
 */

import { VALID_STATUSES, type LogStatus } from '@/app/admin/logs/types';

// ---------------------------------------------------------------------------
// Date-range presets — preset id encodes the meaning, durationMs the window.
// `custom` and `all_time` carry null durationMs (sentinels handled by helpers).
// Insertion order is the display order in the picker.
// ---------------------------------------------------------------------------
export type DatePresetId =
  | 'last_hour'
  | 'last_24h'
  | 'last_7d'
  | 'last_30d'
  | 'custom'
  | 'all_time';

export interface DatePreset {
  id: DatePresetId;
  label: string;
  durationMs: number | null;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const DATE_PRESETS: readonly DatePreset[] = [
  { id: 'last_hour', label: 'Last hour', durationMs: HOUR_MS },
  { id: 'last_24h', label: 'Last 24h', durationMs: DAY_MS },
  { id: 'last_7d', label: 'Last 7 days', durationMs: 7 * DAY_MS },
  { id: 'last_30d', label: 'Last 30 days', durationMs: 30 * DAY_MS },
  { id: 'custom', label: 'Custom', durationMs: null },
  { id: 'all_time', label: 'All time', durationMs: null },
];

/** Hydrate-time default per Zach Resolution #1. Used by useLogsUrlState only on first mount. */
export const DEFAULT_DATE_PRESET_ID: DatePresetId = 'last_7d';

/** Tolerance for matching a stored `dateFrom` against a moving preset window. */
const PRESET_MATCH_TOLERANCE_MS = 60 * 1000;

/**
 * Translate a preset id into a wire (dateFrom/dateTo) range.
 * - For sliding-window presets, `to` stays null ("until now").
 * - For `custom`, returns the current values unchanged — callers should keep
 *   what the user typed rather than overwrite with nulls.
 * - For `all_time`, both are null (no bound).
 */
export function presetToRange(
  id: DatePresetId,
  now: Date = new Date()
): { dateFrom: string | null; dateTo: string | null } {
  if (id === 'all_time' || id === 'custom') {
    return { dateFrom: null, dateTo: null };
  }
  const preset = DATE_PRESETS.find((p) => p.id === id);
  if (!preset || preset.durationMs == null) {
    return { dateFrom: null, dateTo: null };
  }
  return {
    dateFrom: new Date(now.getTime() - preset.durationMs).toISOString(),
    dateTo: null,
  };
}

/**
 * Identify which preset (if any) the current dateFrom/dateTo pair represents.
 * - both null → 'all_time'
 * - dateFrom within tolerance of `now - presetDuration`, no dateTo → that preset
 * - anything else (e.g. dateTo set, or dateFrom outside tolerance) → 'custom'
 */
export function getActivePresetId(
  dateFrom: string | null,
  dateTo: string | null,
  now: Date = new Date()
): DatePresetId {
  if (dateFrom == null && dateTo == null) return 'all_time';
  if (dateTo != null) return 'custom';
  if (dateFrom == null) return 'custom';

  const fromMs = new Date(dateFrom).getTime();
  if (!Number.isFinite(fromMs)) return 'custom';

  const nowMs = now.getTime();
  for (const preset of DATE_PRESETS) {
    if (preset.durationMs == null) continue;
    const expected = nowMs - preset.durationMs;
    if (Math.abs(fromMs - expected) <= PRESET_MATCH_TOLERANCE_MS) {
      return preset.id;
    }
  }
  return 'custom';
}

// ---------------------------------------------------------------------------
// Status dropdown — pair labels with the canonical VALID_STATUSES value list.
// Adding a status only requires editing types.ts; the label here can be tuned
// independently for display copy.
// ---------------------------------------------------------------------------
const STATUS_LABEL_OVERRIDES: Partial<Record<LogStatus, string>> = {
  all: 'All Statuses',
};

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

export interface StatusOption {
  value: LogStatus;
  label: string;
}

export const STATUS_OPTIONS: readonly StatusOption[] = VALID_STATUSES.map((value) => ({
  value,
  label: STATUS_LABEL_OVERRIDES[value] ?? capitalize(value),
}));

/** Lookup a status's display label, falling back to capitalization. */
export function getStatusLabel(value: string): string {
  const match = STATUS_OPTIONS.find((opt) => opt.value === value);
  return match?.label ?? capitalize(value);
}
