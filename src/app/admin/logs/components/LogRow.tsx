/**
 * Component: LogRow (Desktop + Mobile wrappers + shared cell helpers)
 * Documentation: documentation/admin-dashboard.md
 *
 * One file, one source of truth for cell logic, two layout shells:
 *   - <LogRow.Desktop>  → renders <tr> (inside the desktop table)
 *   - <LogRow.Mobile>   → renders <div> (inside the mobile card list)
 * Cell helpers (<RowTime>, <RowType>, <RowStatus>, etc.) are pure and used
 * by both shells. No duplicated logic; layout split is just JSX containers.
 *
 * Disclosure: real <button> with rotating chevron. NOT a "Show Details"
 * text link, NOT a whole-row click. 44×44 min touch target.
 */

'use client';

import { useEffect, useState } from 'react';
import { JOB_TYPE_LABELS } from '@/lib/constants/job-labels';
import { Log, logHasDetails } from '../types';
import { LogDetailPanel } from './LogDetailPanel';
import { useAutoRefreshControl } from '../hooks/useAutoRefreshControl';

// ===========================================================================
// Formatters
// ===========================================================================

function formatJobType(type: string): string {
  return (
    JOB_TYPE_LABELS[type] ??
    type.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
  );
}

function formatDuration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt) return 'N/A';
  if (!completedAt) return 'Running…';
  const ms = Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime());
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function formatRelativeTime(iso: string, now: number): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const elapsed = Math.max(0, now - t);
  const s = Math.floor(elapsed / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function formatAbsoluteTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

// ===========================================================================
// Status badge (lifted from previous logs page; same visual)
// ===========================================================================

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { dot: string; text: string; bg: string }> = {
    completed: { dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-500/10' },
    failed: { dot: 'bg-red-500', text: 'text-red-700 dark:text-red-400', bg: 'bg-red-500/10' },
    active: { dot: 'bg-blue-500', text: 'text-blue-700 dark:text-blue-400', bg: 'bg-blue-500/10' },
    pending: { dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-500/10' },
    delayed: { dot: 'bg-orange-500', text: 'text-orange-700 dark:text-orange-400', bg: 'bg-orange-500/10' },
    stuck: { dot: 'bg-purple-500', text: 'text-purple-700 dark:text-purple-400', bg: 'bg-purple-500/10' },
  };
  const c = config[status] ?? { dot: 'bg-gray-400', text: 'text-gray-600 dark:text-gray-400', bg: 'bg-gray-500/10' };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.dot}`} />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

// ===========================================================================
// Shared cell helpers — used by BOTH desktop tr and mobile div
// ===========================================================================

function RowTime({ log, now }: { log: Log; now: number }) {
  return (
    <span
      className="text-sm text-gray-900 dark:text-gray-100"
      title={formatAbsoluteTime(log.createdAt)}
    >
      {formatRelativeTime(log.createdAt, now)}
    </span>
  );
}

function RowType({ log }: { log: Log }) {
  return (
    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
      {formatJobType(log.type)}
    </span>
  );
}

function RowRelatedItem({ log }: { log: Log }) {
  if (!log.request?.audiobook) {
    return <span className="text-sm text-gray-500 dark:text-gray-400">System job</span>;
  }
  return (
    <div className="text-sm">
      <div className="font-medium text-gray-900 dark:text-gray-100">
        {log.request.audiobook.title}
      </div>
      <div className="text-gray-500 dark:text-gray-400">
        by {log.request.audiobook.author}
      </div>
      <div className="text-xs text-gray-400 dark:text-gray-500">
        User: {log.request.user.plexUsername}
      </div>
    </div>
  );
}

function RowDuration({ log }: { log: Log }) {
  return (
    <span className="text-sm text-gray-500 dark:text-gray-400">
      {formatDuration(log.startedAt, log.completedAt)}
    </span>
  );
}

function RowAttempts({ log }: { log: Log }) {
  return (
    <span className="text-sm text-gray-500 dark:text-gray-400">
      {log.attempts}/{log.maxAttempts}
    </span>
  );
}

interface DisclosureButtonProps {
  log: Log;
  expanded: boolean;
  detailPanelId: string;
  onToggle: () => void;
}

function RowDisclosureButton({ log, expanded, detailPanelId, onToggle }: DisclosureButtonProps) {
  if (!logHasDetails(log)) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-controls={detailPanelId}
      aria-label={expanded ? 'Hide details' : 'Show details'}
      className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-lg text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
    >
      <svg
        className={`w-5 h-5 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  );
}

// ===========================================================================
// Shared expansion + clock state hook
// ===========================================================================

function useRowState(log: Log) {
  const [expanded, setExpanded] = useState(false);
  const { register, unregister } = useAutoRefreshControl();

  // While this row is expanded, register a pause reason.
  useEffect(() => {
    if (!expanded) return;
    const reason = `row-expanded:${log.id}`;
    register(reason);
    return () => unregister(reason);
  }, [expanded, log.id, register, unregister]);

  const detailPanelId = `log-detail-${log.id}`;
  const toggle = () => setExpanded((v) => !v);
  return { expanded, toggle, detailPanelId };
}

function useNowTick(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// ===========================================================================
// Desktop wrapper — <tr>
// ===========================================================================

interface RowProps {
  log: Log;
}

function LogRowDesktop({ log }: RowProps) {
  const { expanded, toggle, detailPanelId } = useRowState(log);
  const now = useNowTick();
  return (
    <>
      <tr className="hover:bg-gray-50 dark:hover:bg-gray-700">
        <td className="px-6 py-4 whitespace-nowrap">
          <RowTime log={log} now={now} />
        </td>
        <td className="px-6 py-4 whitespace-nowrap">
          <RowType log={log} />
        </td>
        <td className="px-6 py-4 whitespace-nowrap">
          <StatusBadge status={log.status} />
        </td>
        <td className="px-6 py-4">
          <RowRelatedItem log={log} />
        </td>
        <td className="px-6 py-4 whitespace-nowrap">
          <RowDuration log={log} />
        </td>
        <td className="px-6 py-4 whitespace-nowrap">
          <RowAttempts log={log} />
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-right">
          <RowDisclosureButton
            log={log}
            expanded={expanded}
            detailPanelId={detailPanelId}
            onToggle={toggle}
          />
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} id={detailPanelId} className="px-6 py-4 bg-gray-50 dark:bg-gray-900">
            <LogDetailPanel log={log} defaultOpen={true} />
          </td>
        </tr>
      )}
    </>
  );
}

// ===========================================================================
// Mobile wrapper — <div>
// ===========================================================================

function LogRowMobile({ log }: RowProps) {
  const { expanded, toggle, detailPanelId } = useRowState(log);
  const now = useNowTick();
  const hasDetails = logHasDetails(log);
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="font-semibold text-gray-900 dark:text-gray-100 text-sm leading-snug">
            <RowType log={log} />
          </div>
          <StatusBadge status={log.status} />
        </div>
        <div className="mb-2">
          <RowRelatedItem log={log} />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
          <RowTime log={log} now={now} />
          <span>Duration: {formatDuration(log.startedAt, log.completedAt)}</span>
          <span>Attempts: {log.attempts}/{log.maxAttempts}</span>
        </div>
      </div>
      {hasDetails && (
        <>
          <div className="flex items-center justify-between px-2 py-1 border-t border-gray-100 dark:border-gray-700/60">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 px-2">
              {expanded ? 'Hide details' : 'Show details'}
            </span>
            <RowDisclosureButton
              log={log}
              expanded={expanded}
              detailPanelId={detailPanelId}
              onToggle={toggle}
            />
          </div>
          {expanded && (
            <div
              id={detailPanelId}
              className="px-4 pb-4 pt-3 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-100 dark:border-gray-700/60"
            >
              <LogDetailPanel log={log} defaultOpen={false} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ===========================================================================
// Public exports
// ===========================================================================

export const LogRow = {
  Desktop: LogRowDesktop,
  Mobile: LogRowMobile,
};
