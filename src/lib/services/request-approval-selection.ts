/**
 * Component: Request Approval Release Pick
 * Documentation: documentation/admin-features/request-approval.md
 *
 * Which release an approval downloads: the admin's pick (web interactive search) or the
 * user's stored pick, checked with the same download-selection guard either way (stored picks
 * from older rows were never validated). An unusable stored pick falls back to a search.
 */

import { guardEbookSelection, guardTorrentSelection } from '@/lib/services/download-selection-guard';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('RequestApproval');

export type ApprovalPick =
  /** Download this release (already checked by the guard). */
  | { kind: 'download'; release: any; source: 'admin' | 'user' }
  /** No usable release: search. `droppedPickReason` is set when a stored pick was unusable. */
  | { kind: 'search'; droppedPickReason: string | null }
  /** The release source could not be reached: nothing changes, try again (503). */
  | { kind: 'unavailable'; error: string }
  /** The admin's own pick is unusable (400). */
  | { kind: 'rejected'; message: string };

export async function chooseApprovalPick(
  request: { id: string; type: string; selectedTorrent: unknown },
  adminSelectedTorrent: unknown
): Promise<ApprovalPick> {
  const effective = adminSelectedTorrent || request.selectedTorrent;
  if (!effective) return { kind: 'search', droppedPickReason: null };

  const candidate = effective as any;
  const check = request.type === 'ebook' && candidate?.source
    ? await guardEbookSelection(candidate)
    : await guardTorrentSelection(candidate);
  if (check.ok) return { kind: 'download', release: check.value, source: adminSelectedTorrent ? 'admin' : 'user' };
  // Source temporarily unreachable: keep the pick (status unchanged) so approval can be retried
  if (check.retryable) return { kind: 'unavailable', error: check.error };
  if (adminSelectedTorrent) {
    return {
      kind: 'rejected',
      message: `The admin-selected release cannot be used: ${check.error}. Pick another release with interactive search.`,
    };
  }
  // Stored user pick is unusable (or has no links any more): approve with an automatic search instead
  logger.warn(`Stored release pick for request ${request.id} cannot be used; falling back to automatic search`, {
    requestId: request.id,
    reason: check.error,
  });
  return { kind: 'search', droppedPickReason: check.error };
}
