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

/** What a bulk cancel (admin table, #212) will act on, by the kind of sentence each needs. */
export interface BulkCancelCounts {
  /** Every request the cancel acts on */
  total: number;
  downloadingAudiobooks: number;
  downloadingEbooks: number;
  /** Withdrawn rather than cancelled (the single action calls it "Withdraw request") */
  awaitingApproval: number;
}

/**
 * Which sentences the bulk cancel confirm uses: 'list' (the request stays in the list as
 * Cancelled) or 'single' (the single cancel's own download sentences, in the plural).
 */
export const BULK_CANCEL_TEXT: 'list' | 'single' = 'list';

const areIs = (n: number) => (n === 1 ? 'is' : 'are');

/** The bulk cancel confirm's body, one sentence per line. */
export function bulkCancelConfirmLines(counts: BulkCancelCounts, variant: 'list' | 'single' = BULK_CANCEL_TEXT): string[] {
  const lines: string[] = [];
  if (variant === 'single') {
    lines.push(counts.total === 1 ? 'RMAB stops looking for it.' : 'RMAB stops looking for them.');
    const a = counts.downloadingAudiobooks;
    if (a > 0) {
      lines.push(
        `For the ${a === 1 ? 'audiobook' : `${a} audiobooks`} downloading, it stops the download and removes what it downloaded so far, ` +
          'unless another request still uses it. A download that already finished may stay in the download client to seed.'
      );
    }
    const e = counts.downloadingEbooks;
    if (e > 0) {
      lines.push(
        `For the ${e === 1 ? 'ebook' : `${e} ebooks`} downloading, it stops the download. ` +
          'What it already downloaded may stay in the download client or the downloads folder.'
      );
    }
  } else {
    lines.push(counts.total === 1 ? 'It stays in the list as Cancelled.' : 'They stay in the list as Cancelled.');
  }
  if (counts.awaitingApproval > 0) {
    lines.push(`${counts.awaitingApproval} waiting for approval ${areIs(counts.awaitingApproval)} withdrawn; the user can request ${counts.awaitingApproval === 1 ? 'it' : 'them'} again later.`);
  }
  lines.push('Nothing in your library is touched.');
  return lines;
}
