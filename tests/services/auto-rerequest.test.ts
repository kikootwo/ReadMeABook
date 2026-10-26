/**
 * Component: Automatic re-request rules tests (#409)
 * Documentation: documentation/admin-features/release-blocklist.md
 *
 * Shelf sync and watched lists never replace a cancelled request, replace a
 * failed/warn request at once only when its attempt added a block, and
 * otherwise wait 1, 3, 7, 14, then every 30 days from the failure.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import type { AutoReRequestCandidate } from '@/lib/services/auto-rerequest';

const prismaMock = createPrismaMock();
const log = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/utils/logger', () => ({ RMABLogger: { create: () => log } }));

const { decideAutoReRequest, autoReRequestWaitDays } = await import('@/lib/services/auto-rerequest');

const DAY = 24 * 60 * 60 * 1000;
const CREATED = new Date('2026-10-01T00:00:00Z');
const FAILED = new Date('2026-10-02T00:00:00Z');

function existing(overrides: Partial<AutoReRequestCandidate> = {}): AutoReRequestCandidate {
  return { id: 'req-old', status: 'failed', createdAt: CREATED, updatedAt: FAILED, autoRerequestCount: 0, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.blockedRelease.count.mockResolvedValue(0);
});

describe('autoReRequestWaitDays', () => {
  it.each([[0, 1], [1, 3], [2, 7], [3, 14], [4, 30], [5, 30], [40, 30]])('after %i automatic retries waits %i days', (retries, days) => {
    expect(autoReRequestWaitDays(retries)).toBe(days);
  });
});

describe('decideAutoReRequest', () => {
  it('never replaces a cancelled request, however old, and does not query the blocklist', async () => {
    const decision = await decideAutoReRequest(existing({ status: 'cancelled', updatedAt: new Date(FAILED.getTime() - 400 * DAY) }), 'Book');

    expect(decision.skip).toMatchObject({ success: false, reason: 'cancelled_by_user' });
    expect(prismaMock.blockedRelease.count).not.toHaveBeenCalled();
  });

  it.each(['failed', 'warn'])('waits for a %s request with no new block, then replaces it with the count + 1', async (status) => {
    const request = existing({ status, autoRerequestCount: 2 }); // third retry: wait 7 days

    const early = await decideAutoReRequest(request, 'Book', new Date(FAILED.getTime() + 7 * DAY - 1));
    expect(early.skip).toMatchObject({ success: false, reason: 'retry_not_due' });
    expect(early.skip?.message).toContain(new Date(FAILED.getTime() + 7 * DAY).toISOString());
    expect(log.debug).toHaveBeenCalledTimes(1);
    expect(log.info).not.toHaveBeenCalled();

    const due = await decideAutoReRequest(request, 'Book', new Date(FAILED.getTime() + 7 * DAY));
    expect(due).toEqual({
      skip: null,
      nextCount: 3,
      logLine: `Re-requested ${status} request req-old ("Book") automatically (retry 3); if it fails again with no new block, the next automatic retry waits 14 days`,
    });
    // The decision itself never logs at info: the caller does, once the request is created
    expect(log.info).not.toHaveBeenCalled();
  });

  it('waits one day before the first automatic retry', async () => {
    expect((await decideAutoReRequest(existing(), 'Book', new Date(FAILED.getTime() + DAY - 1))).skip?.reason).toBe('retry_not_due');
    expect(await decideAutoReRequest(existing(), 'Book', new Date(FAILED.getTime() + DAY))).toMatchObject({ skip: null, nextCount: 1 });
  });

  it.each(['failed', 'warn'])('replaces a %s request at once when its attempt added a block, keeping the count', async (status) => {
    prismaMock.blockedRelease.count.mockResolvedValue(1);

    const decision = await decideAutoReRequest(existing({ status, autoRerequestCount: 3 }), 'Book', FAILED);

    expect(decision).toMatchObject({ skip: null, nextCount: 3 });
    expect(decision.logLine).toContain('(a release was blocked, so at once); if it fails again with no new block, the next automatic retry waits 14 days');
  });

  it('counts only blocks written during this attempt: blocks carried over from earlier requests are older than the request', async () => {
    // The where is the whole test: a block moved over by createRequestReplacing keeps its createdAt
    // (it only updateMany's requestId, see tests/services/request-creator-rerequest.test.ts:80),
    // so it is older than this request's createdAt and is not counted.
    const decision = await decideAutoReRequest(existing(), 'Book', FAILED);

    expect(prismaMock.blockedRelease.count).toHaveBeenCalledWith({
      where: { requestId: 'req-old', createdAt: { gte: CREATED } },
    });
    expect(decision.skip?.reason).toBe('retry_not_due');
  });
});
