/**
 * Component: Request Delete Service Tests (Discord cards)
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * After the soft delete, the request's Discord cards (and those of the child requests deleted
 * with it) are refreshed once, in the background. With the bot off no Discord module loads; a
 * failing or hanging Discord update never fails or delays the delete.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  getABSItem: vi.fn(),
}));

// The library delete guard has its own real-filesystem tests; here it allows every folder
const guardMock = vi.hoisted(() => ({ assertSafeLibraryDelete: vi.fn(), isStaleStoredFolder: vi.fn(async () => false) }));
vi.mock('@/lib/utils/library-delete-guard', () => guardMock);
vi.mock('@/lib/processors/organize-cleanup-guard', () => ({ sweepEmptyParents: vi.fn(async () => undefined) }));
// What D1 removes inside the folder has its own real-filesystem tests (request-delete.book-folder, book-folder-junk)
const folderMock = vi.hoisted(() => ({ removeBookFolderFiles: vi.fn(), removeFolderIfOnlyJunk: vi.fn() }));
vi.mock('@/lib/utils/book-folder-delete', () => folderMock);
const canonical = (p: string) => path.resolve(p).replace(/\\/g, '/');
// Discord: the bot service and the card module are reached only through the running-check facade
const discord = vi.hoisted(() => ({ botLoads: 0, refresh: vi.fn() }));
vi.mock('@/lib/services/discord/discord-bot.service', () => {
  discord.botLoads++;
  return { getDiscordBotService: () => ({ getClient: () => null }) };
});
vi.mock('@/lib/services/discord/cards/discord-cards', () => ({ refreshRequestCards: discord.refresh }));

describe('deleteRequest: Discord cards', () => {
  /** An audiobook request in Audiobookshelf with one undelivered child ebook request. */
  function seedAbsRequest() {
    prismaMock.request.findFirst.mockResolvedValue({
      id: 'req-6',
      audiobook: {
        id: 'ab-6', title: 'Book Six', author: 'Author Six', audibleAsin: 'ASIN6', plexGuid: null,
        absItemId: 'abs-item-123', filePath: path.join('/media', 'Author Six', 'Book Six ASIN6'),
      },
      downloadHistory: [],
    });
    prismaMock.request.findMany.mockResolvedValue([{ id: 'child-1', type: 'ebook', status: 'pending', completedAt: null, placedEbookFiles: null }]);
    configServiceMock.get.mockImplementation(async (key: string) => (key === 'media_dir' ? '/media' : null));
    configServiceMock.getBackendMode.mockResolvedValue('audiobookshelf');
    prismaMock.plexLibrary.findMany.mockResolvedValue([]);
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.audiobook.update.mockResolvedValue({});
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    prismaMock.request.updateMany.mockResolvedValue({ count: 1 });
    guardMock.assertSafeLibraryDelete.mockImplementation(async (p: string) => ({
      deletePath: canonical(p),
      canonicalPath: canonical(p),
      exists: true,
      roots: { mediaDir: '/media', downloadRoots: [], sweepRoots: [], mappedRoots: [] },
    }));
    folderMock.removeBookFolderFiles.mockResolvedValue({ kind: 'removed', folderRemoved: true, removed: 1, kept: [] });
    const { deleteABSItem, getABSItem } = await import('@/lib/services/audiobookshelf/api');
    vi.mocked(deleteABSItem).mockResolvedValue(undefined);
    vi.mocked(getABSItem).mockResolvedValue({ path: path.join('/media', 'Author Six', 'Book Six ASIN6') } as never);
    seedAbsRequest();
  });

  afterEach(async () => {
    const { setDiscordBotRunning } = await import('@/lib/services/discord/discord-runtime');
    setDiscordBotRunning(false);
  });

  // Runs first: nothing earlier in this file starts the bot
  it('the bot off: the delete loads no Discord module and starts no card refresh; the same delete with the bot on refreshes', async () => {
    const { deleteRequest } = await import('@/lib/services/request-delete.service');
    const result = await deleteRequest('req-6', 'admin-6');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(result.success).toBe(true);
    expect(discord.botLoads).toBe(0);
    expect(discord.refresh).not.toHaveBeenCalled();

    // Control: the hook is there, gated on the bot only
    const { setDiscordBotRunning } = await import('@/lib/services/discord/discord-runtime');
    setDiscordBotRunning(true);
    discord.refresh.mockResolvedValue(null);
    expect((await deleteRequest('req-6', 'admin-6')).success).toBe(true);
    await vi.waitFor(() => expect(discord.refresh).toHaveBeenCalledWith(expect.anything(), 'req-6'));
  });

  it('the bot running: after the soft delete, the request and the child requests deleted with it are refreshed once each', async () => {
    const { setDiscordBotRunning } = await import('@/lib/services/discord/discord-runtime');
    setDiscordBotRunning(true);
    discord.refresh.mockResolvedValue(null);
    const { deleteRequest } = await import('@/lib/services/request-delete.service');

    const result = await deleteRequest('req-6', 'admin-6');

    expect(result.success).toBe(true);
    await vi.waitFor(() => expect(discord.refresh).toHaveBeenCalledTimes(2));
    expect(discord.refresh.mock.calls.map((call) => call[1]).sort()).toEqual(['child-1', 'req-6']);
    expect(prismaMock.request.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ deletedBy: 'admin-6' }) }));
  });

  it.each([
    ['rejects', () => Promise.reject(new Error('Discord API 50013'))],
    ['throws', () => {
      throw new Error('Discord client gone');
    }],
    ['never settles', () => new Promise(() => undefined)],
  ])('the Discord update %s: the delete still succeeds', async (_label, impl) => {
    const { setDiscordBotRunning } = await import('@/lib/services/discord/discord-runtime');
    setDiscordBotRunning(true);
    discord.refresh.mockImplementation(impl);
    const { deleteRequest } = await import('@/lib/services/request-delete.service');

    const result = await deleteRequest('req-6', 'admin-6');

    expect(result).toMatchObject({ success: true, message: 'Request deleted successfully' });
    await vi.waitFor(() => expect(discord.refresh).toHaveBeenCalled());
  });

  it('a delete that changes nothing (not found) refreshes no card; one that deletes does', async () => {
    const { setDiscordBotRunning } = await import('@/lib/services/discord/discord-runtime');
    setDiscordBotRunning(true);
    discord.refresh.mockResolvedValue(null);
    const { deleteRequest } = await import('@/lib/services/request-delete.service');
    expect((await deleteRequest('req-6', 'admin-6')).success).toBe(true);
    await vi.waitFor(() => expect(discord.refresh).toHaveBeenCalled());
    const refreshes = discord.refresh.mock.calls.length;

    prismaMock.request.findFirst.mockResolvedValue(null);
    expect((await deleteRequest('req-6', 'admin-6')).success).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(discord.refresh).toHaveBeenCalledTimes(refreshes);
  });
});
