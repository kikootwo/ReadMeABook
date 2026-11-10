/**
 * Component: Reported Issue Replace Tests (who the replacement belongs to, #571)
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * The replacement request belongs to the requester of the request it replaces and keeps
 * that request's approval record. With no request (a book added outside RMAB), a deleted
 * or not-approved user, or a request that was refused or withdrawn, it stays with the admin.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = { ...createPrismaMock(), reportedIssue: { findUnique: vi.fn(), update: vi.fn() } };
const deleteRequestMock = vi.hoisted(() => vi.fn());
const jobQueueMock = vi.hoisted(() => ({ addDownloadJob: vi.fn() }));
const replaceContentMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/request-delete-files', () => ({ audiobookFolderKeptReason: vi.fn(async () => null) }));
vi.mock('@/lib/services/request-delete.service', () => ({ deleteRequest: deleteRequestMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/services/replace-library-content', () => ({ removeLibraryContentForReplace: replaceContentMock }));

const { replaceAudiobook } = await import('@/lib/services/reported-issue.service');

const audiobook = {
  id: 'book-1', title: 'Book', author: 'Author', audibleAsin: 'B0TEST0001', coverArtUrl: null,
  narrator: null, plexGuid: null, absItemId: 'abs-1', filePath: '/media/Author/Book', filesHash: 'hash',
};
const approvedUser = { id: 'user-1', deletedAt: null, registrationStatus: 'approved' };
const oldRequest = (fields: Record<string, unknown> = {}) => ({
  id: 'req-old', userId: 'user-1', status: 'available', approvalBypassedBy: null, user: approvedUser, ...fields,
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.reportedIssue.findUnique.mockResolvedValue({ id: 'issue-1', status: 'open', audiobook });
  prismaMock.reportedIssue.update.mockResolvedValue({});
  prismaMock.request.findFirst.mockResolvedValue(oldRequest());
  prismaMock.request.findMany.mockResolvedValue([]);
  prismaMock.request.create.mockResolvedValue({ id: 'req-new', audiobook, user: { id: 'user-1' } });
  deleteRequestMock.mockResolvedValue({ success: true, filesDeleted: true });
  replaceContentMock.mockResolvedValue(null);
});

const created = () => prismaMock.request.create.mock.calls[0][0].data;
/** Owner and approval record of the new request (an unset record reads as NULL). */
const owner = () => ({ userId: created().userId, approvalBypassedBy: created().approvalBypassedBy ?? null });

describe('replaceAudiobook: who the replacement request belongs to', () => {
  it('reads the requester with the request it replaces (audiobook requests only)', async () => {
    await replaceAudiobook('issue-1', 'admin-1', { guid: 't' });

    expect(prismaMock.request.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { audiobookId: 'book-1', type: 'audiobook', deletedAt: null },
      include: { user: { select: { id: true, deletedAt: true, registrationStatus: true } } },
    }));
  });

  it('gives an approved request to its requester, unmarked, so it is tagged for them on delivery', async () => {
    await replaceAudiobook('issue-1', 'admin-1', { guid: 't' });

    expect(created()).toMatchObject({ userId: 'user-1', audiobookId: 'book-1', type: 'audiobook', status: 'downloading', approvalBypassedBy: null });
    expect(deleteRequestMock).toHaveBeenCalledWith('req-old', 'admin-1');
    expect(jobQueueMock.addDownloadJob).toHaveBeenCalledWith('req-new', expect.objectContaining({ id: 'book-1' }), { guid: 't' });
    expect(prismaMock.reportedIssue.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'replaced', resolvedById: 'admin-1' }) }));
  });

  it('gives it to a requester whose registration status was never set (accounts from before registration)', async () => {
    prismaMock.request.findFirst.mockResolvedValue(oldRequest({ user: { ...approvedUser, registrationStatus: null } }));

    await replaceAudiobook('issue-1', 'admin-1', { guid: 't' });

    expect(created().userId).toBe('user-1');
  });

  it('keeps the approval record of a request delivered without approval, so it stays untagged', async () => {
    prismaMock.request.findFirst.mockResolvedValue(oldRequest({ approvalBypassedBy: 'asin_match:awaiting_approval' }));

    await replaceAudiobook('issue-1', 'admin-1', { guid: 't' });

    expect(created()).toMatchObject({ userId: 'user-1', approvalBypassedBy: 'asin_match:awaiting_approval' });
  });

  it('keeps an admin requester as the requester', async () => {
    prismaMock.request.findFirst.mockResolvedValue(oldRequest({ userId: 'admin-2', user: { ...approvedUser, id: 'admin-2' } }));

    await replaceAudiobook('issue-1', 'admin-1', { guid: 't' });

    expect(created().userId).toBe('admin-2');
  });

  it.each([
    ['deleted', { ...approvedUser, deletedAt: new Date('2026-01-01') }],
    ['waiting for registration approval', { ...approvedUser, registrationStatus: 'pending_approval' }],
    ['rejected', { ...approvedUser, registrationStatus: 'rejected' }],
  ])('stays with the admin when the requester is %s', async (_label, user) => {
    prismaMock.request.findFirst.mockResolvedValue(oldRequest({ user, approvalBypassedBy: 'manual_import:denied' }));

    await replaceAudiobook('issue-1', 'admin-1', { guid: 't' });

    expect(owner()).toEqual({ userId: 'admin-1', approvalBypassedBy: null });
    expect(deleteRequestMock).toHaveBeenCalledWith('req-old', 'admin-1');
  });

  it.each(['awaiting_approval', 'denied', 'cancelled'])('stays with the admin when the request it replaces is %s', async (status) => {
    prismaMock.request.findFirst.mockResolvedValue(oldRequest({ status }));

    await replaceAudiobook('issue-1', 'admin-1', { guid: 't' });

    expect(owner()).toEqual({ userId: 'admin-1', approvalBypassedBy: null });
  });

  it.each(['failed', 'warn', 'downloaded'])('gives a %s request to its requester', async (status) => {
    prismaMock.request.findFirst.mockResolvedValue(oldRequest({ status }));

    await replaceAudiobook('issue-1', 'admin-1', { guid: 't' });

    expect(created().userId).toBe('user-1');
  });

  it('stays with the admin when the book had no request (added outside RMAB), as before', async () => {
    prismaMock.request.findFirst.mockResolvedValue(null);

    await replaceAudiobook('issue-1', 'admin-1', { guid: 't' });

    expect(replaceContentMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'book-1' }));
    expect(deleteRequestMock).not.toHaveBeenCalled();
    expect(created()).toMatchObject({ type: 'audiobook', status: 'downloading' });
    expect(owner()).toEqual({ userId: 'admin-1', approvalBypassedBy: null });
  });

  it('leaves ebook requests alone: a remaining delivered ebook request is not moved or replaced', async () => {
    prismaMock.request.findMany.mockImplementation(async (args: { where?: Record<string, unknown> }) =>
      args?.where?.type === 'ebook'
        ? [{ id: 'ebook-1', userId: 'user-1', status: 'downloaded', completedAt: new Date(), placedEbookFiles: null }]
        : []);

    await replaceAudiobook('issue-1', 'admin-1', { guid: 't' });

    expect(prismaMock.request.create).toHaveBeenCalledTimes(1);
    expect(created().type).toBe('audiobook');
    expect(prismaMock.request.update).not.toHaveBeenCalled();
    expect(prismaMock.request.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.audiobook.update.mock.calls[0][0].data).not.toHaveProperty('filePath');
  });
});
