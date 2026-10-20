/**
 * Component: Reported Issue Replace Tests (library delete guard)
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * A replace removes the old files before fetching new ones; when the library
 * delete guard keeps them, the replace stops with 409 and the reason: no
 * record reset, no new request, the issue stays open.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = { ...createPrismaMock(), reportedIssue: { findUnique: vi.fn(), update: vi.fn() } };
const keptReasonMock = vi.hoisted(() => vi.fn());
const deleteRequestMock = vi.hoisted(() => vi.fn());
const jobQueueMock = vi.hoisted(() => ({ addDownloadJob: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/request-delete-files', () => ({ audiobookFolderKeptReason: keptReasonMock }));
vi.mock('@/lib/services/request-delete.service', () => ({ deleteRequest: deleteRequestMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
const replaceContentMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/services/replace-library-content', () => ({ removeLibraryContentForReplace: replaceContentMock }));

const { replaceAudiobook } = await import('@/lib/services/reported-issue.service');

const audiobook = {
  id: 'book-1',
  title: 'Book',
  author: 'Author',
  audibleAsin: 'B0TEST0001',
  coverArtUrl: null,
  narrator: null,
  plexGuid: null,
  absItemId: 'abs-1',
  filePath: '/media/Author/Book',
  filesHash: 'hash',
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.reportedIssue.findUnique.mockResolvedValue({ id: 'issue-1', status: 'open', audiobook });
  prismaMock.request.findFirst.mockResolvedValue({ id: 'req-old' });
  prismaMock.request.create.mockResolvedValue({ id: 'req-new' });
  prismaMock.reportedIssue.update.mockResolvedValue({});
  keptReasonMock.mockResolvedValue(null);
  deleteRequestMock.mockResolvedValue({ success: true, filesDeleted: true });
});

function expectStoppedCleanly() {
  expect(prismaMock.audiobook.update).not.toHaveBeenCalled();
  expect(prismaMock.request.create).not.toHaveBeenCalled();
  expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
  expect(prismaMock.reportedIssue.update).not.toHaveBeenCalled();
}

describe('replaceAudiobook with the library delete guard', () => {
  it('stops with 409 and the reason before deleting anything when the files would be kept', async () => {
    keptReasonMock.mockResolvedValue('folder contents changed since import');

    const error = await replaceAudiobook('issue-1', 'admin-1', { guid: 't' }).catch((e) => e);

    expect(error).toMatchObject({ statusCode: 409 });
    expect(error.message).toContain('folder contents changed since import');
    expect(error.message).toContain('Remove those files manually, then re-request the book after the next library scan.');
    expect(keptReasonMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'book-1', filePath: '/media/Author/Book', filesHash: 'hash' }));
    expect(deleteRequestMock).not.toHaveBeenCalled();
    expectStoppedCleanly();
  });

  it('stops with 409 when the delete itself kept the files (changed since the check, or the removal failed)', async () => {
    deleteRequestMock.mockResolvedValue({ success: true, filesDeleted: false, filesKeptReason: 'the folder could not be removed (EACCES)' });

    const error = await replaceAudiobook('issue-1', 'admin-1', { guid: 't' }).catch((e) => e);

    expect(error).toMatchObject({ statusCode: 409 });
    expect(error.message).toContain('the folder could not be removed (EACCES)');
    expect(error.message).toContain('the old request was deleted but its files were kept');
    expectStoppedCleanly();
  });

  it('with no active request (an earlier delete kept the files), stops with 409 when the guarded removal keeps them', async () => {
    prismaMock.request.findFirst.mockResolvedValue(null);
    replaceContentMock.mockResolvedValue('folder contents changed since import');

    const error = await replaceAudiobook('issue-1', 'admin-1', { guid: 't' }).catch((e) => e);

    expect(error).toMatchObject({ statusCode: 409 });
    expect(error.message).toContain('Nothing was changed');
    expect(error.message).toContain('re-request the book after the next library scan');
    expect(replaceContentMock).toHaveBeenCalledWith(expect.objectContaining({ filePath: '/media/Author/Book', filesHash: 'hash' }));
    expect(deleteRequestMock).not.toHaveBeenCalled();
    expectStoppedCleanly();
  });

  it('replaces as before when the old files were removed', async () => {
    prismaMock.request.create.mockResolvedValue({ id: 'req-new', audiobook, user: { id: 'admin-1' } });

    await replaceAudiobook('issue-1', 'admin-1', { guid: 't' });

    expect(deleteRequestMock).toHaveBeenCalledWith('req-old', 'admin-1');
    expect(prismaMock.audiobook.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ filePath: null, filesHash: null }) }));
    expect(jobQueueMock.addDownloadJob).toHaveBeenCalled();
    expect(prismaMock.reportedIssue.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'replaced' }) }));
  });
});
