/**
 * Component: Cancelled Request - Usenet Download Handling Tests
 * Documentation: documentation/admin-features/request-cancel.md
 *
 * Fails on main: a cancel never touched the client. NZBGet deletes from the queue only.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const configMock = vi.hoisted(() => ({ get: vi.fn() }));
const managerMock = vi.hoisted(() => ({ getClientServiceForProtocol: vi.fn(), getClientForProtocol: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/download-client-manager.service', () => ({ getDownloadClientManager: () => managerMock }));

const REQUEST = { id: 'req-1', audiobookId: 'ab-1', type: 'audiobook' };

function row(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'dh-1', requestId: 'req-1', selected: true, downloadStatus: 'downloading', torrentHash: null, nzbId: '42',
    downloadClientId: '42', downloadClient: 'sabnzbd', indexerName: 'Usenet', indexerId: 3, createdAt: new Date(),
    addedByRmab: true, completedAt: null, torrentName: 'Book.Release', ...overrides,
  };
}

function client(clientType: 'sabnzbd' | 'nzbget', status = 'downloading') {
  const c: any = {
    clientType,
    protocol: 'usenet',
    getDownload: vi.fn().mockResolvedValue({ id: '42', name: 'Book.Release', status, progress: 0.3 }),
    deleteDownload: vi.fn().mockResolvedValue(undefined),
    ...(clientType === 'nzbget' ? { deleteQueuedDownload: vi.fn().mockResolvedValue('deleted') } : {}),
  };
  managerMock.getClientServiceForProtocol.mockResolvedValue(c);
  managerMock.getClientForProtocol.mockResolvedValue({ category: 'audiobooks' });
  return c;
}

async function cancelStep(r: any) {
  const { handleCancelledDownload } = await import('@/lib/services/cancelled-download');
  const { CancelDeadline } = await import('@/lib/services/cancel-deadline');
  return handleCancelledDownload(REQUEST, r, { mode: 'cancel', deadline: CancelDeadline.in(10_000) });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.request.findMany.mockResolvedValue([]);
  prismaMock.downloadHistory.findFirst.mockResolvedValue({ id: 'dh-1' });
  prismaMock.downloadHistory.update.mockResolvedValue({});
});

describe('SABnzbd', () => {
  it('deletes a queued job RMAB added, with its files, and records it removed', async () => {
    const c = client('sabnzbd');
    expect((await cancelStep(row())).outcome).toBe('removed');
    expect(c.deleteDownload).toHaveBeenCalledWith('42', true);
    expect(prismaMock.downloadHistory.update).toHaveBeenCalledWith({ where: { id: 'dh-1' }, data: { downloadStatus: 'removed' } });
  });

  it.each(['completed', 'processing', 'failed'])('a job that is %s stays', async (status) => {
    const c = client('sabnzbd', status);
    expect((await cancelStep(row())).outcome).toBe('kept_finished');
    expect(c.deleteDownload).not.toHaveBeenCalled();
  });

  it('a job another active request uses stays', async () => {
    prismaMock.request.findMany.mockResolvedValue([{ id: 'req-2', status: 'downloading' }]);
    const c = client('sabnzbd');
    expect((await cancelStep(row())).outcome).toBe('kept_shared');
    expect(c.deleteDownload).not.toHaveBeenCalled();
  });

  it.each([[null], [false]])('addedByRmab %s: no client call', async (addedByRmab) => {
    const c = client('sabnzbd');
    expect((await cancelStep(row({ addedByRmab }))).outcome).toBe('kept_not_owned');
    expect(c.getDownload).not.toHaveBeenCalled();
    expect(c.deleteDownload).not.toHaveBeenCalled();
  });

  it('a lookup error is reported as not removed (usenet is never retried later)', async () => {
    const c = client('sabnzbd');
    c.getDownload.mockRejectedValue(new Error('timeout'));
    expect((await cancelStep(row())).outcome).toBe('not_removed');
    expect(c.deleteDownload).not.toHaveBeenCalled();
  });

  it('the cleanup pass never touches usenet', async () => {
    const c = client('sabnzbd');
    const { handleCancelledDownload } = await import('@/lib/services/cancelled-download');
    const res = await handleCancelledDownload(REQUEST, row(), { mode: 'sweep', lookupIndexer: () => ({ config: undefined, matchedBy: null }) });
    expect(res.outcome).toBe('none');
    expect(c.getDownload).not.toHaveBeenCalled();
  });
});

describe('NZBGet', () => {
  const nzbRow = () => row({ downloadClient: 'nzbget' });

  it('deletes through the queue-only call with the row\'s name and category, never deleteDownload', async () => {
    const c = client('nzbget');
    expect((await cancelStep(nzbRow())).outcome).toBe('removed');
    expect(c.deleteQueuedDownload).toHaveBeenCalledWith('42', { name: 'Book.Release', category: 'audiobooks' });
    expect(c.deleteDownload).not.toHaveBeenCalled();
  });

  it('a job that moved to history between the lookup and the delete stays', async () => {
    const c = client('nzbget');
    c.deleteQueuedDownload.mockResolvedValue('not_queued');
    expect((await cancelStep(nzbRow())).outcome).toBe('kept_finished');
    expect(c.deleteDownload).not.toHaveBeenCalled();
    expect(prismaMock.downloadHistory.update).not.toHaveBeenCalled();
  });

  it('a queued job that does not match the row stays', async () => {
    const c = client('nzbget');
    c.deleteQueuedDownload.mockResolvedValue('mismatch');
    expect((await cancelStep(nzbRow())).outcome).toBe('kept_not_owned');
    expect(prismaMock.downloadHistory.update).not.toHaveBeenCalled();
  });
});

describe('NZBGetService.deleteQueuedDownload', () => {
  const clientMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
  vi.mock('axios', () => {
    const axiosMock = { create: vi.fn(() => clientMock), get: vi.fn(), isAxiosError: vi.fn(() => false) };
    return { default: axiosMock, ...axiosMock };
  });

  const methods = () => clientMock.post.mock.calls.map((call: any[]) => [call[1]?.method, call[1]?.params?.[0]]);
  const queue = (group: Record<string, unknown> | null) =>
    clientMock.post.mockImplementation(async (_url: string, body: any) => ({
      data: { result: body.method === 'listgroups' ? (group ? [{ NZBID: 42, NZBName: 'Book.Release', Category: 'audiobooks', ...group }] : []) : true },
    }));

  async function service() {
    const { NZBGetService } = await import('@/lib/integrations/nzbget.service');
    return new NZBGetService('http://nzbget:6789', 'nzbget', 'pass');
  }

  it('GroupFinalDelete for a queued job whose name matches', async () => {
    queue({ Category: 'other' });
    expect(await (await service()).deleteQueuedDownload('42', { name: 'Book.Release.nzb', category: 'audiobooks' })).toBe('deleted');
    expect(methods()).toEqual([['listgroups', 0], ['editqueue', 'GroupFinalDelete']]);
  });

  it('a job no longer queued is never deleted from history', async () => {
    queue(null);
    expect(await (await service()).deleteQueuedDownload('42', { name: 'Book.Release', category: 'audiobooks' })).toBe('not_queued');
    expect(methods()).toEqual([['listgroups', 0]]);
  });

  it('neither name nor category matches: left alone', async () => {
    queue({ NZBName: 'Someone.Else', Category: 'tv' });
    expect(await (await service()).deleteQueuedDownload('42', { name: 'Book.Release', category: 'audiobooks' })).toBe('mismatch');
    expect(methods()).toEqual([['listgroups', 0]]);
  });
});
