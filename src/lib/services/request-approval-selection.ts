/**
 * Component: Request Approval Release Selection
 * Documentation: documentation/admin-features/request-approval.md
 *
 * Validates the release an approval would download (the admin's interactive-search pick, or the
 * requester's stored pick) before processRequestApproval claims the request. Same rules for both
 * picks; older stored rows were never validated.
 */

import { guardEbookSelection, guardTorrentSelection } from '@/lib/services/download-selection-guard';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('Service.RequestApproval');

export type ApprovalSelection =
  /** Download this validated release (null: no pick, or a dropped stored pick → automatic search) */
  | { ok: true; selectedTorrent: any; droppedPickReason: string | null }
  /** Source temporarily unreachable: keep the pick (status unchanged) so approval can be retried */
  | { ok: false; reason: 'source_unavailable'; message: string }
  /** The admin's own pick cannot be used */
  | { ok: false; reason: 'invalid_selection'; message: string };

export async function resolveApprovalSelection(
  requestId: string,
  isEbookRequest: boolean,
  adminSelectedTorrent: unknown,
  storedTorrent: unknown
): Promise<ApprovalSelection> {
  const effectiveTorrent = (adminSelectedTorrent || storedTorrent) as any;
  if (!effectiveTorrent) {
    return { ok: true, selectedTorrent: null, droppedPickReason: null };
  }

  const selectionCheck = isEbookRequest && effectiveTorrent?.source
    ? await guardEbookSelection(effectiveTorrent)
    : await guardTorrentSelection(effectiveTorrent);

  if (selectionCheck.ok) {
    return { ok: true, selectedTorrent: selectionCheck.value, droppedPickReason: null };
  }
  if (selectionCheck.retryable) {
    return { ok: false, reason: 'source_unavailable', message: selectionCheck.error };
  }
  if (adminSelectedTorrent) {
    return {
      ok: false,
      reason: 'invalid_selection',
      message: `The admin-selected release cannot be used: ${selectionCheck.error}. Pick another release with interactive search.`,
    };
  }

  // Stored user pick is unusable (or has no links any more): approve with an automatic search instead
  logger.warn(`Stored release pick for request ${requestId} cannot be used; falling back to automatic search`, {
    requestId,
    reason: selectionCheck.error,
  });
  return { ok: true, selectedTorrent: null, droppedPickReason: selectionCheck.error };
}
