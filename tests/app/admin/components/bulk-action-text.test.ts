/**
 * Component: Bulk Request Actions Text Tests
 * Documentation: documentation/admin-features/bulk-request-actions.md
 */

import { describe, expect, it } from 'vitest';
import { buttonText, confirmText, DELETE_COMES_BACK_LINE, progressText, resultText, selectedText } from '@/app/admin/components/bulk-action-text';
import type { BulkRow, BulkSummary } from '@/app/admin/components/bulk-actions';

let n = 0;
const r = (status: string, extra: Partial<BulkRow> = {}): BulkRow => ({ requestId: `id-${n++}`, title: 'Made Up', status, ...extra });
const many = (count: number, status: string, extra: Partial<BulkRow> = {}) => Array.from({ length: count }, () => r(status, extra));

describe('bar texts', () => {
  it('count, buttons and progress', () => {
    expect(selectedText(52)).toBe('52 selected');
    expect(buttonText('delete', 52)).toBe('Delete 52');
    expect(buttonText('approve', 0)).toBe('Approve 0');
    expect(progressText('delete', 120, 280)).toBe('Deleting 120 of 280...');
  });
});

describe('confirmText', () => {
  it('delete states the count, what is removed, the books in the library skipped and that requests can come back', () => {
    const c = confirmText('delete', [...many(278, 'failed'), ...many(2, 'available', { inLibrary: true })]);
    expect(c.title).toBe('Delete 278 requests?');
    expect(c.confirmLabel).toBe('Delete 278 requests');
    expect(c.variant).toBe('danger');
    expect(c.lines).toEqual([
      "They're removed and can be requested again.",
      "Downloads RMAB added are removed from the download client, unless they're still seeding or another request uses them.",
      'Nothing in your library is touched.',
      '2 selected are books in your library or being imported and are left as they are.',
      DELETE_COMES_BACK_LINE,
    ]);
    expect(DELETE_COMES_BACK_LINE).toMatch(/watched author.*shelf.*cancel/);
  });

  it('singular texts', () => {
    const c = confirmText('delete', [r('failed'), r('available', { inLibrary: true })]);
    expect(c.title).toBe('Delete 1 request?');
    expect(c.lines[0]).toBe("It's removed and can be requested again.");
    expect(c.lines[3]).toBe('1 selected is a book in your library or being imported and is left as it is.');
    expect(confirmText('approve', [r('awaiting_approval')]).title).toBe('Approve 1 request?');
    expect(confirmText('cancel', [r('pending')]).title).toBe('Cancel 1 request?');
  });

  it('approve says it starts that many searches and names the skipped', () => {
    const c = confirmText('approve', [...many(12, 'awaiting_approval'), r('failed')]);
    expect(c.title).toBe('Approve 12 requests?');
    expect(c.confirmLabel).toBe('Approve 12 requests');
    expect(c.variant).toBe('primary');
    expect(c.lines).toEqual([
      "RMAB starts searching for each one now, or on its release date if it isn't out yet.",
      'A release the user already picked starts downloading at once.',
      "1 selected isn't waiting for approval and is skipped.",
    ]);
  });

  it('deny is a danger confirm with the count', () => {
    const c = confirmText('deny', many(3, 'awaiting_approval'));
    expect(c).toMatchObject({ title: 'Deny 3 requests?', confirmLabel: 'Deny 3 requests', variant: 'danger' });
    expect(c.lines).toEqual(["They're marked Denied and not searched for."]);
  });

  it('cancel: the shared text, the withdraw wording for those waiting for approval, the skipped', () => {
    const c = confirmText('cancel', [...many(37, 'awaiting_search'), ...many(3, 'awaiting_approval'), ...many(2, 'downloading'), r('failed')]);
    expect(c).toMatchObject({ title: 'Cancel 42 requests?', confirmLabel: 'Cancel 42 requests', cancelLabel: 'Keep requests', variant: 'danger' });
    expect(c.lines).toEqual([
      'They stay in the list as Cancelled.',
      '3 waiting for approval are withdrawn; the user can request them again later.',
      'Nothing in your library is touched.',
      "1 selected can't be cancelled now and is skipped.",
    ]);
  });
});

const summary = (over: Partial<BulkSummary>): BulkSummary => ({ action: 'delete', total: 0, outcomes: [], preSkipped: [], stopped: false, notStarted: [], ...over });
const item = (id: string, result: 'done' | 'skipped' | 'failed', reason?: string, download?: string) => ({ id, title: `Made Up ${id}`, result, reason, download });

describe('resultText', () => {
  it('all done: one success line', () => {
    const t = resultText(summary({ total: 2, outcomes: [item('a', 'done'), item('b', 'done')] }));
    expect(t).toEqual({ lines: ['Deleted 2 requests.'], details: [], moreDetails: 0, tone: 'success' });
  });

  it('skipped and failed counts, grouped reasons and a details list', () => {
    const t = resultText(summary({
      total: 4,
      outcomes: [item('a', 'done'), item('b', 'failed', 'the server answered 500'), item('c', 'skipped', 'no longer exists'), item('d', 'done')],
      preSkipped: [item('e', 'skipped', 'in your library or being imported'), item('f', 'skipped', 'in your library or being imported')],
    }));
    expect(t.lines).toEqual([
      'Deleted 2 requests.',
      '3 skipped (2 in your library or being imported, 1 no longer exists).',
      '1 failed.',
    ]);
    expect(t.details).toEqual([
      'Made Up b: the server answered 500',
      'Made Up e: in your library or being imported',
      'Made Up f: in your library or being imported',
      'Made Up c: no longer exists',
    ]);
    expect(t.tone).toBe('warning');
  });

  it('a stopped run says where it stopped and what stays selected', () => {
    const t = resultText(summary({ action: 'approve', total: 5, outcomes: [item('a', 'done'), item('b', 'done')], stopped: true, notStarted: [{ id: 'c', title: 'c' }, { id: 'd', title: 'd' }, { id: 'e', title: 'e' }] }));
    expect(t.lines).toEqual(['Stopped after 2 of 5. Approved 2 requests.', '3 not started; still selected.']);
    expect(t.tone).toBe('warning');
  });

  it('cancel counts downloads still in the client', () => {
    const t = resultText(summary({ action: 'cancel', total: 4, outcomes: [item('a', 'done', undefined, 'removed'), item('b', 'done', undefined, 'kept_seeding'), item('c', 'done', undefined, 'retry_later'), item('d', 'done', undefined, 'none')] }));
    expect(t.lines).toEqual(['Cancelled 4 requests.', '2 downloads are still in the download client.']);
  });

  it('details stop at 50', () => {
    const t = resultText(summary({ total: 60, outcomes: Array.from({ length: 60 }, (_, i) => item(String(i), 'failed', 'boom')) }));
    expect(t.details).toHaveLength(50);
    expect(t.moreDetails).toBe(10);
  });
});
