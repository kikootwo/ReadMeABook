/**
 * Component: Bulk Request Actions Text
 * Documentation: documentation/admin-features/bulk-request-actions.md
 *
 * Every string the bulk action bar shows: buttons, confirms, progress and results.
 * The cancel confirm's first lines come from cancel-confirm-text.ts (its one-line wording switch).
 */

import { bulkCancelConfirmLines } from '@/lib/utils/cancel-confirm-text';
import { appliesTo, SKIP_REASONS, type BulkAction, type BulkRow, type BulkSummary } from './bulk-actions';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const isAre = (n: number) => plural(n, 'is', 'are');
export const requestsWord = (n: number) => `${n} ${plural(n, 'request', 'requests')}`;

const VERB: Record<BulkAction, { label: string; doing: string; done: string }> = {
  approve: { label: 'Approve', doing: 'Approving', done: 'Approved' },
  deny: { label: 'Deny', doing: 'Denying', done: 'Denied' },
  cancel: { label: 'Cancel', doing: 'Cancelling', done: 'Cancelled' },
  delete: { label: 'Delete', doing: 'Deleting', done: 'Deleted' },
};

/** The delete confirm's second line: what brings a deleted request back, and the two ways to stop it. */
export const deleteComesBackLine = (n: number) =>
  `A watched author or series, or a synced shelf, requests ${plural(n, 'it', 'them')} again unless you remove it first or cancel instead.`;

export const selectedText = (n: number) => `${n} selected`;
export const buttonText = (action: BulkAction, count: number) => `${VERB[action].label} ${count}`;
export const progressText = (action: BulkAction, finished: number, total: number) => `${VERB[action].doing} ${finished} of ${total}...`;
/** Announced once when a run starts */
export const runStartText = (action: BulkAction, total: number) => `${VERB[action].doing} ${requestsWord(total)}.`;

export interface ConfirmText {
  title: string;
  lines: string[];
  confirmLabel: string;
  cancelLabel: string;
  variant: 'danger' | 'primary';
}

/** The confirm for `action` on the selected `rows` (counts only the rows it applies to). */
export function confirmText(action: BulkAction, rows: BulkRow[]): ConfirmText {
  const targets = rows.filter((row) => appliesTo(action, row));
  const n = targets.length;
  const skipped = rows.length - n;
  const base = { title: `${VERB[action].label} ${requestsWord(n)}?`, confirmLabel: buttonText(action, n), cancelLabel: 'Back' };
  if (action === 'approve' || action === 'deny') {
    const lines = [action === 'approve'
      ? plural(n,
        'RMAB starts on it now: a search, or the release its user picked. If unreleased, it waits for release day.',
        'RMAB starts on each one now: a search, or the release its user picked. Unreleased ones wait for release day.')
      : `${plural(n, "It's", "They're")} marked Denied.`];
    if (skipped > 0) lines.push(`${skipped} ${plural(skipped, "other isn't", "others aren't")} waiting for approval and ${isAre(skipped)} skipped.`);
    return { ...base, lines, variant: action === 'approve' ? 'primary' : 'danger' };
  }
  if (action === 'cancel') {
    const lines = bulkCancelConfirmLines({ total: n, awaitingApproval: targets.filter((r) => r.status === 'awaiting_approval').length });
    if (skipped > 0) lines.push(`${skipped} ${plural(skipped, 'other', 'others')} can't be cancelled and ${isAre(skipped)} skipped.`);
    return { ...base, lines, cancelLabel: plural(n, 'Keep it', 'Keep them'), variant: 'danger' };
  }
  const inLibrary = skipped > 0 ? `: ${skipped} ${plural(skipped, 'book', 'books')} already in it ${isAre(skipped)} skipped.` : '.';
  const lines = [
    `${plural(n, 'Its download goes', 'Their downloads go')} too, unless still seeding or shared. Nothing in your library is touched${inLibrary}`,
    deleteComesBackLine(n),
  ];
  return { ...base, lines, variant: 'danger' };
}

/** Cancel outcomes that leave the download in the client. */
const DOWNLOAD_STAYS = ['kept', 'kept_seeding', 'kept_unlimited', 'kept_shared', 'kept_not_owned', 'kept_finished', 'retry_later', 'not_removed'];

export interface ResultText {
  lines: string[];
  /** Failed and skipped requests: title and reason (first 50) */
  details: string[];
  moreDetails: number;
  tone: 'success' | 'warning';
}

/**
 * What a finished (or stopped) run reports. `stillSelected`: the requests not started are
 * still selected (false when the list changed during the run and cleared the selection).
 */
export function resultText(summary: BulkSummary, { stillSelected = true }: { stillSelected?: boolean } = {}): ResultText {
  const done = summary.outcomes.filter((o) => o.result === 'done');
  const skipped = [...summary.preSkipped, ...summary.outcomes.filter((o) => o.result === 'skipped')];
  const failed = summary.outcomes.filter((o) => o.result === 'failed');
  const verb = VERB[summary.action].done;
  const lines = [summary.stopped
    ? `Stopped: ${verb.toLowerCase()} ${done.length}, ${summary.notStarted.length} not started${stillSelected ? ' (still selected)' : ''}.`
    : `${verb} ${done.length}.`];
  if (skipped.length > 0) {
    const allInLibrary = skipped.every((o) => o.reason === SKIP_REASONS.inLibrary);
    lines.push(`${skipped.length} ${allInLibrary ? 'in your library ' : ''}skipped.`);
  }
  if (failed.length > 0) lines.push(`${failed.length} failed.`);
  if (summary.action === 'cancel') {
    const stays = done.filter((o) => o.download && DOWNLOAD_STAYS.includes(o.download)).length;
    if (stays > 0) lines.push(`${stays} ${plural(stays, 'download stays', 'downloads stay')} in the download client.`);
  }
  const all = [...failed, ...skipped].map((o) => `${o.title}: ${o.reason ?? 'unknown'}`);
  return {
    lines,
    details: all.slice(0, 50),
    moreDetails: Math.max(0, all.length - 50),
    tone: skipped.length + failed.length > 0 || summary.stopped ? 'warning' : 'success',
  };
}
