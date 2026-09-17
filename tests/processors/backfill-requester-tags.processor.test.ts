/**
 * Component: Backfill Requester Tags Processor Tests
 * Documentation: documentation/features/requester-tags.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const configMock = vi.hoisted(() => ({
  getBackendMode: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configMock,
}));

vi.mock('@/lib/services/audiobookshelf/api', () => ({
  addABSItemTags: vi.fn(() => Promise.resolve()),
  formatRequesterTag: (username: string) => {
    const sanitized = username.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '');
    return sanitized ? `req:${sanitized}` : '';
  },
}));

describe('processBackfillRequesterTags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips entirely when not in Audiobookshelf mode', async () => {
    configMock.getBackendMode.mockResolvedValue('plex');

    const { processBackfillRequesterTags } = await import('@/lib/processors/backfill-requester-tags.processor');
    const result = await processBackfillRequesterTags({ jobId: 'job-1' });

    expect(result.skipped).toBe(true);
    expect(prismaMock.request.findMany).not.toHaveBeenCalled();
  });

  it('tags each eligible available request and skips unusable ones', async () => {
    configMock.getBackendMode.mockResolvedValue('audiobookshelf');

    prismaMock.request.findMany.mockResolvedValue([
      { audiobook: { absItemId: 'abs-1' }, user: { plexUsername: 'guggs' } },
      { audiobook: { absItemId: 'abs-2' }, user: { plexUsername: 'John Smith' } },
      // Unusable: username sanitizes to nothing
      { audiobook: { absItemId: 'abs-3' }, user: { plexUsername: '李雷' } },
      // Unusable: no username
      { audiobook: { absItemId: 'abs-4' }, user: { plexUsername: null } },
    ] as any);

    const absApi = await import('@/lib/services/audiobookshelf/api');

    const { processBackfillRequesterTags } = await import('@/lib/processors/backfill-requester-tags.processor');
    const result = await processBackfillRequesterTags({ jobId: 'job-2' });

    expect(result.tagged).toBe(2);
    expect(result.skipped).toBe(2);
    expect(result.total).toBe(4);
    expect(absApi.addABSItemTags).toHaveBeenCalledTimes(2);
    expect(absApi.addABSItemTags).toHaveBeenCalledWith('abs-1', ['req:guggs']);
    expect(absApi.addABSItemTags).toHaveBeenCalledWith('abs-2', ['req:john_smith']);
  });

  it('queries only non-deleted available audiobook requests with an ABS item ID', async () => {
    configMock.getBackendMode.mockResolvedValue('audiobookshelf');
    prismaMock.request.findMany.mockResolvedValue([]);

    const { processBackfillRequesterTags } = await import('@/lib/processors/backfill-requester-tags.processor');
    await processBackfillRequesterTags({ jobId: 'job-3' });

    expect(prismaMock.request.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'available',
          type: 'audiobook',
          deletedAt: null,
          audiobook: { absItemId: { not: null } },
        }),
      })
    );
  });
});
