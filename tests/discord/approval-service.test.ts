/**
 * Component: Shared Request Approval Service Tests
 * Documentation: documentation/admin-features/request-approval.md
 *
 * The claim (one conditional write) decides races between two approvals, or an approval
 * and a denial; a job queue failure puts the row back; a request deleted between the read
 * and the claim is not found; the returned request is read back after the write. Discord
 * hears about each decision through the facade, without being waited on.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, resetFakeDb, seedRequest } from './approval-db-fake';

const db = vi.hoisted(() => ({ rows: new Map(), histories: [], hooks: {} }) as ReturnType<typeof createFakeDb>);
const jobQueueMock = vi.hoisted(() => ({
  addDownloadJob: vi.fn(),
  addStartDirectDownloadJob: vi.fn(),
  addSearchJob: vi.fn(),
  addSearchEbookJob: vi.fn(),
  addNotificationJob: vi.fn(),
}));
const guardMock = vi.hoisted(() => vi.fn());
const facadeMock = vi.hoisted(() => ({ decision: vi.fn() }));

vi.mock('@/lib/db', async () => (await import('./approval-db-fake')).fakePrisma(db));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/services/release-gate', () => ({ shouldWaitForRelease: async () => false }));
vi.mock('@/lib/services/download-selection-guard', () => ({ guardTorrentSelection: guardMock, guardEbookSelection: guardMock }));
vi.mock('@/lib/services/discord/discord-runtime', () => ({ syncDiscordApprovalDecision: facadeMock.decision }));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

const ID = '0b6f2c1e-4d6a-4c1e-9a8b-1f2e3d4c5b6a';
const PICK = { guid: 'g', title: 'Release', downloadUrl: 'magnet:?xt=urn:btih:abc' };

async function decide(action: 'approve' | 'deny', adminId = 'admin-1', via: 'web' | 'discord' = 'web') {
  const { decideRequestApproval } = await import('@/lib/services/request-approval.service');
  return decideRequestApproval({ requestId: ID, action, adminId, via });
}

describe('decideRequestApproval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFakeDb(db);
    jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
    // An async guard lets two decisions interleave before either claims
    guardMock.mockImplementation(async (pick: unknown) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { ok: true, value: pick };
    });
  });

  it('two approvals at once: one starts the request, the other gets invalid_status with the new status', async () => {
    seedRequest(db, { selectedTorrent: PICK });
    const results = await Promise.all([decide('approve', 'admin-1'), decide('approve', 'admin-2', 'discord')]);

    expect(jobQueueMock.addDownloadJob).toHaveBeenCalledTimes(1);
    expect(jobQueueMock.addNotificationJob).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, code: 'invalid_status', currentStatus: 'downloading' });
    expect(facadeMock.decision).toHaveBeenCalledTimes(1);
  });

  it('approve and deny at once: exactly one decision is made', async () => {
    seedRequest(db);
    const [approved, denied] = await Promise.all([decide('approve'), decide('deny')]);

    // The denial claims first (the approval waits on its release check); the approval then loses
    expect(denied).toMatchObject({ ok: true, action: 'deny' });
    expect(approved).toEqual({ ok: false, code: 'invalid_status', currentStatus: 'denied' });
    expect(db.rows.get(ID)!.status).toBe('denied');
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
    expect(facadeMock.decision).toHaveBeenCalledWith(ID, 'denied');
    expect(facadeMock.decision).toHaveBeenCalledTimes(1);
  });

  it('a job queue failure puts the row back with its stored pick and approval record, then throws', async () => {
    seedRequest(db, { selectedTorrent: PICK, approvalBypassedBy: 'asin_match:awaiting_approval' });
    jobQueueMock.addDownloadJob.mockRejectedValue(new Error('redis down'));

    await expect(decide('approve')).rejects.toThrow('redis down');
    expect(db.rows.get(ID)).toMatchObject({ status: 'awaiting_approval', selectedTorrent: PICK, approvalBypassedBy: 'asin_match:awaiting_approval' });
    expect(jobQueueMock.addNotificationJob).not.toHaveBeenCalled();
    expect(facadeMock.decision).not.toHaveBeenCalled();
  });

  it('a search queue failure with no stored pick puts the row back with no pick', async () => {
    seedRequest(db);
    jobQueueMock.addSearchJob.mockRejectedValue(new Error('redis down'));

    await expect(decide('approve')).rejects.toThrow('redis down');
    expect(db.rows.get(ID)).toMatchObject({ status: 'awaiting_approval', selectedTorrent: null });
  });

  it('no roll back once something else moved the row on (the rollback is gated on the claimed status)', async () => {
    seedRequest(db, { selectedTorrent: PICK });
    jobQueueMock.addDownloadJob.mockImplementation(async () => {
      db.rows.get(ID)!.status = 'failed';
      throw new Error('late failure');
    });

    await expect(decide('approve')).rejects.toThrow('late failure');
    expect(db.rows.get(ID)!.status).toBe('failed');
  });

  it('deleted between the read and the claim: not_found, nothing queued', async () => {
    seedRequest(db);
    db.hooks.beforeClaim = () => {
      db.rows.get(ID)!.deletedAt = new Date();
    };

    expect(await decide('approve')).toEqual({ ok: false, code: 'not_found' });
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
    expect(jobQueueMock.addNotificationJob).not.toHaveBeenCalled();
    expect(db.rows.get(ID)!.status).toBe('awaiting_approval');
  });

  it('the returned request is read back after the write (not the row read before it) with hidden records dropped', async () => {
    seedRequest(db);
    // The search job moves the row on before the read-back
    jobQueueMock.addSearchJob.mockImplementation(async () => {
      db.rows.get(ID)!.status = 'searching';
    });

    const result = await decide('approve');
    expect(result).toMatchObject({ ok: true, action: 'approve', status: 'pending' });
    const request = (result as { request: Record<string, unknown> }).request;
    expect(request.status).toBe('searching');
    expect(request.placedEbookFiles).toBeUndefined();
    expect(request.approvalBypassedBy).toBeUndefined();
    expect(request).toMatchObject({ audiobook: { title: 'The Book' }, user: { plexUsername: 'reader' } });
  });

  it('the Discord update is started, never awaited: a hanging facade call does not hold the result', async () => {
    seedRequest(db);
    facadeMock.decision.mockImplementation(() => new Promise(() => undefined));

    const result = await decide('deny');
    expect(result).toMatchObject({ ok: true, action: 'deny' });
    expect(facadeMock.decision).toHaveBeenCalledWith(ID, 'denied');
  });

  it('a request in another status, or missing: no write, no Discord update', async () => {
    seedRequest(db, { status: 'available' });
    expect(await decide('approve')).toEqual({ ok: false, code: 'invalid_status', currentStatus: 'available' });
    resetFakeDb(db);
    expect(await decide('deny')).toEqual({ ok: false, code: 'not_found' });
    expect(facadeMock.decision).not.toHaveBeenCalled();
  });
});
