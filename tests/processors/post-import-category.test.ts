/**
 * Component: Post-Import Category Tests (#423)
 * Documentation: documentation/phase3/download-clients.md
 *
 * The post-import category change can move files (qBittorrent automatic torrent management)
 * or replace labels, so it only runs for a torrent RMAB added (the shared ownership rule).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import type { RMABLogger } from '@/lib/utils/logger';

const prismaMock = createPrismaMock();
const service = vi.hoisted(() => ({ setCategory: vi.fn(), probeDownload: vi.fn() }));
const managerMock = vi.hoisted(() => ({ getAllClients: vi.fn(), createClientFromConfig: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => ({}) }));
vi.mock('@/lib/services/download-client-manager.service', () => ({ getDownloadClientManager: () => managerMock }));

const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } as unknown as RMABLogger;

const HOUR = 60 * 60 * 1000;
const createdAt = new Date('2026-10-01T12:00:00Z');

function row(fields: Record<string, unknown> = {}) {
  prismaMock.downloadHistory.findFirst.mockResolvedValue({
    downloadClient: 'qbittorrent', downloadClientId: 'hash-1', addedByRmab: true,
    downloadStatus: 'completed', createdAt, ...fields,
  });
}

function addedAt(offsetMs: number) {
  service.probeDownload.mockResolvedValue({
    found: true,
    info: { id: 'hash-1', name: 'Book', status: 'seeding', progress: 1, addedAt: new Date(createdAt.getTime() + offsetMs) },
  });
}

async function apply() {
  const { applyPostImportCategory } = await import('@/lib/processors/post-import-category');
  await applyPostImportCategory('req-1', logger);
}

describe('applyPostImportCategory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    managerMock.getAllClients.mockResolvedValue([{ enabled: true, type: 'qbittorrent', postImportCategory: 'done' }]);
    managerMock.createClientFromConfig.mockResolvedValue(service);
    addedAt(10 * 1000);
  });

  it.each([
    [true, 1],
    [false, 0],
    [null, 0],
  ])('row with addedByRmab=%s: setCategory called %s time(s)', async (addedByRmab, calls) => {
    row({ addedByRmab });

    await apply();

    expect(service.setCategory).toHaveBeenCalledTimes(calls);
    if (calls) expect(service.setCategory).toHaveBeenCalledWith('hash-1', 'done');
    // The same row the import reads: the request's newest download history
    expect(prismaMock.downloadHistory.findFirst).toHaveBeenCalledWith({ where: { requestId: 'req-1' }, orderBy: { createdAt: 'desc' } });
  });

  it('skips a row RMAB already recorded as gone (removed), without asking the client', async () => {
    row({ downloadStatus: 'removed' });

    await apply();

    expect(service.setCategory).not.toHaveBeenCalled();
    expect(service.probeDownload).not.toHaveBeenCalled();
  });

  it.each([
    ['re-added more than 1 h after the grab', 2 * HOUR],
    ['an older copy, added 2 days before the grab', -2 * 24 * HOUR],
  ])('skips a torrent recorded as RMAB\'s when the client copy is %s', async (_label, offsetMs) => {
    row();
    addedAt(offsetMs);

    await apply();

    expect(service.setCategory).not.toHaveBeenCalled();
  });

  it.each([
    ['the probe fails', () => service.probeDownload.mockRejectedValue(new Error('timeout of 60000ms exceeded'))],
    ['the client does not have it', () => service.probeDownload.mockResolvedValue({ found: false })],
  ])('skips when %s (the client did not confirm the torrent)', async (_label, arrange) => {
    row();
    arrange();

    await apply();

    expect(service.setCategory).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
