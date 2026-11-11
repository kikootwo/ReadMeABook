/**
 * Component: Library scan leaves an access request alone while it awaits approval
 * Documentation: documentation/features/requester-tags.md
 *
 * An access request's book is already in the library, so the ASIN match would complete it at the
 * next scan as "completed without approval" (never tagged). The match step skips it while it
 * awaits approval; in any other status (an admin picked a release for it) it is matched as usual.
 * Real: match-requests. Mocked: prisma (in-memory holder), the ASIN matcher, the job queue.
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

async function run() {
  const { matchRequestsToLibrary } = await import('@/lib/services/library/match-requests');
  return matchRequestsToLibrary({ backendMode: 'plex', libraryId: null, listedItems: [], logger });
}

describe('match step and access requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLibraryDb(db);
    wireLibraryDb(prismaMock, db, '/media');
    jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
    findPlexMatchMock.mockImplementation(async ({ asin }: { asin: string }) => ({ plexGuid: `item-${asin}`, title: 'Matched' }));
  });

  it('skips an access request awaiting approval (no completion, no record, no notification)', async () => {
    addRequest('a1', 'awaiting_approval', { accessRequest: true });

    const result = await run();

    expect(result.total).toBe(0);
    expect(request('a1')).toMatchObject({ status: 'awaiting_approval' });
    expect(request('a1').approvalBypassedBy ?? null).toBeNull();
    expect(jobQueueMock.addNotificationJob).not.toHaveBeenCalled();
  });

  it('still completes a normal request awaiting approval (recorded), and an access request in another status', async () => {
    addRequest('n1', 'awaiting_approval');
    addRequest('a2', 'downloading', { accessRequest: true });

    const result = await run();

    expect(result.matched).toBe(2);
    expect(request('n1')).toMatchObject({ status: 'available', approvalBypassedBy: 'asin_match:awaiting_approval' });
    expect(request('a2').status).toBe('available');
  });
});
