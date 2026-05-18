/**
 * Component: Blocklist Row (desktop + mobile)
 * Documentation: documentation/admin-features/release-blocklist.md
 *
 * Per-row Unblock is a real <button> with intentional treatment (per zach.md).
 * Expand chevron explicitly discloses the long reason detail when present.
 * No accidental tap targets, no surprise expansions.
 *
 * Release name is rendered VERBATIM from the source — chips/badges add context,
 * they don't replace (per zach.md "displayed source data stays true to source").
 */

'use client';

import { useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import { fetchWithAuth } from '@/lib/utils/api';
import { BlockedReleaseRow, SOURCE_BADGE_LABEL } from '../types';

interface BlocklistRowProps {
  entry: BlockedReleaseRow;
  /** Optimistic removal — called immediately on click so the row disappears. */
  onUnblocked: (id: string) => void;
  /** Called when the API call fails so the row can be reinserted. */
  onUnblockFailed: (entry: BlockedReleaseRow, error: string) => void;
}

function formatTimestamp(iso: string): { absolute: string; relative: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return { absolute: '—', relative: '—' };
  }
  const absolute = d.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  let relative: string;
  if (diffMin < 1) relative = 'just now';
  else if (diffMin < 60) relative = `${diffMin}m ago`;
  else if (diffMin < 60 * 24) relative = `${Math.floor(diffMin / 60)}h ago`;
  else relative = `${Math.floor(diffMin / (60 * 24))}d ago`;
  return { absolute, relative };
}

function SourceBadge({ source }: { source: string }) {
  const label = SOURCE_BADGE_LABEL[source] ?? source;
  const styles: Record<string, string> = {
    organize_fail: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    download_fail: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300',
    manual: 'bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-200',
  };
  const cls = styles[source] ?? 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

function useUnblock(
  entry: BlockedReleaseRow,
  onUnblocked: (id: string) => void,
  onUnblockFailed: (entry: BlockedReleaseRow, error: string) => void
) {
  const toast = useToast();
  const [isUnblocking, setIsUnblocking] = useState(false);

  const unblock = async () => {
    if (isUnblocking) return;
    setIsUnblocking(true);
    onUnblocked(entry.id);
    try {
      const response = await fetchWithAuth(`/api/admin/blocklist/${entry.id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || body.message || 'Failed to unblock');
      }
      toast.success(`Unblocked: ${entry.releaseName}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to unblock';
      onUnblockFailed(entry, message);
      toast.error(message);
    } finally {
      setIsUnblocking(false);
    }
  };

  return { isUnblocking, unblock };
}

function RequestRelation({ entry }: { entry: BlockedReleaseRow }) {
  const r = entry.request;
  if (!r || !r.audiobook) {
    return <span className="text-gray-400 dark:text-gray-500">—</span>;
  }
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate" title={r.audiobook.title}>
          {r.audiobook.title}
        </span>
        {r.deletedAt && (
          <span
            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300 flex-shrink-0"
            title={`Request deleted at ${new Date(r.deletedAt).toLocaleString()}`}
          >
            Deleted
          </span>
        )}
      </div>
      <div className="text-xs text-gray-500 dark:text-gray-400 truncate" title={r.audiobook.author}>
        {r.audiobook.author}
        {r.user && <span> · {r.user.plexUsername}</span>}
      </div>
    </div>
  );
}

function ReasonCell({
  entry,
  isExpanded,
  onToggle,
}: {
  entry: BlockedReleaseRow;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const hasDetail = !!entry.reasonDetail && entry.reasonDetail.trim().length > 0;
  return (
    <div className="min-w-0">
      <div className="flex items-start gap-1.5">
        <p className={`text-sm text-gray-700 dark:text-gray-300 ${isExpanded ? 'whitespace-pre-wrap break-words' : 'truncate'}`}>
          {entry.reason}
        </p>
        {hasDetail && (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? 'Hide reason detail' : 'Show reason detail'}
            className="flex-shrink-0 p-1.5 -my-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-500 dark:hover:text-gray-300 dark:hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 transition-colors"
          >
            <svg
              className={`w-3 h-3 transition-transform duration-200 ease-out ${isExpanded ? 'rotate-90' : ''}`}
              fill="currentColor"
              viewBox="0 0 20 20"
              aria-hidden="true"
            >
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
          </button>
        )}
      </div>
      {isExpanded && hasDetail && (
        <pre className="mt-1.5 text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-words font-mono bg-gray-50 dark:bg-gray-900/40 rounded px-2 py-1.5 border border-gray-100 dark:border-gray-700/50">
          {entry.reasonDetail}
        </pre>
      )}
    </div>
  );
}

function UnblockButton({ isUnblocking, onClick }: { isUnblocking: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isUnblocking}
      aria-label="Unblock release"
      className="inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 text-sm font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {isUnblocking ? (
        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      )}
      <span>Unblock</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Desktop row — <tr>
// ---------------------------------------------------------------------------
function DesktopRow({ entry, onUnblocked, onUnblockFailed }: BlocklistRowProps) {
  const { isUnblocking, unblock } = useUnblock(entry, onUnblocked, onUnblockFailed);
  const [reasonExpanded, setReasonExpanded] = useState(false);
  const { absolute, relative } = formatTimestamp(entry.createdAt);

  return (
    <tr className="hover:bg-gray-50 dark:hover:bg-gray-900/40 transition-colors">
      <td className="px-6 py-4 align-top">
        <p
          className="text-sm font-medium text-gray-900 dark:text-gray-100 break-words"
          title={entry.releaseName}
        >
          {entry.releaseName}
        </p>
      </td>
      <td className="px-6 py-4 align-top">
        <ReasonCell entry={entry} isExpanded={reasonExpanded} onToggle={() => setReasonExpanded((v) => !v)} />
      </td>
      <td className="px-6 py-4 align-top">
        <SourceBadge source={entry.source} />
      </td>
      <td className="px-6 py-4 align-top">
        <RequestRelation entry={entry} />
      </td>
      <td className="px-6 py-4 align-top text-sm text-gray-700 dark:text-gray-300">
        {entry.indexerName ?? <span className="text-gray-400 dark:text-gray-500">—</span>}
      </td>
      <td className="px-6 py-4 align-top text-sm text-gray-500 dark:text-gray-400" title={absolute}>
        {relative}
      </td>
      <td className="px-6 py-4 align-top text-right">
        <UnblockButton isUnblocking={isUnblocking} onClick={unblock} />
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Mobile card
// ---------------------------------------------------------------------------
function MobileRow({ entry, onUnblocked, onUnblockFailed }: BlocklistRowProps) {
  const { isUnblocking, unblock } = useUnblock(entry, onUnblocked, onUnblockFailed);
  const [reasonExpanded, setReasonExpanded] = useState(false);
  const { absolute, relative } = formatTimestamp(entry.createdAt);

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <SourceBadge source={entry.source} />
          <span className="text-xs text-gray-500 dark:text-gray-400" title={absolute}>
            {relative}
          </span>
        </div>
        <UnblockButton isUnblocking={isUnblocking} onClick={unblock} />
      </div>

      <p
        className="text-sm font-medium text-gray-900 dark:text-gray-100 break-words"
        title={entry.releaseName}
      >
        {entry.releaseName}
      </p>

      <ReasonCell entry={entry} isExpanded={reasonExpanded} onToggle={() => setReasonExpanded((v) => !v)} />

      {entry.request?.audiobook && (
        <div className="pt-2 border-t border-gray-100 dark:border-gray-700/60">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 dark:text-gray-500 mb-0.5">
            Associated request
          </p>
          <RequestRelation entry={entry} />
        </div>
      )}

      {entry.indexerName && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Indexer: <span className="font-medium text-gray-700 dark:text-gray-300">{entry.indexerName}</span>
        </p>
      )}
    </div>
  );
}

export const BlocklistRow = {
  Desktop: DesktopRow,
  Mobile: MobileRow,
};
