/**
 * Component: Post-Import Library Scan Tests
 * Documentation: documentation/phase3/file-organization.md
 *
 * The scan after import targets the library the files landed in: on Audiobookshelf an
 * ebook import scans the ebook library when one is set, else the audiobook library.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RMABLogger } from '@/lib/utils/logger';

const libraryServiceMock = vi.hoisted(() => ({ triggerLibraryScan: vi.fn() }));
const configMock = vi.hoisted(() => ({ getBackendMode: vi.fn(), get: vi.fn() }));

vi.mock('@/lib/services/library', () => ({ getLibraryService: async () => libraryServiceMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));

const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } as unknown as RMABLogger;

function config(backendMode: 'plex' | 'audiobookshelf', values: Record<string, string>) {
  configMock.getBackendMode.mockResolvedValue(backendMode);
  configMock.get.mockImplementation(async (key: string) => values[key] ?? null);
}

async function scan(kind: 'audiobook' | 'ebook') {
  const { triggerScanAfterImport } = await import('@/lib/processors/post-import-scan');
  await triggerScanAfterImport(kind, logger);
}

const absEnabled = {
  'audiobookshelf.trigger_scan_after_import': 'true',
  'audiobookshelf.library_id': 'abs-audio',
};

describe('triggerScanAfterImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    libraryServiceMock.triggerLibraryScan.mockResolvedValue(undefined);
  });

  it('Audiobookshelf ebook: scans the ebook library when one is set', async () => {
    config('audiobookshelf', { ...absEnabled, 'audiobookshelf.ebook_library_id': 'abs-ebooks' });

    await scan('ebook');

    expect(libraryServiceMock.triggerLibraryScan).toHaveBeenCalledTimes(1);
    expect(libraryServiceMock.triggerLibraryScan).toHaveBeenCalledWith('abs-ebooks');
  });

  it('Audiobookshelf ebook: scans the audiobook library when no ebook library is set', async () => {
    config('audiobookshelf', { ...absEnabled, 'audiobookshelf.ebook_library_id': '' });

    await scan('ebook');

    expect(libraryServiceMock.triggerLibraryScan).toHaveBeenCalledWith('abs-audio');
  });

  it('Audiobookshelf audiobook: scans the audiobook library even when an ebook library is set', async () => {
    config('audiobookshelf', { ...absEnabled, 'audiobookshelf.ebook_library_id': 'abs-ebooks' });

    await scan('audiobook');

    expect(libraryServiceMock.triggerLibraryScan).toHaveBeenCalledWith('abs-audio');
  });

  it.each(['audiobook', 'ebook'] as const)('Plex %s: scans the Plex audiobook library', async (kind) => {
    config('plex', {
      'plex.trigger_scan_after_import': 'true',
      'plex_audiobook_library_id': 'plex-1',
      // An Audiobookshelf setting left over from a backend switch is ignored
      'audiobookshelf.ebook_library_id': 'abs-ebooks',
    });

    await scan(kind);

    expect(libraryServiceMock.triggerLibraryScan).toHaveBeenCalledWith('plex-1');
  });

  it.each(['audiobook', 'ebook'] as const)('%s: no scan when the scan setting is off', async (kind) => {
    config('audiobookshelf', {
      ...absEnabled,
      'audiobookshelf.trigger_scan_after_import': 'false',
      'audiobookshelf.ebook_library_id': 'abs-ebooks',
    });

    await scan(kind);

    expect(libraryServiceMock.triggerLibraryScan).not.toHaveBeenCalled();
  });

  it('no scan and a warning when no library is configured', async () => {
    config('audiobookshelf', { 'audiobookshelf.trigger_scan_after_import': 'true' });

    await scan('ebook');

    expect(libraryServiceMock.triggerLibraryScan).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('a failed scan is logged and does not throw', async () => {
    config('audiobookshelf', { ...absEnabled, 'audiobookshelf.ebook_library_id': 'abs-ebooks' });
    libraryServiceMock.triggerLibraryScan.mockRejectedValue(new Error('ABS unreachable'));

    await expect(scan('ebook')).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('ABS unreachable'), expect.anything());
  });
});
