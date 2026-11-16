/**
 * Component: API Token Request Approval audit outcomes
 * Documentation: documentation/backend/services/api-tokens.md
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));

import { approvalOutcome, thrownApprovalOutcome } from '@/lib/services/api-token-approval';
import type { ApprovalResult } from '@/lib/services/request-approval.service';

const request = {} as never;

describe('approvalOutcome', () => {
  it.each([
    [{ ok: true, action: 'approve', status: 'pending', isEbook: false, pickSource: null, droppedPickReason: null, releaseDate: null, request }, 'approved', 'pending'],
    [{ ok: false, code: 'not_found' }, 'not_found', null],
    [{ ok: false, code: 'invalid_status', currentStatus: 'downloading' }, 'invalid_status', 'downloading'],
    [{ ok: false, code: 'source_unavailable', error: 'x' }, 'source_unavailable', 'awaiting_approval'],
    [{ ok: false, code: 'pick_rejected', message: 'x' }, 'pick_rejected', 'awaiting_approval'],
  ] as Array<[ApprovalResult, string, string | null]>)('maps %j', (result, outcome, status) => {
    expect(approvalOutcome(result)).toEqual({ outcome, status });
  });

  it('a deny result (a token never reaches one) is logged as error, never as its own outcome', () => {
    expect(approvalOutcome({ ok: true, action: 'deny', request })).toEqual({ outcome: 'error', status: 'denied' });
  });
});

describe('thrownApprovalOutcome', () => {
  it('a body that could not be read or validated is invalid_body', () => {
    expect(thrownApprovalOutcome({ invalidBody: true, keptStatus: null })).toEqual({ outcome: 'invalid_body', status: null });
  });

  it('a start that kept its claim is approved with the status the claim set', () => {
    expect(thrownApprovalOutcome({ invalidBody: false, keptStatus: 'downloading' })).toEqual({ outcome: 'approved', status: 'downloading' });
  });

  it('anything else is error with no status', () => {
    expect(thrownApprovalOutcome({ invalidBody: false, keptStatus: null })).toEqual({ outcome: 'error', status: null });
  });
});
