/**
 * Component: Library scan ASIN match records a request completed while awaiting approval (#232)
 * Documentation: documentation/backend/database.md
 *
 * A request matched by ASIN while `awaiting_approval` still completes and notifies as before, and
 * records `approvalBypassedBy = 'asin_match:awaiting_approval'` in the same compare-and-set. The
 * guard follows the loaded status: a request approved (or sent back to approval) between the read
 * and the write is left for the next run. Real: match-requests. Mocked: prisma (in-memory holder),
 * the ASIN matcher, the job queue.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { createLibraryDb, resetLibraryDb, wireLibraryDb, type Row } from '../helpers/library-link-db';
import type { RMABLogger } from '@/lib/utils/logger';

const prismaMock = createPrismaMock();
const jobQueueMock = vi.hoisted(() => ({ addNotificationJob: vi.fn() }));
const findPlexMatchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/utils/audiobook-matcher', () => ({ findPlexMatch: findPlexMatchMock }));

const db = createLibraryDb();
const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as RMABLogger;

function addRequest(id: string, status: string, over: Row = {}): void {
  db.audiobooks.push({ id: `ab-${id}`, audibleAsin: `B0${id}`, title: `Book ${id}`, author: 'Author', narrator: null, filePath: null, absItemId: null });
  db.requests.push({ id, audiobookId: `ab-${id}`, userId: `user-${id}`, type: 'audiobook', status, deletedAt: null, errorMessage: null, ...over });
}

const request = (id: string) => db.requests.find((r) => r.id === id) ?? {};
const notified = (id: string) => jobQueueMock.addNotificationJob.mock.calls.some((c) => c[0] === 'request_available' && c[1] === id);

async function run() {
  const { matchRequestsToLibrary } = await import('@/lib/services/library/match-requests');
  return matchRequestsToLibrary({ backendMode: 'audiobookshelf', libraryId: null, listedItems: [], logger });
}

describe('ASIN match records a request completed while awaiting approval (#232)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLibraryDb(db);
    wireLibraryDb(prismaMock, db, '/media');
    jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
    findPlexMatchMock.mockImplementation(async ({ asin }: { asin: string }) => ({ plexGuid: `item-${asin}`, title: 'Matched' }));
  });

  it('completes an awaiting_approval request, records asin_match:awaiting_approval, still notifies', async () => {
    addRequest('r1', 'awaiting_approval');

    const result = await run();

    expect(result.matched).toBe(1);
    expect(request('r1')).toMatchObject({ status: 'available', approvalBypassedBy: 'asin_match:awaiting_approval' });
    expect(notified('r1')).toBe(true);
  });

  it.each(['pending', 'failed', 'downloaded', 'searching', 'warn'])('a %s request completes with no record', async (status) => {
    addRequest('r1', status);

    await run();

    expect(request('r1').status).toBe('available');
    expect(request('r1').approvalBypassedBy ?? null).toBeNull();
    expect(notified('r1')).toBe(true);
  });

  it('a request approved between the read and the write is not completed or notified this run', async () => {
    addRequest('r1', 'awaiting_approval');
    db.afterRead = () => Object.assign(request('r1'), { status: 'pending' });

    const result = await run();

    expect(result.matched).toBe(0);
    expect(request('r1').status).toBe('pending');
    expect(request('r1').approvalBypassedBy ?? null).toBeNull();
    expect(notified('r1')).toBe(false);

    // The next run completes it as an approved request
    await run();
    expect(request('r1').status).toBe('available');
    expect(request('r1').approvalBypassedBy ?? null).toBeNull();
  });

  it('a request sent back to awaiting_approval between the read and the write is not completed', async () => {
    addRequest('r1', 'failed');
    db.afterRead = () => Object.assign(request('r1'), { status: 'awaiting_approval' });

    const result = await run();

    expect(result.matched).toBe(0);
    expect(request('r1').status).toBe('awaiting_approval');
    expect(notified('r1')).toBe(false);

    // The next run completes it and records it
    await run();
    expect(request('r1')).toMatchObject({ status: 'available', approvalBypassedBy: 'asin_match:awaiting_approval' });
  });

  it('denied and cancelled requests are never matched', async () => {
    addRequest('r1', 'denied');
    addRequest('r2', 'cancelled');

    const result = await run();

    expect(result.total).toBe(0);
    expect(request('r1').status).toBe('denied');
    expect(request('r2').status).toBe('cancelled');
    expect(findPlexMatchMock).not.toHaveBeenCalled();
  });
});
