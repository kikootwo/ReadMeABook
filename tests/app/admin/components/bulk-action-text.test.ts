/**
 * Component: Bulk Request Actions Text Tests
 * Documentation: documentation/admin-features/bulk-request-actions.md
 */

import { describe, expect, it } from 'vitest';
import { buttonText, confirmText, deleteComesBackLine, progressText, resultText, runStartText, selectedText } from '@/app/admin/components/bulk-action-text';
import type { BulkRow, BulkSummary } from '@/app/admin/components/bulk-actions';

let n = 0;
const r = (status: string, extra: Partial<BulkRow> = {}): BulkRow => ({ requestId: `id-${n++}`, title: 'Made Up', status, ...extra });
const many = (count: number, status: string, extra: Partial<BulkRow> = {}) => Array.from({ length: count }, () => r(status, extra));

describe('bar texts', () => {
  it('count, buttons, progress and the run start', () => {
    expect(selectedText(52)).toBe('52 selected');
    expect(buttonText('delete', 52)).toBe('Delete 52');
    expect(buttonText('approve', 0)).toBe('Approve 0');
    expect(progressText('delete', 120, 280)).toBe('Deleting 120 of 280...');
    expect(runStartText('delete', 98)).toBe('Deleting 98 requests.');
  });
});

describe('confirmText', () => {
  it('delete: downloads, nothing in the library touched with the books skipped, and how they come back', () => {
    const c = confirmText('delete', [...many(98, 'failed'), ...many(2, 'available', { inLibrary: true })]);
    expect(c).toMatchObject({ title: 'Delete 98 requests?', confirmLabel: 'Delete 98', cancelLabel: 'Back', variant: 'danger' });
    expect(c.lines).toEqual([
      'Their downloads go too, unless still seeding or shared. Nothing in your library is touched: 2 books already in it are skipped.',
      'A watched author or series, or a synced shelf, requests them again unless you remove it first or cancel instead.',
    ]);
  });

  it('delete with no skips ends at "touched."; one skip is singular', () => {
    expect(confirmText('delete', many(3, 'failed')).lines[0]).toBe('Their downloads go too, unless still seeding or shared. Nothing in your library is touched.');
    const one = confirmText('delete', [r('failed'), r('available', { inLibrary: true })]);
    expect(one).toMatchObject({ title: 'Delete 1 request?', confirmLabel: 'Delete 1' });
    expect(one.lines).toEqual([
      'Its download goes too, unless still seeding or shared. Nothing in your library is touched: 1 book already in it is skipped.',
      deleteComesBackLine(1),
    ]);
    expect(deleteComesBackLine(1)).toBe('A watched author or series, or a synced shelf, requests it again unless you remove it first or cancel instead.');
  });

  it('approve: one line on what starts, and the skipped', () => {
    const c = confirmText('approve', [...many(5, 'awaiting_approval'), ...many(85, 'failed')]);
    expect(c).toMatchObject({ title: 'Approve 5 requests?', confirmLabel: 'Approve 5', cancelLabel: 'Back', variant: 'primary' });
    expect(c.lines).toEqual([
      'RMAB starts on each one now: a search, or the release its user picked. Unreleased ones wait for release day.',
      "85 others aren't waiting for approval and are skipped.",
    ]);
    expect(confirmText('approve', [r('awaiting_approval'), r('failed')]).lines[1]).toBe("1 other isn't waiting for approval and is skipped.");
  });

  it('deny is a danger confirm with the count', () => {
    const c = confirmText('deny', many(3, 'awaiting_approval'));
    expect(c).toMatchObject({ title: 'Deny 3 requests?', confirmLabel: 'Deny 3', cancelLabel: 'Back', variant: 'danger' });
    expect(c.lines).toEqual(["They're marked Denied."]);
    expect(confirmText('deny', [r('awaiting_approval')]).lines).toEqual(["It's marked Denied."]);
  });

  it('cancel: the shared text, the withdraw line, the skipped', () => {
    const c = confirmText('cancel', [...many(40, 'awaiting_search'), ...many(15, 'awaiting_approval'), ...many(2, 'downloading'), ...many(43, 'failed')]);
    expect(c).toMatchObject({ title: 'Cancel 57 requests?', confirmLabel: 'Cancel 57', cancelLabel: 'Keep them', variant: 'danger' });
    expect(c.lines).toEqual([
      'Downloads stop and what they fetched is removed, unless another request uses it. Nothing in your library is touched.',
      '15 waiting for approval are withdrawn.',
      "43 others can't be cancelled and are skipped.",
    ]);
    const one = confirmText('cancel', [r('pending')]);
    expect(one).toMatchObject({ title: 'Cancel 1 request?', confirmLabel: 'Cancel 1', cancelLabel: 'Keep it' });
  });
});

const summary = (over: Partial<BulkSummary>): BulkSummary => ({ action: 'delete', total: 0, outcomes: [], preSkipped: [], stopped: false, notStarted: [], ...over });
const item = (id: string, result: 'done' | 'skipped' | 'failed', reason?: string, download?: string) => ({ id, title: `Made Up ${id}`, result, reason, download });
const lib = 'in your library or being imported';

describe('resultText', () => {
  it('all done: one success line', () => {
    const t = resultText(summary({ total: 2, outcomes: [item('a', 'done'), item('b', 'done')] }));
    expect(t).toEqual({ lines: ['Deleted 2.'], details: [], moreDetails: 0, tone: 'success' });
  });

  it('delete: books in the library skipped, failed, and a details list', () => {
    const t = resultText(summary({
      total: 3,
      outcomes: [item('a', 'done'), item('b', 'failed', 'the server answered 500'), item('d', 'done')],
      preSkipped: [item('e', 'skipped', lib), item('f', 'skipped', lib)],
    }));
    expect(t.lines).toEqual(['Deleted 2.', '2 in your library skipped.', '1 failed.']);
    expect(t.details).toEqual(['Made Up b: the server answered 500', `Made Up e: ${lib}`, `Made Up f: ${lib}`]);
    expect(t.tone).toBe('warning');
  });

  it('mixed skip reasons count as skipped (the reasons are in the details)', () => {
    const t = resultText(summary({ total: 2, outcomes: [item('a', 'done'), item('c', 'skipped', 'no longer exists')], preSkipped: [item('e', 'skipped', lib)] }));
    expect(t.lines).toEqual(['Deleted 1.', '2 skipped.']);
  });

  it('a stopped run says what it did and what stays selected', () => {
    const notStarted = [{ id: 'c', title: 'c' }, { id: 'd', title: 'd' }, { id: 'e', title: 'e' }];
    const t = resultText(summary({ action: 'deny', total: 5, outcomes: [item('a', 'done'), item('b', 'done')], stopped: true, notStarted }));
    expect(t.lines).toEqual(['Stopped: denied 2, 3 not started (still selected).']);
    expect(t.tone).toBe('warning');
  });

  it('never says "still selected" when the selection was cleared during the run', () => {
    const t = resultText(summary({ action: 'deny', total: 2, outcomes: [item('a', 'done')], stopped: true, notStarted: [{ id: 'b', title: 'b' }] }), { stillSelected: false });
    expect(t.lines).toEqual(['Stopped: denied 1, 1 not started.']);
  });

  it('cancel: removed downloads and requests with none add no line', () => {
    const t = resultText(summary({
      action: 'cancel',
      total: 3,
      outcomes: [item('a', 'done', undefined, 'removed'), item('b', 'done', undefined, 'none'), item('c', 'done')],
      preSkipped: [item('d', 'skipped', 'not cancellable now')],
    }));
    expect(t.lines).toEqual(['Cancelled 3.', '1 skipped.']);
  });

  it('cancel: the downloads the server kept, and the ones it removes later, each on their own line', () => {
    const t = resultText(summary({
      action: 'cancel',
      total: 6,
      outcomes: [
        item('a', 'done', undefined, 'removed'), item('b', 'done', undefined, 'kept_seeding'), item('c', 'done', undefined, 'not_removed'),
        item('d', 'done', undefined, 'retry_later'), item('e', 'done', undefined, 'retry_later'), item('f', 'done', undefined, 'none'),
      ],
    }));
    expect(t.lines).toEqual([
      'Cancelled 6.',
      '2 downloads stay in the download client.',
      '2 downloads are not removed yet; RMAB tries again on its next seeding cleanup.',
    ]);
    const kept = resultText(summary({ action: 'cancel', total: 1, outcomes: [item('a', 'done', undefined, 'kept')] }));
    expect(kept.lines).toEqual(['Cancelled 1.', '1 download stays in the download client.']);
    const later = resultText(summary({ action: 'cancel', total: 1, outcomes: [item('a', 'done', undefined, 'retry_later')] }));
    expect(later.lines).toEqual(['Cancelled 1.', '1 download is not removed yet; RMAB tries again on its next seeding cleanup.']);
  });

  it('details stop at 50', () => {
    const t = resultText(summary({ total: 60, outcomes: Array.from({ length: 60 }, (_, i) => item(String(i), 'failed', 'boom')) }));
    expect(t.details).toHaveLength(50);
    expect(t.moreDetails).toBe(10);
  });
});
