/**
 * Component: Cancel Confirm Text Tests
 * Documentation: documentation/admin-features/request-cancel.md
 */

import { describe, expect, it } from 'vitest';
import {
  CANCEL_CONFIRM_AUDIOBOOK,
  CANCEL_CONFIRM_EBOOK,
  CANCEL_CONFIRM_NO_DOWNLOAD,
  bulkCancelConfirmLines,
  cancelConfirmText,
} from '@/lib/utils/cancel-confirm-text';
import { CANCELLABLE_STATUSES } from '@/lib/constants/request-statuses';

describe('cancelConfirmText', () => {
  it.each(CANCELLABLE_STATUSES.filter((s) => s !== 'downloading' && s !== 'awaiting_approval'))(
    '%s (no download yet): the short line, for either type', (status) => {
      expect(cancelConfirmText(status, 'audiobook')).toBe(CANCEL_CONFIRM_NO_DOWNLOAD);
      expect(cancelConfirmText(status, 'ebook')).toBe(CANCEL_CONFIRM_NO_DOWNLOAD);
      expect(CANCEL_CONFIRM_NO_DOWNLOAD).not.toMatch(/download/);
    }
  );

  it('a downloading audiobook: what it fetched is removed unless shared; a finished one may stay to seed', () => {
    expect(cancelConfirmText('downloading', 'audiobook')).toBe(CANCEL_CONFIRM_AUDIOBOOK);
    expect(cancelConfirmText('downloading', undefined)).toBe(CANCEL_CONFIRM_AUDIOBOOK);
  });

  it('a downloading ebook is promised no removal (a direct download keeps its file)', () => {
    expect(cancelConfirmText('downloading', 'ebook')).toBe(CANCEL_CONFIRM_EBOOK);
    expect(CANCEL_CONFIRM_EBOOK).not.toMatch(/removes/);
  });
});

describe('bulkCancelConfirmLines (the bulk cancel confirm)', () => {
  it('says what the single cancel does: the downloads stop and what they fetched is removed', () => {
    expect(bulkCancelConfirmLines({ total: 57, awaitingApproval: 15 })).toEqual([
      'Downloads stop and what they fetched is removed, unless another request uses it. Nothing in your library is touched.',
      '15 waiting for approval are withdrawn.',
    ]);
    expect(bulkCancelConfirmLines({ total: 3, awaitingApproval: 0 })).toEqual([
      'Downloads stop and what they fetched is removed, unless another request uses it. Nothing in your library is touched.',
    ]);
  });

  it('one request: the singular forms', () => {
    expect(bulkCancelConfirmLines({ total: 1, awaitingApproval: 1 })).toEqual([
      'Its download stops and what it fetched is removed, unless another request uses it. Nothing in your library is touched.',
      '1 waiting for approval is withdrawn.',
    ]);
  });
});
