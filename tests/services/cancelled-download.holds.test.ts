/**
 * Component: Cancelled Request - Download Handling Tests (deleted and cancelled requests on a shared torrent, #545)
 * Documentation: documentation/admin-features/request-cancel.md
 *
 * The cancel step asks the shared-torrent rule (`torrentHolds`): another cancelled request now keeps a
 * finished torrent it owns until its own rule is met (unlimited: forever); a deleted or cancelled request
 * never keeps it through a row that does not own it, nor a deleted one with unlimited seeding.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DownloadHistory } from '@/generated/prisma';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const configMock = vi.hoisted(() => ({ get: vi.fn() }));
const managerMock = vi.hoisted(() => ({ getClientServiceForProtocol: vi.fn(), getClientForProtocol: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/download-client-manager.service', () => ({ getDownloadClientManager: () => managerMock }));

const createdAt = new Date('2026-10-01T12:00:00Z');
const addedAt = new Date(createdAt.getTime() + 10_000);
const HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const REQUEST = { id: 'req-1', audiobookId: 'ab-1', type: 'audiobook' };

// This request's row is on Tracker (60 min); 61 min seeded meets it, not Slow (600 min)
const row = (): DownloadHistory => ({
  id: 'dh-1', requestId: 'req-1', selected: true, downloadStatus: 'completed', torrentHash: HASH, downloadClientId: HASH,
  downloadClient: 'qbittorrent', indexerName: 'Tracker', indexerId: 1, createdAt, addedByRmab: true, completedAt: null, nzbId: null,
} as unknown as DownloadHistory);
const FINISHED = { id: HASH, name: 'Book', status: 'seeding', progress: 1, addedAt, seedingTime: 61 * 60, ratio: 0 };

const otherRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'dh-2', indexerId: 2, indexerName: 'Slow', downloadClient: 'qbittorrent', createdAt, downloadStatus: 'completed', addedByRmab: true, ...overrides,
});
const cancelledSibling = (overrides: Record<string, unknown> = {}) =>
  ({ id: 'req-2', status: 'cancelled', type: 'audiobook', audiobook: null, downloadHistory: [otherRow(overrides)] });
const softDeleted = (overrides: Record<string, unknown> = {}) => ({ id: 'req-2', downloadHistory: [otherRow(overrides)] });

const OWNED: [string, Record<string, unknown>][] = [
  ['added by RMAB', {}],
  ['a legacy row grabbed inside the window', { addedByRmab: null }],
];
const NOT_OWNED: [string, Record<string, unknown>][] = [
  ['taken over', { addedByRmab: false }],
  ['a legacy row outside the window', { addedByRmab: null, createdAt: new Date(addedAt.getTime() + 2 * 60 * 60 * 1000) }],
  ['recorded for another client', { downloadClient: 'transmission' }],
];
const UNLIMITED = { indexerName: 'Unconfigured', indexerId: 9 };

function db({ siblings = [] as unknown[], softDeletedHolders = [] as unknown[] } = {}) {
  prismaMock.request.findMany.mockImplementation(async (args: { where: { deletedAt: unknown } }) => (args.where.deletedAt === null ? siblings : softDeletedHolders));
  prismaMock.request.findFirst.mockResolvedValue(null);
  prismaMock.downloadHistory.findFirst.mockResolvedValue({ id: 'dh-1' });
}

async function cancelStep() {
  configMock.get.mockResolvedValue(JSON.stringify([
    { id: 1, name: 'Tracker', protocol: 'torrent', seedingTimeMinutes: 60 },
    { id: 2, name: 'Slow', protocol: 'torrent', seedingTimeMinutes: 600 },
  ]));
  const client = {
    clientType: 'qbittorrent',
    protocol: 'torrent',
    probeDownload: vi.fn().mockResolvedValue({ found: true, info: FINISHED }),
    deleteDownload: vi.fn().mockResolvedValue(undefined),
  };
  managerMock.getClientServiceForProtocol.mockResolvedValue(client);
  const { handleCancelledDownload } = await import('@/lib/services/cancelled-download');
  const { CancelDeadline } = await import('@/lib/services/cancel-deadline');
  const res = await handleCancelledDownload(REQUEST, row(), { mode: 'cancel', deadline: CancelDeadline.in(10_000) });
  return { outcome: res.outcome, detail: res.detail, client };
}

beforeEach(() => {
  vi.clearAllMocks();
  db();
});

describe('another cancelled request on a finished torrent', () => {
  it.each(OWNED)('keeps it until its own rule is met (%s)', async (_label, own) => {
    db({ siblings: [cancelledSibling(own)] });
    const { outcome, detail, client } = await cancelStep();
    expect(outcome).toBe('kept_shared');
    expect(detail).toContain('request req-2 still uses it (cancelled, still seeding for Slow');
    expect(client.deleteDownload).not.toHaveBeenCalled();
  });

  it.each(OWNED)('with unlimited seeding keeps it forever (%s)', async (_label, own) => {
    db({ siblings: [cancelledSibling({ ...UNLIMITED, ...own })] });
    expect((await cancelStep()).outcome).toBe('kept_shared');
  });

  it.each(NOT_OWNED)('never keeps it through a row that does not own it, slow or unlimited (%s)', async (_label, own) => {
    db({ siblings: [cancelledSibling(own)] });
    expect((await cancelStep()).outcome).toBe('removed');
    db({ siblings: [cancelledSibling({ ...UNLIMITED, ...own })] });
    expect((await cancelStep()).outcome).toBe('removed');
  });

  it('lets go once its own rule is met: removed, and only rows recorded for this client marked removed', async () => {
    db({ siblings: [cancelledSibling({ indexerName: 'Tracker', indexerId: 1 })] });
    const { outcome, client } = await cancelStep();
    expect(outcome).toBe('removed');
    expect(client.deleteDownload).toHaveBeenCalledWith(HASH, true);
    expect(prismaMock.downloadHistory.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        requestId: { not: 'req-1' },
        selected: true,
        AND: expect.arrayContaining([{ OR: [{ downloadClient: null }, { downloadClient: '' }, { downloadClient: 'qbittorrent' }] }]),
      }),
      data: { downloadStatus: 'removed' },
    }));
  });
});

describe('a soft-deleted request on a finished torrent', () => {
  it.each(OWNED)('keeps it until its own rule is met (%s)', async (_label, own) => {
    db({ softDeletedHolders: [softDeleted(own)] });
    expect((await cancelStep()).outcome).toBe('kept_shared');
  });

  it.each(OWNED)('with unlimited seeding never keeps it (%s)', async (_label, own) => {
    db({ softDeletedHolders: [softDeleted({ ...UNLIMITED, ...own })] });
    expect((await cancelStep()).outcome).toBe('removed');
  });

  it.each(NOT_OWNED)('never keeps it through a row that does not own it (%s)', async (_label, own) => {
    db({ softDeletedHolders: [softDeleted(own)] });
    expect((await cancelStep()).outcome).toBe('removed');
  });
});
