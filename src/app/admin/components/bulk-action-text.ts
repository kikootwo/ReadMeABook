/**
 * Component: Bulk Request Actions Text
 * Documentation: documentation/admin-features/bulk-request-actions.md
 *
 * Every string the bulk action bar shows: buttons, confirms, progress and results.
 * The cancel confirm's sentences come from cancel-confirm-text.ts (shared with the single cancel).
 */

import { bulkCancelConfirmLines } from '@/lib/utils/cancel-confirm-text';
import { appliesTo, type BulkAction, type BulkRow, type BulkSummary } from './bulk-actions';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
export const requestsWord = (n: number) => `${n} ${plural(n, 'request', 'requests')}`;

const VERB: Record<BulkAction, { label: string; doing: string; done: string }> = {
  approve: { label: 'Approve', doing: 'Approving', done: 'Approved' },
  deny: { label: 'Deny', doing: 'Denying', done: 'Denied' },
  cancel: { label: 'Cancel', doing: 'Cancelling', done: 'Cancelled' },
  delete: { label: 'Delete', doing: 'Deleting', done: 'Deleted' },
};

/** Shown in the delete confirm and the docs: what brings a deleted request back. */
export const DELETE_COMES_BACK_LINE =
  'A watched author, watched series or synced shelf requests its books again on its next run; cancel those requests instead to stop that.';

export const selectedText = (n: number) => `${n} selected`;
export const buttonText = (action: BulkAction, count: number) => `${VERB[action].label} ${count}`;
export const progressText = (action: BulkAction, finished: number, total: number) => `${VERB[action].doing} ${finished} of ${total}...`;

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
  const word = requestsWord(n);
  if (action === 'approve' || action === 'deny') {
    const lines = action === 'approve'
      ? [
        `RMAB starts searching for ${plural(n, 'it', 'each one')} now, or on its release date if it isn't out yet.`,
        'A release the user already picked starts downloading at once.',
      ]
      : [`${plural(n, "It's", "They're")} marked Denied and not searched for.`];
    if (skipped > 0) lines.push(`${skipped} selected ${plural(skipped, "isn't", "aren't")} waiting for approval and ${plural(skipped, 'is', 'are')} skipped.`);
    return { title: `${VERB[action].label} ${word}?`, lines, confirmLabel: `${VERB[action].label} ${word}`, cancelLabel: 'Back', variant: action === 'approve' ? 'primary' : 'danger' };
  }
  if (action === 'cancel') {
    const lines = bulkCancelConfirmLines({
      total: n,
      downloadingAudiobooks: targets.filter((r) => r.status === 'downloading' && r.type !== 'ebook').length,
      downloadingEbooks: targets.filter((r) => r.status === 'downloading' && r.type === 'ebook').length,
      awaitingApproval: targets.filter((r) => r.status === 'awaiting_approval').length,
    });
    if (skipped > 0) lines.push(`${skipped} selected can't be cancelled now and ${plural(skipped, 'is', 'are')} skipped.`);
    return { title: `Cancel ${word}?`, lines, confirmLabel: `Cancel ${word}`, cancelLabel: 'Keep requests', variant: 'danger' };
  }
  const lines = [
    `${plural(n, "It's", "They're")} removed and can be requested again.`,
    "Downloads RMAB added are removed from the download client, unless they're still seeding or another request uses them.",
    'Nothing in your library is touched.',
  ];
  if (skipped > 0) {
    lines.push(`${skipped} selected ${plural(skipped, 'is a book', 'are books')} in your library or being imported and ${plural(skipped, 'is', 'are')} left as ${plural(skipped, 'it is', 'they are')}.`);
  }
  lines.push(DELETE_COMES_BACK_LINE);
  return { title: `Delete ${word}?`, lines, confirmLabel: `Delete ${word}`, cancelLabel: 'Back', variant: 'danger' };
}

/** Cancel outcomes that leave the download in the client. */
const DOWNLOAD_STAYS = ['kept', 'kept_seeding', 'kept_unlimited', 'kept_shared', 'kept_not_owned', 'kept_finished', 'retry_later', 'not_removed'];

function countBy(items: { reason?: string }[]): string {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.reason ?? 'unknown', (counts.get(item.reason ?? 'unknown') ?? 0) + 1);
  if (counts.size === 1) return [...counts.keys()][0];
  return [...counts.entries()].map(([reason, count]) => `${count} ${reason}`).join(', ');
}

export interface ResultText {
  lines: string[];
  /** Failed and skipped requests: title and reason (first 50) */
  details: string[];
  moreDetails: number;
  tone: 'success' | 'warning';
}

/** What a finished (or stopped) run reports. */
export function resultText(summary: BulkSummary): ResultText {
  const done = summary.outcomes.filter((o) => o.result === 'done');
  const skipped = [...summary.preSkipped, ...summary.outcomes.filter((o) => o.result === 'skipped')];
  const failed = summary.outcomes.filter((o) => o.result === 'failed');
  const lines: string[] = [];
  const doneLine = `${VERB[summary.action].done} ${requestsWord(done.length)}.`;
  lines.push(summary.stopped ? `Stopped after ${summary.outcomes.length} of ${summary.total}. ${doneLine}` : doneLine);
  if (summary.action === 'cancel') {
    const stays = done.filter((o) => o.download && DOWNLOAD_STAYS.includes(o.download)).length;
    if (stays > 0) lines.push(`${stays} ${plural(stays, 'download is', 'downloads are')} still in the download client.`);
  }
  if (skipped.length > 0) lines.push(`${skipped.length} skipped (${countBy(skipped)}).`);
  if (failed.length > 0) lines.push(`${failed.length} failed.`);
  if (summary.notStarted.length > 0) lines.push(`${summary.notStarted.length} not started; still selected.`);
  const all = [...failed, ...skipped].map((o) => `${o.title}: ${o.reason ?? 'unknown'}`);
  return {
    lines,
    details: all.slice(0, 50),
    moreDetails: Math.max(0, all.length - 50),
    tone: skipped.length + failed.length > 0 || summary.stopped ? 'warning' : 'success',
  };
}
