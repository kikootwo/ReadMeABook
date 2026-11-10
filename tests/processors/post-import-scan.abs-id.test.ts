/**
 * Component: Post-Import Library Scan Tests (real Audiobookshelf client)
 * Documentation: documentation/phase3/file-organization.md
 *
 * The library ids are free strings saved in settings. Through the real library service and
 * Audiobookshelf client: a usable id reaches POST /api/libraries/<id>/scan encoded, a dot
 * segment is refused before any request, and a refused scan never fails the import.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RMABLogger } from '@/lib/utils/logger';

const configMock = vi.hoisted(() => ({ getBackendMode: vi.fn(), get: vi.fn() }));
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));

const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } as unknown as RMABLogger;

function absConfig(ebookLibraryId: string) {
  const values: Record<string, string> = {
    'audiobookshelf.server_url': 'http://abs:13378',
    'audiobookshelf.api_token': 'token',
    'audiobookshelf.trigger_scan_after_import': 'true',
    'audiobookshelf.library_id': 'lib-audio',
    'audiobookshelf.ebook_library_id': ebookLibraryId,
  };
  configMock.getBackendMode.mockResolvedValue('audiobookshelf');
  configMock.get.mockImplementation(async (key: string) => values[key] ?? null);
}

async function scanEbook() {
  const { triggerScanAfterImport } = await import('@/lib/processors/post-import-scan');
  await triggerScanAfterImport('ebook', logger);
}

describe('triggerScanAfterImport with the real Audiobookshelf client', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, text: async () => 'OK' });
    vi.stubGlobal('fetch', fetchMock);
    const { clearLibraryServiceCache } = await import('@/lib/services/library');
    clearLibraryServiceCache();
  });

  it('scans the ebook library at its encoded path', async () => {
    absConfig('lib ebooks/2');

    await scanEbook();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://abs:13378/api/libraries/lib%20ebooks%2F2/scan');
  });

  it.each(['.', '..'])('ebook library id "%s": no request, logged, the import goes on', async (ebookLibraryId) => {
    absConfig(ebookLibraryId);

    await expect(scanEbook()).resolves.toBeUndefined();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Invalid Audiobookshelf library id'),
      expect.anything()
    );
  });
});
