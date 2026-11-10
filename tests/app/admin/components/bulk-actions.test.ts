/**
 * Component: Bulk Request Actions Tests (eligibility, per-request calls)
 * Documentation: documentation/admin-features/bulk-request-actions.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchWithAuthMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/utils/api', () => ({ fetchWithAuth: fetchWithAuthMock }));

import { appliesTo, bulkCounts, classifyRefusal, runBulkItem, type BulkRow } from '@/app/admin/components/bulk-actions';

const r = (status: string, extra: Partial<BulkRow> = {}): BulkRow => ({ requestId: `${status}-${extra.inLibrary ? 'lib' : 'x'}`, title: 'Made Up', status, ...extra });
const answer = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });

describe('bulk action eligibility', () => {
  it('each action applies as its single action does', () => {
    expect(appliesTo('approve', r('awaiting_approval'))).toBe(true);
    expect(appliesTo('deny', r('awaiting_approval'))).toBe(true);
    expect(appliesTo('approve', r('pending'))).toBe(false);
    for (const s of ['pending', 'searching', 'downloading', 'awaiting_search', 'awaiting_approval', 'awaiting_release']) {
      expect(appliesTo('cancel', r(s))).toBe(true);
    }
    for (const s of ['failed', 'cancelled', 'available', 'processing', 'denied']) expect(appliesTo('cancel', r(s))).toBe(false);
    expect(appliesTo('delete', r('failed'))).toBe(true);
    expect(appliesTo('delete', r('available', { inLibrary: true }))).toBe(false);
    expect(appliesTo('delete', r('cancelled', { inLibrary: true }))).toBe(false);
  });

  it('counts a mixed selection per action', () => {
    const rows = [
      r('awaiting_approval'), r('awaiting_approval'),
      r('downloading'), r('failed'), r('available', { inLibrary: true }), r('cancelled', { inLibrary: true }),
    ];
    expect(bulkCounts(rows)).toEqual({ approve: 2, deny: 2, cancel: 3, delete: 4 });
    expect(bulkCounts([])).toEqual({ approve: 0, deny: 0, cancel: 0, delete: 0 });
  });
});

describe('runBulkItem: the existing single routes', () => {
  beforeEach(() => fetchWithAuthMock.mockReset());

  it.each([
    ['approve', '/api/admin/requests/id-1/approve', 'POST', { action: 'approve' }],
    ['deny', '/api/admin/requests/id-1/approve', 'POST', { action: 'deny' }],
    ['cancel', '/api/requests/id-1', 'PATCH', { action: 'cancel' }],
    ['delete', '/api/admin/requests/id-1?keepLibrary=1', 'DELETE', undefined],
  ] as const)('%s calls %s', async (action, url, method, body) => {
    fetchWithAuthMock.mockResolvedValueOnce(answer(200, { success: true }));
    expect(await runBulkItem(action, 'id-1')).toEqual({ result: 'done' });
    const [calledUrl, init] = fetchWithAuthMock.mock.calls[0];
    expect(calledUrl).toBe(url);
    expect(init.method).toBe(method);
    expect(init.body === undefined ? undefined : JSON.parse(init.body)).toEqual(body);
  });

  it('cancel passes the download outcome on', async () => {
    fetchWithAuthMock.mockResolvedValueOnce(answer(200, { success: true, download: 'kept_seeding' }));
    expect(await runBulkItem('cancel', 'id-1')).toEqual({ result: 'done', download: 'kept_seeding' });
  });

  it('a network error is a failed item, never a throw', async () => {
    fetchWithAuthMock.mockRejectedValueOnce(new Error('Failed to fetch'));
    expect(await runBulkItem('delete', 'id-1')).toEqual({ result: 'failed', reason: 'Failed to fetch' });
  });
});

describe('classifyRefusal', () => {
  it('a request that moved on or is protected is skipped with a reason', () => {
    expect(classifyRefusal('delete', 404, { error: 'NotFound' })).toEqual({ result: 'skipped', reason: 'no longer exists' });
    expect(classifyRefusal('delete', 409, { error: 'InLibrary' })).toEqual({ result: 'skipped', reason: 'in your library or being imported' });
    expect(classifyRefusal('approve', 400, { error: 'InvalidStatus' })).toEqual({ result: 'skipped', reason: 'not waiting for approval' });
    expect(classifyRefusal('deny', 400, { error: 'InvalidStatus' })).toEqual({ result: 'skipped', reason: 'not waiting for approval' });
    expect(classifyRefusal('cancel', 400, { error: 'ValidationError' })).toEqual({ result: 'skipped', reason: 'not cancellable now' });
  });

  it('anything else fails with the server message', () => {
    expect(classifyRefusal('approve', 503, { message: 'The download client is not reachable' })).toEqual({ result: 'failed', reason: 'The download client is not reachable' });
    expect(classifyRefusal('delete', 500, {})).toEqual({ result: 'failed', reason: 'the server answered 500' });
    expect(classifyRefusal('cancel', 409, { error: 'InLibrary' })).toEqual({ result: 'failed', reason: 'the server answered 409' });
  });
});
