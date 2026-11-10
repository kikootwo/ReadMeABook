/**
 * Component: Bulk Request Actions (eligibility and the per-request call)
 * Documentation: documentation/admin-features/bulk-request-actions.md
 *
 * Each bulk action is the existing single action, called once per request from the page:
 * approve and deny through POST /api/admin/requests/:id/approve, cancel through
 * PATCH /api/requests/:id, delete through DELETE /api/admin/requests/:id?keepLibrary=1
 * (the server refuses a book in the library or being imported). No bulk route.
 */

import { CANCELLABLE_STATUSES } from '@/lib/constants/request-statuses';
import { fetchWithAuth } from '@/lib/utils/api';

export const BULK_ACTIONS = ['approve', 'deny', 'cancel', 'delete'] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

/** The row fields bulk actions read (from GET /api/admin/requests). */
export interface BulkRow {
  requestId: string;
  title: string;
  displayTitle?: string;
  status: string;
  type?: 'audiobook' | 'ebook';
  /** Derived by the list route: the book is in the library or being imported */
  inLibrary?: boolean;
}

export type BulkItemResult = 'done' | 'skipped' | 'failed';

export interface BulkItemOutcome {
  result: BulkItemResult;
  reason?: string;
  /** Cancel only: the server's download outcome (removed, kept_seeding, retry_later, ...) */
  download?: string;
}

export interface BulkItem {
  id: string;
  title: string;
}

/** What one run did, item by item. */
export interface BulkSummary {
  action: BulkAction;
  /** Requests the run was started on (pre-skipped ones not included) */
  total: number;
  outcomes: (BulkItem & BulkItemOutcome)[];
  /** Selected but not eligible: never sent */
  preSkipped: (BulkItem & BulkItemOutcome)[];
  stopped: boolean;
  notStarted: BulkItem[];
}

/** Why a selected request is skipped: before the run (not eligible) or by the server's answer. */
export const SKIP_REASONS = {
  notAwaitingApproval: 'not waiting for approval',
  notCancellable: 'not cancellable now',
  inLibrary: 'in your library or being imported',
  gone: 'no longer exists',
} as const;

/** Whether `action` applies to `row`, exactly as the single action allows it. */
export function appliesTo(action: BulkAction, row: BulkRow): boolean {
  switch (action) {
    case 'approve':
    case 'deny':
      return row.status === 'awaiting_approval';
    case 'cancel':
      return (CANCELLABLE_STATUSES as readonly string[]).includes(row.status);
    case 'delete':
      return !row.inLibrary;
  }
}

/** The reason a selected row that `action` does not apply to is skipped. */
export function notEligibleReason(action: BulkAction): string {
  if (action === 'cancel') return SKIP_REASONS.notCancellable;
  if (action === 'delete') return SKIP_REASONS.inLibrary;
  return SKIP_REASONS.notAwaitingApproval;
}

/** How many of `rows` each action applies to. */
export function bulkCounts(rows: BulkRow[]): Record<BulkAction, number> {
  const counts = { approve: 0, deny: 0, cancel: 0, delete: 0 };
  for (const row of rows) {
    for (const action of BULK_ACTIONS) if (appliesTo(action, row)) counts[action]++;
  }
  return counts;
}

/** The single action's request for one id. */
function singleActionCall(action: BulkAction, id: string): { url: string; init: RequestInit } {
  const headers = { 'Content-Type': 'application/json' };
  const enc = encodeURIComponent(id);
  switch (action) {
    case 'approve':
    case 'deny':
      return { url: `/api/admin/requests/${enc}/approve`, init: { method: 'POST', headers, body: JSON.stringify({ action }) } };
    case 'cancel':
      return { url: `/api/requests/${enc}`, init: { method: 'PATCH', headers, body: JSON.stringify({ action: 'cancel' }) } };
    case 'delete':
      return { url: `/api/admin/requests/${enc}?keepLibrary=1`, init: { method: 'DELETE', headers } };
  }
}

/** A refused answer: skipped when the request moved on (or is protected), failed otherwise. */
export function classifyRefusal(action: BulkAction, status: number, body: { error?: string; message?: string }): BulkItemOutcome {
  if (status === 404) return { result: 'skipped', reason: SKIP_REASONS.gone };
  if (action === 'delete' && status === 409 && body.error === 'InLibrary') return { result: 'skipped', reason: SKIP_REASONS.inLibrary };
  if ((action === 'approve' || action === 'deny') && status === 400 && body.error === 'InvalidStatus') {
    return { result: 'skipped', reason: SKIP_REASONS.notAwaitingApproval };
  }
  if (action === 'cancel' && status === 400 && body.error === 'ValidationError') return { result: 'skipped', reason: SKIP_REASONS.notCancellable };
  return { result: 'failed', reason: body.message || `the server answered ${status}` };
}

/** Run `action` on one request through its single route; never throws. */
export async function runBulkItem(action: BulkAction, id: string): Promise<BulkItemOutcome> {
  const { url, init } = singleActionCall(action, id);
  try {
    const response = await fetchWithAuth(url, init);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return classifyRefusal(action, response.status, body ?? {});
    return action === 'cancel' && typeof body?.download === 'string' ? { result: 'done', download: body.download } : { result: 'done' };
  } catch (error) {
    return { result: 'failed', reason: error instanceof Error ? error.message : 'the request did not complete' };
  }
}
