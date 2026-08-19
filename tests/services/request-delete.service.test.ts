/**
 * Component: Request Delete Service Tests
 * Documentation: documentation/admin-features/request-deletion.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'path';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const fsMock = {
  access: vi.fn(),
  rm: vi.fn(),
};
const configServiceMock = {
  get: vi.fn(),
  getBackendMode: vi.fn(),
};
const downloadClientManagerMock = {
  getClientServiceForProtocol: vi.fn(),
};

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('fs/promises', () => fsMock);

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configServiceMock,
}));

vi.mock('@/lib/services/download-client-manager.service', () => ({
  getDownloadClientManager: () => downloadClientManagerMock,
}));

vi.mock('@/lib/services/audiobookshelf/api', () => ({
  deleteABSItem: vi.fn(),
}));

// deleteRequest now converges the Discord surfaces itself, so these are stubbed for every test.
// getClient defaults to null (bot disabled), which is the no-op path the other cases rely on.
const discordBotMock = vi.hoisted(() => ({ getClient: vi.fn<() => unknown>(() => null) }));
const discordCardsMock = vi.hoisted(() => ({
  editRequestCards: vi.fn(() => Promise.resolve()),
  cancelApprovalMessage: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/services/discord/discord-bot.service', () => ({
  getDiscordBotService: () => discordBotMock,
}));

vi.mock('@/lib/services/discord/discord-cards', () => discordCardsMock);

vi.mock('@/lib/utils/file-organizer', () => ({
  buildAudiobookPath: vi.fn((mediaDir: string, template: string, data: any) => {
    // Simple mock implementation that mimics the real behavior for tests
    return path.join(mediaDir, data.author, `${data.title} ${data.asin}`);
  }),
}));

describe('deleteRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    discordBotMock.getClient.mockReturnValue(null);
    // Default mock for child request queries (audiobook requests check for child ebook requests)
    prismaMock.request.findMany.mockResolvedValue([]);
    prismaMock.request.updateMany.mockResolvedValue({ count: 0 });
    downloadClientManagerMock.getClientServiceForProtocol.mockReset();
  });

  it('returns not found when request is missing', async () => {
    prismaMock.request.findFirst.mockResolvedValue(null);
    const { deleteRequest } = await import('@/lib/services/request-delete.service');

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.success).toBe(false);
    expect(result.error).toBe('NotFound');
  });

  it('deletes completed qBittorrent downloads when seeding requirement met', async () => {
    prismaMock.request.findFirst.mockResolvedValue({
      id: 'req-1',
      audiobook: {
        id: 'ab-1',
        title: 'Book',
        author: 'Author',
        audibleAsin: 'ASIN1',
        plexGuid: 'plex-1',
        absItemId: null,
      },
      downloadHistory: [
        {
          torrentHash: 'hash-1',
          indexerName: 'IndexerA',
          downloadStatus: 'completed',
        },
      ],
    });
    configServiceMock.get.mockImplementation(async (key: string) => {
      if (key === 'prowlarr_indexers') {
        return JSON.stringify([{ name: 'IndexerA', seedingTimeMinutes: 1 }]);
      }
      if (key === 'media_dir') {
        return '/media';
      }
      if (key === 'audiobook_path_template') {
        return '{author}/{title} {asin}';
      }
      return null;
    });
    configServiceMock.getBackendMode.mockResolvedValue('plex');
    const qbtClientMock = {
      clientType: 'qbittorrent',
      protocol: 'torrent',
      getDownload: vi.fn().mockResolvedValue({
        id: 'hash-1',
        name: 'Book',
        size: 0,
        bytesDownloaded: 0,
        progress: 1.0,
        status: 'seeding',
        downloadSpeed: 0,
        eta: 0,
        category: 'readmeabook',
        seedingTime: 120,
      }),
      deleteDownload: vi.fn().mockResolvedValue(undefined),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(qbtClientMock);
    prismaMock.audibleCache.findUnique.mockResolvedValueOnce({
      releaseDate: '2021-01-01T00:00:00.000Z',
    });
    // Mock deleteMany for ASIN-based deletion
    prismaMock.plexLibrary.deleteMany.mockResolvedValue({ count: 1 });
    fsMock.access.mockResolvedValue(undefined);
    fsMock.rm.mockResolvedValue(undefined);
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.audiobook.update.mockResolvedValue({});

    const { deleteRequest } = await import('@/lib/services/request-delete.service');
    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.success).toBe(true);
    expect(result.torrentsRemoved).toBe(1);
    expect(qbtClientMock.deleteDownload).toHaveBeenCalledWith('hash-1', true);
    // Code now uses deleteMany with ASIN-based matching
    expect(prismaMock.plexLibrary.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { asin: 'ASIN1' },
          { plexGuid: { contains: 'ASIN1' } },
        ],
      },
    });

    const expectedPath = path.join('/media', 'Author', 'Book ASIN1');
    expect(fsMock.rm).toHaveBeenCalledWith(expectedPath, { recursive: true, force: true });
  });

  it('removes SABnzbd downloads and continues cleanup', async () => {
    prismaMock.request.findFirst.mockResolvedValue({
      id: 'req-2',
      audiobook: {
        id: 'ab-2',
        title: 'Book Two',
        author: 'Author',
        audibleAsin: null,
        plexGuid: 'plex-2',
        absItemId: null,
      },
      downloadHistory: [
        {
          nzbId: 'nzb-1',
          indexerName: 'IndexerB',
          downloadStatus: 'completed',
        },
      ],
    });
    configServiceMock.get.mockImplementation(async (key: string) => {
      if (key === 'prowlarr_indexers') {
        return JSON.stringify([{ name: 'IndexerB', seedingTimeMinutes: 0 }]);
      }
      if (key === 'media_dir') {
        return '/media';
      }
      return null;
    });
    configServiceMock.getBackendMode.mockResolvedValue('plex');
    const sabClientMock = {
      clientType: 'sabnzbd',
      protocol: 'usenet',
      getDownload: vi.fn().mockResolvedValue({
        id: 'nzb-1',
        name: 'Book Two',
        size: 0,
        bytesDownloaded: 0,
        progress: 1.0,
        status: 'completed',
        downloadSpeed: 0,
        eta: 0,
        category: 'readmeabook',
      }),
      deleteDownload: vi.fn().mockResolvedValue(undefined),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(sabClientMock);
    fsMock.access.mockResolvedValue(undefined);
    fsMock.rm.mockResolvedValue(undefined);
    prismaMock.plexLibrary.findMany.mockResolvedValue([]);
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.audiobook.update.mockResolvedValue({});

    const { deleteRequest } = await import('@/lib/services/request-delete.service');
    const result = await deleteRequest('req-2', 'admin-1');

    expect(result.success).toBe(true);
    expect(result.torrentsRemoved).toBe(1);
    expect(sabClientMock.deleteDownload).toHaveBeenCalledWith('nzb-1', true);
    expect(prismaMock.request.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deletedBy: 'admin-1' }),
      })
    );
  });

  it('keeps torrents seeding when requirement is not met', async () => {
    prismaMock.request.findFirst.mockResolvedValue({
      id: 'req-3',
      audiobook: {
        id: 'ab-3',
        title: 'Book Three',
        author: 'Author Name',
        audibleAsin: 'ASIN3',
        plexGuid: 'plex-3',
        absItemId: null,
      },
      downloadHistory: [
        {
          torrentHash: 'hash-3',
          indexerName: 'IndexerC',
          downloadStatus: 'completed',
        },
      ],
    });
    configServiceMock.get.mockImplementation(async (key: string) => {
      if (key === 'prowlarr_indexers') {
        return JSON.stringify([{ name: 'IndexerC', seedingTimeMinutes: 10 }]);
      }
      if (key === 'media_dir') {
        return '/media';
      }
      if (key === 'audiobook_path_template') {
        return '{author}/{title} {asin}';
      }
      return null;
    });
    configServiceMock.getBackendMode.mockResolvedValue('plex');
    const qbtClientMock = {
      clientType: 'qbittorrent',
      protocol: 'torrent',
      getDownload: vi.fn().mockResolvedValue({
        id: 'hash-3',
        name: 'Book Three',
        size: 0,
        bytesDownloaded: 0,
        progress: 1.0,
        status: 'seeding',
        downloadSpeed: 0,
        eta: 0,
        category: 'readmeabook',
        seedingTime: 60,
      }),
      deleteDownload: vi.fn(),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(qbtClientMock);
    prismaMock.audibleCache.findUnique.mockResolvedValueOnce({
      releaseDate: '2020-01-01T00:00:00.000Z',
    });
    prismaMock.plexLibrary.findMany.mockResolvedValue([
      { id: 'lib-2', title: 'Book Three', author: 'Other' },
    ]);
    fsMock.access
      .mockRejectedValueOnce(new Error('missing'))
      .mockResolvedValueOnce(undefined);
    fsMock.rm.mockResolvedValue(undefined);
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.audiobook.update.mockResolvedValue({});

    const { deleteRequest } = await import('@/lib/services/request-delete.service');
    const result = await deleteRequest('req-3', 'admin-2');

    expect(result.torrentsKeptSeeding).toBe(1);

    // Path doesn't exist, so rm should not be called (first access fails)
    expect(fsMock.rm).not.toHaveBeenCalled();
  });

  it('keeps torrents for unlimited seeding when no config is present', async () => {
    prismaMock.request.findFirst.mockResolvedValue({
      id: 'req-4',
      audiobook: {
        id: 'ab-4',
        title: 'Book Four',
        author: 'Author',
        audibleAsin: null,
        plexGuid: 'plex-4',
        absItemId: null,
      },
      downloadHistory: [
        {
          torrentHash: 'hash-4',
          indexerName: 'IndexerD',
          downloadStatus: 'completed',
        },
      ],
    });
    configServiceMock.get.mockImplementation(async (key: string) => {
      if (key === 'prowlarr_indexers') {
        return null;
      }
      if (key === 'media_dir') {
        return '/media';
      }
      return null;
    });
    configServiceMock.getBackendMode.mockResolvedValue('plex');
    const qbtClientMock = {
      clientType: 'qbittorrent',
      protocol: 'torrent',
      getDownload: vi.fn().mockResolvedValue({
        id: 'hash-4',
        name: 'Book Four',
        size: 0,
        bytesDownloaded: 0,
        progress: 1.0,
        status: 'seeding',
        downloadSpeed: 0,
        eta: 0,
        category: 'readmeabook',
        seedingTime: 0,
      }),
      deleteDownload: vi.fn(),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(qbtClientMock);
    prismaMock.plexLibrary.findMany.mockResolvedValue([]);
    fsMock.access.mockRejectedValue(new Error('missing'));
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.audiobook.update.mockResolvedValue({});

    const { deleteRequest } = await import('@/lib/services/request-delete.service');
    const result = await deleteRequest('req-4', 'admin-3');

    expect(result.torrentsKeptUnlimited).toBe(1);
  });

  it('clears audiobookshelf linkage when SABnzbd delete fails', async () => {
    prismaMock.request.findFirst.mockResolvedValue({
      id: 'req-5',
      audiobook: {
        id: 'ab-5',
        title: 'Book Five',
        author: 'Author',
        audibleAsin: null,
        plexGuid: null,
        absItemId: 'abs-5',
      },
      downloadHistory: [
        {
          nzbId: 'nzb-5',
          indexerName: 'IndexerE',
          downloadStatus: 'completed',
        },
      ],
    });
    configServiceMock.get.mockImplementation(async (key: string) => {
      if (key === 'prowlarr_indexers') {
        return JSON.stringify([{ name: 'IndexerE', seedingTimeMinutes: 0 }]);
      }
      if (key === 'media_dir') {
        return '/media';
      }
      return null;
    });
    configServiceMock.getBackendMode.mockResolvedValue('audiobookshelf');
    const sabClientMock = {
      clientType: 'sabnzbd',
      protocol: 'usenet',
      deleteDownload: vi.fn().mockRejectedValue(new Error('missing')),
      getDownload: vi.fn(),
      postProcess: vi.fn(),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(sabClientMock);
    prismaMock.plexLibrary.findMany.mockResolvedValue([]);
    fsMock.access.mockRejectedValue(new Error('missing'));
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.audiobook.update.mockResolvedValue({});

    const { deleteRequest } = await import('@/lib/services/request-delete.service');
    const result = await deleteRequest('req-5', 'admin-5');

    expect(result.success).toBe(true);
    expect(prismaMock.audiobook.update).toHaveBeenCalledWith({
      where: { id: 'ab-5' },
      data: expect.objectContaining({ absItemId: null }),
    });
  });

  it('deletes library item from Audiobookshelf when backend is audiobookshelf', async () => {
    prismaMock.request.findFirst.mockResolvedValue({
      id: 'req-6',
      audiobook: {
        id: 'ab-6',
        title: 'Book Six',
        author: 'Author Six',
        audibleAsin: 'ASIN6',
        plexGuid: null,
        absItemId: 'abs-item-123',
      },
      downloadHistory: [],
    });
    configServiceMock.get.mockImplementation(async (key: string) => {
      if (key === 'media_dir') {
        return '/media';
      }
      if (key === 'audiobook_path_template') {
        return '{author}/{title} {asin}';
      }
      return null;
    });
    configServiceMock.getBackendMode.mockResolvedValue('audiobookshelf');
    prismaMock.audibleCache.findUnique.mockResolvedValueOnce({
      releaseDate: '2022-01-01T00:00:00.000Z',
    });
    prismaMock.plexLibrary.findMany.mockResolvedValue([]);
    fsMock.access.mockResolvedValue(undefined);
    fsMock.rm.mockResolvedValue(undefined);
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.audiobook.update.mockResolvedValue({});

    const { deleteABSItem } = await import('@/lib/services/audiobookshelf/api');
    vi.mocked(deleteABSItem).mockResolvedValue(undefined);

    const { deleteRequest } = await import('@/lib/services/request-delete.service');
    const result = await deleteRequest('req-6', 'admin-6');

    expect(result.success).toBe(true);
    expect(deleteABSItem).toHaveBeenCalledWith('abs-item-123');
    expect(prismaMock.audiobook.update).toHaveBeenCalledWith({
      where: { id: 'ab-6' },
      data: expect.objectContaining({ absItemId: null }),
    });
  });

  it('continues deletion even if Audiobookshelf item deletion fails', async () => {
    prismaMock.request.findFirst.mockResolvedValue({
      id: 'req-7',
      audiobook: {
        id: 'ab-7',
        title: 'Book Seven',
        author: 'Author Seven',
        audibleAsin: null,
        plexGuid: null,
        absItemId: 'abs-item-456',
      },
      downloadHistory: [],
    });
    configServiceMock.get.mockImplementation(async (key: string) => {
      if (key === 'media_dir') {
        return '/media';
      }
      return null;
    });
    configServiceMock.getBackendMode.mockResolvedValue('audiobookshelf');
    prismaMock.plexLibrary.findMany.mockResolvedValue([]);
    fsMock.access.mockRejectedValue(new Error('missing'));
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.audiobook.update.mockResolvedValue({});

    const { deleteABSItem } = await import('@/lib/services/audiobookshelf/api');
    vi.mocked(deleteABSItem).mockRejectedValue(new Error('ABS API error'));

    const { deleteRequest } = await import('@/lib/services/request-delete.service');
    const result = await deleteRequest('req-7', 'admin-7');

    expect(result.success).toBe(true);
    expect(deleteABSItem).toHaveBeenCalledWith('abs-item-456');
    expect(prismaMock.request.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deletedBy: 'admin-7' }),
      })
    );
  });
  // --- Discord convergence (PR #231 review) ------------------------------------------------------
  // Every deletion path (Web UI, API token, admin route, /status, /delete) must rewrite the request
  // card and strip the approval embed's buttons, so a cancelled request never leaves live Approve /
  // Deny or Cancel buttons behind.

  const ebookRequest = (overrides: Record<string, unknown> = {}) => ({
    id: 'req-1',
    type: 'ebook',
    status: 'awaiting_approval',
    audiobook: {
      id: 'ab-1',
      title: 'Book',
      author: 'Author',
      audibleAsin: 'ASIN1',
      plexGuid: null,
      absItemId: null,
      fileFormat: null,
    },
    downloadHistory: [],
    ...overrides,
  });

  it('rewrites the request card and cancels the approval embed when the bot is running', async () => {
    discordBotMock.getClient.mockReturnValue({});
    prismaMock.request.findFirst.mockResolvedValue(ebookRequest());
    prismaMock.user.findUnique.mockResolvedValue({ discordUserId: 'discord-actor' });
    const { deleteRequest } = await import('@/lib/services/request-delete.service');

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.success).toBe(true);
    expect(discordCardsMock.editRequestCards).toHaveBeenCalledWith('req-1', 'cancelled');
    expect(discordCardsMock.cancelApprovalMessage).toHaveBeenCalledWith('req-1', 'discord-actor');
  });

  it('does no Discord work when the bot is not running', async () => {
    discordBotMock.getClient.mockReturnValue(null);
    prismaMock.request.findFirst.mockResolvedValue(ebookRequest());
    const { deleteRequest } = await import('@/lib/services/request-delete.service');

    await deleteRequest('req-1', 'admin-1');

    expect(discordCardsMock.editRequestCards).not.toHaveBeenCalled();
    expect(discordCardsMock.cancelApprovalMessage).not.toHaveBeenCalled();
  });

  it('leaves the approval embed alone when the request was not awaiting approval', async () => {
    discordBotMock.getClient.mockReturnValue({});
    prismaMock.request.findFirst.mockResolvedValue(ebookRequest({ status: 'downloading' }));
    const { deleteRequest } = await import('@/lib/services/request-delete.service');

    await deleteRequest('req-1', 'admin-1');

    expect(discordCardsMock.editRequestCards).toHaveBeenCalledWith('req-1', 'cancelled');
    expect(discordCardsMock.cancelApprovalMessage).not.toHaveBeenCalled();
  });

  it('prefers the Discord actor supplied by the caller over the stored link', async () => {
    discordBotMock.getClient.mockReturnValue({});
    prismaMock.request.findFirst.mockResolvedValue(ebookRequest());
    const { deleteRequest } = await import('@/lib/services/request-delete.service');

    await deleteRequest('req-1', 'admin-1', 'interaction-actor');

    expect(discordCardsMock.cancelApprovalMessage).toHaveBeenCalledWith('req-1', 'interaction-actor');
    // No lookup needed when the caller already knows the Discord actor.
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('attributes no one when the deleting user has no linked Discord account', async () => {
    discordBotMock.getClient.mockReturnValue({});
    prismaMock.request.findFirst.mockResolvedValue(ebookRequest());
    prismaMock.user.findUnique.mockResolvedValue({ discordUserId: null });
    const { deleteRequest } = await import('@/lib/services/request-delete.service');

    await deleteRequest('req-1', 'admin-1');

    // null rather than a broken `<@null>` mention.
    expect(discordCardsMock.cancelApprovalMessage).toHaveBeenCalledWith('req-1', null);
  });

  it('still reports success when the Discord sync throws', async () => {
    discordBotMock.getClient.mockReturnValue({});
    prismaMock.request.findFirst.mockResolvedValue(ebookRequest());
    prismaMock.user.findUnique.mockResolvedValue({ discordUserId: 'discord-actor' });
    discordCardsMock.editRequestCards.mockRejectedValueOnce(new Error('Discord unreachable'));
    const { deleteRequest } = await import('@/lib/services/request-delete.service');

    const result = await deleteRequest('req-1', 'admin-1');

    // A Discord failure must never fail the deletion itself.
    expect(result.success).toBe(true);
  });
});
