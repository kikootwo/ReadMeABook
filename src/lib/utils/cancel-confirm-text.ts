/**
 * Component: Cancel Confirm Text
 * Documentation: documentation/admin-features/request-cancel.md
 *
 * What the cancel dialogs (request card, admin table, bulk cancel) say a cancel does. Only a downloading
 * audiobook is promised that what it fetched is removed. An ebook's file may stay (a direct
 * download's file is not removed). A request with no download yet only stops being looked for.
 */

export const CANCEL_CONFIRM_NO_DOWNLOAD = 'RMAB stops looking for this book.';

export const CANCEL_CONFIRM_EBOOK =
  "RMAB stops this request's download. What it already downloaded may stay in the download client or the downloads folder.";

export const CANCEL_CONFIRM_AUDIOBOOK =
  "RMAB stops this request's download and removes what it downloaded so far, unless another request still uses it. A download that already finished may stay in the download client to seed.";

/** The dialog text for cancelling a request in `status` (not `awaiting_approval`, which is withdrawn) */
export function cancelConfirmText(status: string, type: string | undefined): string {
  if (status !== 'downloading') return CANCEL_CONFIRM_NO_DOWNLOAD;
  return type === 'ebook' ? CANCEL_CONFIRM_EBOOK : CANCEL_CONFIRM_AUDIOBOOK;
}

/** What a bulk cancel (admin table, #212) will act on. */
export interface BulkCancelCounts {
  /** Every request the cancel acts on */
  total: number;
  /** Withdrawn rather than cancelled (the single action calls it "Withdraw request") */
  awaitingApproval: number;
}

/** The bulk cancel confirm's body, one line each. Its first sentence says what the single cancel does. */
export function bulkCancelConfirmLines(counts: BulkCancelCounts): string[] {
  const first = counts.total === 1 ? 'Its download stops and what it fetched is removed' : 'Downloads stop and what they fetched is removed';
  const lines = [`${first}, unless another request uses it. Nothing in your library is touched.`];
  const waiting = counts.awaitingApproval;
  if (waiting > 0) lines.push(`${waiting} waiting for approval ${waiting === 1 ? 'is' : 'are'} withdrawn.`);
  return lines;
}
