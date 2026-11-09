/**
 * Component: Cancel Confirm Text Tests
 * Documentation: documentation/admin-features/request-cancel.md
 */

import { describe, expect, it } from 'vitest';
import {
  CANCEL_CONFIRM_AUDIOBOOK,
  CANCEL_CONFIRM_EBOOK,
  CANCEL_CONFIRM_NO_DOWNLOAD,
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
