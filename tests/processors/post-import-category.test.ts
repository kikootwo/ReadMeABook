/**
 * Component: Post-Import Category Tests (#423)
 * Documentation: documentation/phase3/download-clients.md
 *
 * The post-import category change can move files (qBittorrent automatic torrent management)
 * or replace labels, so it only runs for a torrent RMAB added.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import type { RMABLogger } from '@/lib/utils/logger';

const prismaMock = createPrismaMock();
const service = vi.hoisted(() => ({ setCategory: vi.fn() }));
const managerMock = vi.hoisted(() => ({ getAllClients: vi.fn(), createClientFromConfig: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => ({}) }));
vi.mock('@/lib/services/download-client-manager.service', () => ({ getDownloadClientManager: () => managerMock }));

const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } as unknown as RMABLogger;

describe('applyPostImportCategory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    managerMock.getAllClients.mockResolvedValue([{ enabled: true, type: 'qbittorrent', postImportCategory: 'done' }]);
    managerMock.createClientFromConfig.mockResolvedValue(service);
  });

  it.each([
    [true, 1],
    [false, 0],
    [null, 0],
  ])('row with addedByRmab=%s: setCategory called %s time(s)', async (addedByRmab, calls) => {
    prismaMock.downloadHistory.findFirst.mockResolvedValue({
      downloadClient: 'qbittorrent', downloadClientId: 'hash-1', addedByRmab,
    });

    const { applyPostImportCategory } = await import('@/lib/processors/post-import-category');
    await applyPostImportCategory('req-1', logger);

    expect(service.setCategory).toHaveBeenCalledTimes(calls);
    // The same row the import reads: the request's newest download history
    expect(prismaMock.downloadHistory.findFirst).toHaveBeenCalledWith({ where: { requestId: 'req-1' }, orderBy: { createdAt: 'desc' } });
  });
});
