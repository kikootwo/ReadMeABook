/**
 * Component: Post-organize cleanup plan tests - jobs RMAB took over (#329)
 * Documentation: documentation/phase3/file-organization.md
 *
 * Remove-after-processing never removes the files of a client job RMAB did not add.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

const DOWNLOAD_PATH = '/downloads/My.Audiobook.Release';
const indexers = async () => JSON.stringify([{ id: 2, name: 'UsenetIndexer', protocol: 'usenet', removeAfterProcessing: true }]);

function row(addedByRmab: boolean | null) {
  return {
    id: 'dh-1', requestId: 'req-1', downloadClient: 'sabnzbd', downloadClientId: 'SABnzbd_nzo_existing',
    indexerId: 2, downloadStatus: 'completed', downloadPath: DOWNLOAD_PATH, addedByRmab,
  };
}

describe('planDownloadCleanup: taken-over usenet jobs (#329)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('plans no cleanup for a SABnzbd job RMAB took over (addedByRmab false)', async () => {
    prismaMock.downloadHistory.findUnique.mockResolvedValue(row(false));
    const { planDownloadCleanup } = await import('@/lib/processors/organize-cleanup-guard');

    expect(await planDownloadCleanup('req-1', DOWNLOAD_PATH, 'dh-1', indexers)).toBeNull();
  });

  it.each([true, null])('still plans cleanup for RMAB\'s own job (addedByRmab %s)', async (addedByRmab) => {
    prismaMock.downloadHistory.findUnique.mockResolvedValue(row(addedByRmab));
    const { planDownloadCleanup } = await import('@/lib/processors/organize-cleanup-guard');

    expect(await planDownloadCleanup('req-1', DOWNLOAD_PATH, 'dh-1', indexers)).toMatchObject({ kind: 'indexer', indexerId: 2 });
  });
});
