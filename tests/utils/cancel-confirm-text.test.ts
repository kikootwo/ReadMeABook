/**
 * Component: Cancel Confirm Text Tests
 * Documentation: documentation/admin-features/request-cancel.md
 */

import { describe, expect, it } from 'vitest';
import {
  CANCEL_CONFIRM_AUDIOBOOK,
  CANCEL_CONFIRM_EBOOK,
  CANCEL_CONFIRM_NO_DOWNLOAD,
  BULK_CANCEL_TEXT,
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

describe('bulkCancelConfirmLines (one text source with the single cancel)', () => {
  const counts = { total: 40, downloadingAudiobooks: 12, downloadingEbooks: 1, awaitingApproval: 3 };

  it("uses the 'list' sentences today", () => {
    expect(BULK_CANCEL_TEXT).toBe('list');
    expect(bulkCancelConfirmLines(counts)).toEqual([
      'They stay in the list as Cancelled.',
      '3 waiting for approval are withdrawn; the user can request them again later.',
      'Nothing in your library is touched.',
    ]);
    expect(bulkCancelConfirmLines({ total: 1, downloadingAudiobooks: 0, downloadingEbooks: 0, awaitingApproval: 1 })).toEqual([
      'It stays in the list as Cancelled.',
      '1 waiting for approval is withdrawn; the user can request it again later.',
      'Nothing in your library is touched.',
    ]);
  });

  it("'single' reuses the single cancel's download sentences in the plural", () => {
    expect(bulkCancelConfirmLines(counts, 'single')).toEqual([
      'RMAB stops looking for them.',
      'For the 12 audiobooks downloading, it stops the download and removes what it downloaded so far, unless another request still uses it. A download that already finished may stay in the download client to seed.',
      'For the ebook downloading, it stops the download. What it already downloaded may stay in the download client or the downloads folder.',
      '3 waiting for approval are withdrawn; the user can request them again later.',
      'Nothing in your library is touched.',
    ]);
    expect(CANCEL_CONFIRM_AUDIOBOOK).toContain('removes what it downloaded so far, unless another request still uses it. A download that already finished may stay in the download client to seed.');
    expect(CANCEL_CONFIRM_EBOOK).toContain('What it already downloaded may stay in the download client or the downloads folder.');
  });
});
