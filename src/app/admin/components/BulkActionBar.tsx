/**
 * Component: Bulk Action Bar (admin table)
 * Documentation: documentation/admin-features/bulk-request-actions.md
 *
 * Fixed to the bottom of the viewport at every width, outside the table's scroll area.
 * Shows the selection count, one button per action with the count it applies to
 * (disabled at 0), the confirm, per-request progress with Stop, and the result.
 * Screen readers hear a run's start and its result, not each request.
 */

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { mutate } from 'swr';
import { ConfirmDialog } from './ConfirmDialog';
import { appliesTo, BULK_ACTIONS, bulkCounts, notEligibleReason, type BulkAction, type BulkRow } from './bulk-actions';
import { buttonText, confirmText, progressText, resultText, runStartText, selectedText, type ResultText } from './bulk-action-text';
import type { RequestSelection } from './useRequestSelection';
import type { BulkRun } from './useBulkRun';

interface BulkActionBarProps {
  /** Every row on the visible page */
  rows: BulkRow[];
  /** False while the list is loading or failed: the selection is not pruned against `rows` */
  listReady?: boolean;
  selection: RequestSelection;
  run: BulkRun;
  /** The list's SWR key, refreshed after a run */
  listKey: string;
}

const BUTTON_STYLE: Record<BulkAction, string> = {
  approve: 'bg-green-600 hover:bg-green-700 text-white',
  deny: 'bg-gray-600 hover:bg-gray-700 text-white dark:bg-gray-600 dark:hover:bg-gray-500',
  cancel: 'bg-orange-600 hover:bg-orange-700 text-white',
  delete: 'bg-red-600 hover:bg-red-700 text-white',
};
const BUTTON = 'px-3 py-2 min-h-[40px] rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const LINK = 'px-2 py-2 min-h-[40px] text-sm font-medium text-blue-700 dark:text-blue-300 hover:underline disabled:opacity-40';

const titleOf = (row: BulkRow) => row.displayTitle ?? row.title;

export function BulkActionBar({ rows, listReady = true, selection, run, listKey }: BulkActionBarProps) {
  const [pending, setPending] = useState<{ action: BulkAction; rows: BulkRow[]; key: string } | null>(null);
  const [result, setResult] = useState<(ResultText & { version: number }) | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [barEl, setBarEl] = useState<HTMLDivElement | null>(null);
  const [barHeight, setBarHeight] = useState(0);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const versionRef = useRef(selection.version);

  useEffect(() => {
    versionRef.current = selection.version;
  });

  // Rows that left the page (another tab, a refresh on focus) leave the selection
  const pageIds = useMemo(() => rows.map((r) => r.requestId), [rows]);
  const pageKey = pageIds.join(',');
  const { prune } = selection;
  useEffect(() => {
    if (listReady) prune(pageKey ? pageKey.split(',') : []);
  }, [pageKey, prune, listReady]);

  // The spacer under the page is as tall as the bar (Details open included)
  useEffect(() => {
    if (!barEl || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setBarHeight(barEl.offsetHeight));
    observer.observe(barEl);
    return () => observer.disconnect();
  }, [barEl]);

  const selectedRows = useMemo(() => rows.filter((r) => selection.ids.has(r.requestId)), [rows, selection.ids]);
  const counts = bulkCounts(selectedRows);
  const shownResult = result && result.version === selection.version ? result : null;

  // A confirm closes for good when the selection it was built from changes or empties
  const selectedKey = [...selection.ids].sort().join(',');
  if (pending && pending.key !== selectedKey) setPending(null);
  const open = pending && pending.key === selectedKey ? pending : null;

  useEffect(() => {
    if (shownResult) statusRef.current?.focus();
  }, [shownResult]);

  if (selection.count === 0 && !run.running && !shownResult) return null;

  const confirm = open ? confirmText(open.action, open.rows) : null;

  const startRun = async () => {
    if (!open) return;
    const { action, rows: chosen } = open;
    setPending(null); // the dialog closes; progress shows in the bar
    statusRef.current?.focus();
    const startVersion = selection.version;
    const targets = chosen.filter((r) => appliesTo(action, r)).map((r) => ({ id: r.requestId, title: titleOf(r) }));
    const preSkipped = chosen
      .filter((r) => !appliesTo(action, r))
      .map((r) => ({ id: r.requestId, title: titleOf(r), result: 'skipped' as const, reason: notEligibleReason(action) }));
    setAnnouncement(runStartText(action, targets.length));
    const summary = await run.start(action, targets, preSkipped);
    if (!summary) return;
    const done = new Set(summary.outcomes.filter((o) => o.result === 'done').map((o) => o.id));
    selection.keepOnly(chosen.map((r) => r.requestId).filter((id) => !done.has(id)));
    // A list change during the run cleared the selection; the result stays either way
    const text = resultText(summary, { stillSelected: versionRef.current === startVersion });
    setResult({ ...text, version: versionRef.current });
    setAnnouncement(text.lines.join(' '));
    await Promise.all([
      mutate(listKey),
      mutate('/api/admin/metrics'),
      mutate('/api/admin/requests/pending-approval'),
      action === 'delete' ? mutate((key) => typeof key === 'string' && key.includes('/api/audiobooks')) : null,
    ]);
  };

  const progress = run.progress;
  const status = progress
    ? (progress.stopping ? 'Stopping after this request...' : progressText(progress.action, progress.finished, progress.total))
    : shownResult ? shownResult.lines.join(' ') : selectedText(selection.count);
  const statusColor = !progress && shownResult
    ? (shownResult.tone === 'success' ? 'text-green-700 dark:text-green-300' : 'text-amber-700 dark:text-amber-300')
    : 'text-gray-900 dark:text-gray-100';
  return (
    <>
      <div aria-hidden="true" className="h-40 sm:h-24" style={barHeight ? { height: barHeight } : undefined} />
      <div
        ref={setBarEl}
        role="region"
        aria-label="Bulk actions"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-800/95 backdrop-blur shadow-[0_-4px_12px_rgba(0,0,0,0.08)] pb-[env(safe-area-inset-bottom)]"
      >
        <p className="sr-only" aria-live="polite">{run.running || shownResult ? announcement : ''}</p>
        <div className="mx-auto max-w-7xl px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <p ref={statusRef} tabIndex={-1} className={`text-sm font-medium outline-none ${statusColor}`}>{status}</p>
            {!progress && selection.count > 0 && (
              <button type="button" className={LINK} onClick={selection.clear}>Clear</button>
            )}
            {!progress && shownResult && selection.count === 0 && (
              <button type="button" className={LINK} onClick={() => setResult(null)}>Dismiss</button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {progress ? (
              <button type="button" className={`${BUTTON} border border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700`} onClick={run.stop} disabled={progress.stopping}>
                Stop
              </button>
            ) : selection.count > 0 && (
              BULK_ACTIONS.map((action) => (
                <button
                  key={action}
                  type="button"
                  className={`${BUTTON} ${BUTTON_STYLE[action]}`}
                  disabled={counts[action] === 0}
                  onClick={() => setPending({ action, rows: selectedRows, key: selectedKey })}
                >
                  {buttonText(action, counts[action])}
                </button>
              ))
            )}
          </div>
        </div>
        {!progress && shownResult && shownResult.details.length > 0 && (
          <details className="mx-auto max-w-7xl px-4 pb-3 text-sm text-gray-700 dark:text-gray-300">
            <summary className="cursor-pointer">Details</summary>
            <ul className="mt-1 max-h-40 overflow-y-auto list-disc list-inside">
              {shownResult.details.map((line, i) => <li key={i}>{line}</li>)}
              {shownResult.moreDetails > 0 && <li>and {shownResult.moreDetails} more</li>}
            </ul>
          </details>
        )}
      </div>
      <ConfirmDialog
        isOpen={!!confirm}
        title={confirm?.title ?? ''}
        message={confirm ? <div className="space-y-2">{confirm.lines.map((line, i) => <p key={i}>{line}</p>)}</div> : ''}
        confirmLabel={confirm?.confirmLabel}
        cancelLabel={confirm?.cancelLabel}
        confirmVariant={confirm?.variant}
        onConfirm={startRun}
        onCancel={() => setPending(null)}
      />
    </>
  );
}
