/**
 * Component: Send-to-E-Reader Processor Tests
 * Documentation: documentation/integrations/ebook-sidecar.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const configMock = vi.hoisted(() => ({
  get: vi.fn(),
  getBackendMode: vi.fn(),
}));
const absApiMock = vi.hoisted(() => ({
  getABSItem: vi.fn(),
  searchABSItems: vi.fn(),
}));
const ereaderMock = vi.hoisted(() => ({
  getEreaderDevices: vi.fn(),
  sendEbookToDevice: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/audiobookshelf/api', () => absApiMock);
vi.mock('@/lib/services/audiobookshelf/ereader', () => ereaderMock);

const kindle = { name: 'Kindle', email: 'me@kindle.com', sendable: true };
const kobo = { name: 'Kobo', email: 'me@kobo.com', sendable: true };

function setup({
  config = { ebook_ereader_auto_send_enabled: 'true', 'audiobookshelf.library_id': 'lib-1' } as Record<string, string>,
  backendMode = 'audiobookshelf',
  sentDevices = [] as string[],
  absItemId = 'item-1' as string | null,
  requesters = [{ userId: 'u-1' }, { userId: 'u-2' }],
  users = [{ ereaderDeviceNames: ['Kindle'] }, { ereaderDeviceNames: ['Kobo', 'Kindle'] }] as { ereaderDeviceNames: unknown }[],
  devices = [kindle, kobo],
  item = { media: { ebookFile: { metadata: { filename: 'book.epub' } } } } as any,
} = {}) {
  configMock.get.mockImplementation(async (key: string) => config[key] ?? null);
  configMock.getBackendMode.mockResolvedValue(backendMode);
  prismaMock.request.findFirst.mockResolvedValue({
    id: 'ebook-req',
    ereaderSentDevices: sentDevices,
    audiobook: { id: 'ab-1', title: 'Red Rising', author: 'Pierce Brown', absItemId },
  });
  prismaMock.request.findMany.mockResolvedValue(requesters);
  prismaMock.user.findMany.mockResolvedValue(users);
  prismaMock.request.update.mockResolvedValue({});
  ereaderMock.getEreaderDevices.mockResolvedValue(devices);
  ereaderMock.sendEbookToDevice.mockResolvedValue(undefined);
  absApiMock.getABSItem.mockResolvedValue(item);
}

const run = async (payload: { requestId: string; targetUserIds?: string[] } = { requestId: 'ebook-req' }) => {
  const { processSendToEreader } = await import('@/lib/processors/send-to-ereader.processor');
  return processSendToEreader({ ...payload, jobId: 'job-1' });
};

describe('processSendToEreader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when e-reader delivery is off', async () => {
    setup({ config: {} });

    await run();

    expect(prismaMock.request.findFirst).not.toHaveBeenCalled();
    expect(ereaderMock.sendEbookToDevice).not.toHaveBeenCalled();
  });

  it('does nothing outside Audiobookshelf mode', async () => {
    setup({ backendMode: 'plex' });

    await run();

    expect(ereaderMock.sendEbookToDevice).not.toHaveBeenCalled();
  });

  it("emails every requester's devices once each and records them on the ebook request", async () => {
    setup();

    await run();

    expect(prismaMock.request.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ audiobookId: 'ab-1', deletedAt: null }),
    }));
    expect(ereaderMock.sendEbookToDevice).toHaveBeenCalledTimes(2);
    expect(ereaderMock.sendEbookToDevice).toHaveBeenCalledWith('item-1', 'Kindle');
    expect(ereaderMock.sendEbookToDevice).toHaveBeenCalledWith('item-1', 'Kobo');
    expect(prismaMock.request.update).toHaveBeenCalledWith({
      where: { id: 'ebook-req' },
      data: { ereaderSentDevices: ['Kindle', 'Kobo'] },
    });
  });

  it('never re-sends to a device already emailed', async () => {
    setup({ sentDevices: ['Kindle'] });

    await run();

    expect(ereaderMock.sendEbookToDevice).toHaveBeenCalledTimes(1);
    expect(ereaderMock.sendEbookToDevice).toHaveBeenCalledWith('item-1', 'Kobo');
    expect(prismaMock.request.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { ereaderSentDevices: ['Kindle', 'Kobo'] },
    }));
  });

  it("only uses a late requester's devices when target users are given", async () => {
    setup({ users: [{ ereaderDeviceNames: ['Kobo'] }] });

    await run({ requestId: 'ebook-req', targetUserIds: ['u-2'] });

    expect(prismaMock.request.findMany).not.toHaveBeenCalled();
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['u-2'] }, deletedAt: null },
    }));
    expect(ereaderMock.sendEbookToDevice).toHaveBeenCalledWith('item-1', 'Kobo');
    expect(ereaderMock.sendEbookToDevice).toHaveBeenCalledTimes(1);
  });

  it("skips devices ABS no longer has or won't let RMAB send to", async () => {
    setup({ devices: [{ ...kindle, sendable: false }] });

    await run();

    expect(ereaderMock.sendEbookToDevice).not.toHaveBeenCalled();
    expect(absApiMock.getABSItem).not.toHaveBeenCalled();
  });

  it('retries (throws) before sending anything while the ABS item has no ebook yet', async () => {
    setup({ item: { media: { ebookFile: null } } });

    await expect(run()).rejects.toThrow(/no ebook yet/);
    expect(ereaderMock.sendEbookToDevice).not.toHaveBeenCalled();
  });

  it('keeps going and records successes when one device fails', async () => {
    setup();
    ereaderMock.sendEbookToDevice.mockImplementation(async (_item: string, device: string) => {
      if (device === 'Kindle') throw new Error('ABS API error: 400 Bad Request');
    });

    await expect(run()).resolves.toBeUndefined();
    expect(prismaMock.request.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { ereaderSentDevices: ['Kobo'] },
    }));
  });

  describe('without a matched ABS item', () => {
    it('finds the item by exact title and author', async () => {
      setup({ absItemId: null });
      absApiMock.searchABSItems.mockResolvedValue([
        { libraryItem: { id: 'wrong', media: { metadata: { title: 'Red Rising', authorName: 'Someone Else' } } } },
        { libraryItem: { id: 'right', media: { metadata: { title: 'Red Rising', authorName: 'Pierce Brown' } } } },
      ]);

      await run();

      expect(absApiMock.searchABSItems).toHaveBeenCalledWith('lib-1', 'Red Rising');
      expect(ereaderMock.sendEbookToDevice).toHaveBeenCalledWith('right', 'Kindle');
    });

    it('never settles for a fuzzy match, and retries instead', async () => {
      setup({ absItemId: null });
      absApiMock.searchABSItems.mockResolvedValue([
        { libraryItem: { id: 'sequel', media: { metadata: { title: 'Red Rising: Golden Son', authorName: 'Pierce Brown' } } } },
      ]);

      await expect(run()).rejects.toThrow(/isn't in Audiobookshelf yet/);
      expect(ereaderMock.sendEbookToDevice).not.toHaveBeenCalled();
    });
  });
});
