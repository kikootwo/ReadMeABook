/**
 * Component: Request Delete Service Tests - usenet jobs RMAB took over (#329)
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * A SABnzbd job RMAB took over as a duplicate is never deleted, and RMAB's own job stays
 * while another active request tracks it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'path';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const fsMock = { access: vi.fn(), rm: vi.fn() };
const configServiceMock = { get: vi.fn(), getBackendMode: vi.fn() };
const downloadClientManagerMock = { getClientServiceForProtocol: vi.fn() };

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('fs/promises', () => fsMock);
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configServiceMock }));
vi.mock('@/lib/services/download-client-manager.service', () => ({
  getDownloadClientManager: () => downloadClientManagerMock,
}));
vi.mock('@/lib/services/audiobookshelf/api', () => ({ deleteABSItem: vi.fn() }));
vi.mock('@/lib/services/request-delete-files', () => ({
  removeAudiobookFolder: vi.fn(async () => ({ kind: 'none' })),
  removeEbookFiles: vi.fn(async () => ({ deleted: 0 })),
  deleteBackendItem: vi.fn(async () => undefined),
  deleteLibraryRecords: vi.fn(async () => undefined),
}));

const JOB = 'SABnzbd_nzo_existing';

/** Other active requests whose selected row is this SABnzbd job (the usenet shared-job query) */
let sharingRequests: Array<{ id: string; status: string }> = [];

async function deleteWith(row: Record<string, unknown>) {
  prismaMock.request.findFirst.mockResolvedValue({
    id: 'req-1',
    audiobook: {
      id: 'ab-1', title: 'Book', author: 'Author', audibleAsin: null, plexGuid: null, absItemId: null,
      filePath: path.join('/media', 'Author', 'Book'),
    },
    downloadHistory: [{
      id: 'dh-1', nzbId: JOB, downloadClientId: JOB, downloadClient: 'sabnzbd', torrentHash: null,
      indexerName: 'UsenetIndexer', indexerId: 2, downloadStatus: 'downloading', completedAt: null,
      createdAt: new Date('2026-10-01T12:00:00Z'), ...row,
    }],
  });
  const client = {
    clientType: 'sabnzbd',
    protocol: 'usenet',
    getDownload: vi.fn().mockResolvedValue({ id: JOB, name: 'Book', status: 'downloading', progress: 0.5 }),
    deleteDownload: vi.fn().mockResolvedValue(undefined),
  };
  downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(client);

  const { deleteRequest } = await import('@/lib/services/request-delete.service');
  const result = await deleteRequest('req-1', 'admin-1');
  expect(result.success).toBe(true);
  return { result, client };
}

describe('deleteRequest: SABnzbd jobs RMAB took over (#329)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharingRequests = [];
    prismaMock.request.findMany.mockImplementation(async (args: { where?: { downloadHistory?: { some?: { OR?: unknown } } } }) =>
      (args?.where?.downloadHistory?.some?.OR ? sharingRequests : []));
    prismaMock.request.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.audiobook.update.mockResolvedValue({});
    prismaMock.plexLibrary.findMany.mockResolvedValue([]);
    prismaMock.downloadHistory.update.mockResolvedValue({});
    configServiceMock.get.mockImplementation(async (key: string) => {
      if (key === 'prowlarr_indexers') return JSON.stringify([{ id: 2, name: 'UsenetIndexer', protocol: 'usenet' }]);
      if (key === 'media_dir') return '/media';
      return null;
    });
    configServiceMock.getBackendMode.mockResolvedValue('plex');
    fsMock.access.mockRejectedValue(new Error('missing'));
  });

  it('leaves a taken-over job (addedByRmab false) and its files in SABnzbd', async () => {
    const { result, client } = await deleteWith({ addedByRmab: false });

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(result.torrentsKeptNotOwned).toBe(1);
    expect(result.torrentsRemoved).toBe(0);
  });

  it('keeps RMAB\'s own job while another active request tracks it', async () => {
    sharingRequests = [{ id: 'req-2', status: 'downloading' }];

    const { result, client } = await deleteWith({ addedByRmab: true });

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(result.torrentsKeptShared).toBe(1);
    expect(result.torrentsRemoved).toBe(0);
  });

  it('deletes RMAB\'s own job with its files as before', async () => {
    const { result, client } = await deleteWith({ addedByRmab: true });

    expect(client.deleteDownload).toHaveBeenCalledWith(JOB, true);
    expect(result.torrentsRemoved).toBe(1);
  });
});
