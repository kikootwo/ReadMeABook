/**
 * Component: Organize Files Processor Tests
 * Documentation: documentation/phase3/file-organization.md
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { generateFilesHash } from '@/lib/utils/files-hash';

const prismaMock = createPrismaMock();
const organizerMock = vi.hoisted(() => ({ organize: vi.fn() }));
const libraryServiceMock = vi.hoisted(() => ({ triggerLibraryScan: vi.fn() }));
const jobQueueMock = vi.hoisted(() => ({
  addNotificationJob: vi.fn(() => Promise.resolve()),
}));
const configMock = vi.hoisted(() => ({
  getBackendMode: vi.fn(),
  get: vi.fn(),
}));
const formatCoercionMock = vi.hoisted(() => ({
  coerceToPlexCompatible: vi.fn(),
}));
// The processor enriches missing series data from Audnexus; keep unit tests off the network.
const audibleServiceMock = vi.hoisted(() => ({
  getAudiobookDetails: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/utils/file-organizer', () => ({
  getFileOrganizer: () => organizerMock,
}));

vi.mock('@/lib/services/library', () => ({
  getLibraryService: () => libraryServiceMock,
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configMock,
}));

vi.mock('@/lib/services/job-queue.service', () => ({
  getJobQueueService: () => jobQueueMock,
}));

vi.mock('@/lib/utils/format-coercion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/format-coercion')>()),
  ...formatCoercionMock,
}));

vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => audibleServiceMock,
}));

// resolveTagDetails is real unless a test sets an override (it never rejects on its own). Plain holder: survives mock resets.
const tagDetailsOverride = vi.hoisted(() => ({ resolve: undefined as undefined | (() => Promise<unknown>) }));
vi.mock('@/lib/processors/organize-tag-details', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/processors/organize-tag-details')>();
  return {
    ...actual,
    resolveTagDetails: (...args: Parameters<typeof actual.resolveTagDetails>) =>
      tagDetailsOverride.resolve ? tagDetailsOverride.resolve() : actual.resolveTagDetails(...args),
  };
});

describe('processOrganizeFiles', () => {
  // The processor's first import is slow under a loaded parallel run; pay it once here
  beforeAll(async () => {
    await import('@/lib/processors/organize-files.processor');
  }, 60000);

  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock for request lookup (processor needs to determine request type)
    prismaMock.request.findUnique.mockResolvedValue({
      id: 'req-default',
      type: 'audiobook', // Default to audiobook type
      user: { plexUsername: 'testuser' },
    });
    // Default passthrough for Plex format coercion (issue #166): leave audio files unchanged
    formatCoercionMock.coerceToPlexCompatible.mockImplementation(async (paths: string[]) => ({
      renamed: [],
      warnings: [],
      errors: [],
      finalAudioFiles: paths,
    }));
    // No Audnexus data by default (no series enrichment)
    audibleServiceMock.getAudiobookDetails.mockResolvedValue(null);
  });

  it('organizes files and triggers filesystem scan when enabled', async () => {
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.audiobook.findUnique.mockResolvedValue({
      id: 'a1',
      title: 'Book',
      author: 'Author',
      narrator: null,
      coverArtUrl: null,
      audibleAsin: 'ASIN1',
    });
    organizerMock.organize.mockResolvedValue({
      success: true,
      targetPath: '/media/Author/Book',
      filesMovedCount: 1,
      errors: [],
      audioFiles: ['/media/Author/Book/Book.m4b'],
    });
    prismaMock.audiobook.update.mockResolvedValue({});
    prismaMock.request.update.mockResolvedValue({});
    configMock.getBackendMode.mockResolvedValue('plex');
    configMock.get.mockImplementation(async (key: string) => {
      if (key === 'plex.trigger_scan_after_import') return 'true';
      if (key === 'plex_audiobook_library_id') return 'lib-1';
      if (key === 'audiobook_path_template') return '{author}/{title} {asin}';
      return null;
    });

    const { processOrganizeFiles } = await import('@/lib/processors/organize-files.processor');
    const result = await processOrganizeFiles({
      requestId: 'req-1',
      audiobookId: 'a1',
      downloadPath: '/downloads/book',
      jobId: 'job-1',
    });

    expect(result.success).toBe(true);
    expect(libraryServiceMock.triggerLibraryScan).toHaveBeenCalledWith('lib-1');
    // Missing series data goes to the (mocked) Audnexus lookup, never the real network.
    expect(audibleServiceMock.getAudiobookDetails).toHaveBeenCalledWith('ASIN1');
  });

  it('skips filesystem scan when disabled', async () => {
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.audiobook.findUnique.mockResolvedValue({
      id: 'a3',
      title: 'Book',
      author: 'Author',
      narrator: null,
      coverArtUrl: null,
      audibleAsin: 'ASIN3',
      year: 2020,
    });
    organizerMock.organize.mockResolvedValue({
      success: true,
      targetPath: '/media/Author/Book',
      filesMovedCount: 1,
      errors: [],
      audioFiles: ['/media/Author/Book/Book.m4b'],
    });
    prismaMock.audiobook.update.mockResolvedValue({});
    prismaMock.request.update.mockResolvedValue({});
    configMock.getBackendMode.mockResolvedValue('plex');
    configMock.get.mockResolvedValue('false');

    const { processOrganizeFiles } = await import('@/lib/processors/organize-files.processor');
    const result = await processOrganizeFiles({
      requestId: 'req-3',
      audiobookId: 'a3',
      downloadPath: '/downloads/book',
      jobId: 'job-3',
    });

    expect(result.success).toBe(true);
    expect(libraryServiceMock.triggerLibraryScan).not.toHaveBeenCalled();
  });

  it('continues when scan is enabled but library ID is missing', async () => {
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.audiobook.findUnique.mockResolvedValue({
      id: 'a4',
      title: 'Book',
      author: 'Author',
      narrator: null,
      coverArtUrl: null,
      audibleAsin: 'ASIN4',
    });
    organizerMock.organize.mockResolvedValue({
      success: true,
      targetPath: '/media/Author/Book',
      filesMovedCount: 1,
      errors: [],
      audioFiles: ['/media/Author/Book/Book.m4b'],
    });
    prismaMock.audiobook.update.mockResolvedValue({});
    prismaMock.request.update.mockResolvedValue({});
    configMock.getBackendMode.mockResolvedValue('plex');
    configMock.get.mockImplementation(async (key: string) => {
      if (key === 'plex.trigger_scan_after_import') return 'true';
      if (key === 'plex_audiobook_library_id') return null;
      return null;
    });

    const { processOrganizeFiles } = await import('@/lib/processors/organize-files.processor');
    const result = await processOrganizeFiles({
      requestId: 'req-4',
      audiobookId: 'a4',
      downloadPath: '/downloads/book',
      jobId: 'job-4',
    });

    expect(result.success).toBe(true);
    expect(libraryServiceMock.triggerLibraryScan).not.toHaveBeenCalled();
  });

  it('updates year from AudibleCache when missing', async () => {
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.audiobook.findUnique.mockResolvedValue({
      id: 'a5',
      title: 'Book',
      author: 'Author',
      narrator: null,
      coverArtUrl: null,
      audibleAsin: 'ASIN5',
      year: null,
    });
    prismaMock.audibleCache.findUnique.mockResolvedValue({
      releaseDate: '2020-01-01',
    });
    organizerMock.organize.mockResolvedValue({
      success: true,
      targetPath: '/media/Author/Book',
      filesMovedCount: 1,
      errors: [],
      audioFiles: ['/media/Author/Book/Book.m4b'],
    });
    prismaMock.audiobook.update.mockResolvedValue({});
    prismaMock.request.update.mockResolvedValue({});
    configMock.getBackendMode.mockResolvedValue('plex');
    configMock.get.mockResolvedValue('false');

    const { processOrganizeFiles } = await import('@/lib/processors/organize-files.processor');
    const result = await processOrganizeFiles({
      requestId: 'req-5',
      audiobookId: 'a5',
      downloadPath: '/downloads/book',
      jobId: 'job-5',
    });

    expect(result.success).toBe(true);
    expect(prismaMock.audiobook.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ year: 2020 }),
      })
    );
  });

  it('queues retry when a retryable error occurs', async () => {
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.audiobook.findUnique.mockResolvedValue({
      id: 'a2',
      title: 'Book',
      author: 'Author',
      narrator: null,
      coverArtUrl: null,
      audibleAsin: 'ASIN2',
    });
    organizerMock.organize.mockResolvedValue({
      success: false,
      targetPath: '',
      filesMovedCount: 0,
      errors: ['No audiobook files found in download'],
      audioFiles: [],
    });
    prismaMock.request.findFirst.mockResolvedValue({
      importAttempts: 0,
      maxImportRetries: 3,
      deletedAt: null,
    });
    configMock.get.mockImplementation(async (key: string) => {
      if (key === 'audiobook_path_template') return '{author}/{title} {asin}';
      return null;
    });

    const { processOrganizeFiles } = await import('@/lib/processors/organize-files.processor');
    const result = await processOrganizeFiles({
      requestId: 'req-2',
      audiobookId: 'a2',
      downloadPath: '/downloads/book',
      jobId: 'job-2',
      downloadHistoryId: 'dh-client',
    });

    expect(result.success).toBe(false);
    expect(prismaMock.request.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'awaiting_import' }),
      })
    );
    // Auto-block must NOT fire on a retry — only on the terminal warn transition.
    expect(prismaMock.blockedRelease.upsert).not.toHaveBeenCalled();
  });

  it('marks request as warn when max retries exceeded, auto-blocks the release, and notifies user', async () => {
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.audiobook.findUnique.mockResolvedValue({
      id: 'a6',
      title: 'Book',
      author: 'Author',
      narrator: null,
      coverArtUrl: null,
      audibleAsin: 'ASIN6',
    });
    organizerMock.organize.mockResolvedValue({
      success: false,
      targetPath: '',
      filesMovedCount: 0,
      errors: ['No audiobook files found in download'],
      audioFiles: [],
    });
    prismaMock.request.findFirst.mockResolvedValue({
      importAttempts: 2,
      maxImportRetries: 3,
      deletedAt: null,
    });
    prismaMock.request.findUnique.mockResolvedValue({
      id: 'req-6',
      audiobook: { title: 'Book', author: 'Author' },
      user: { plexUsername: 'user' },
    });
    prismaMock.downloadHistory.findFirst.mockResolvedValue({
      id: 'dh-6',
      torrentName: 'Book by Author [M4B]',
      torrentHash: 'hash-6',
      nzbId: null,
      indexerName: 'TestIndexer',
      indexerId: 7,
    });
    prismaMock.blockedRelease.upsert.mockResolvedValue({
      id: 'block-6',
      releaseName: 'Book by Author [M4B]',
      releaseKey: 'book by author [m4b]',
      createdAt: new Date(),
    });
    configMock.get.mockResolvedValue(null);

    const { processOrganizeFiles } = await import('@/lib/processors/organize-files.processor');
    const result = await processOrganizeFiles({
      requestId: 'req-6',
      audiobookId: 'a6',
      downloadPath: '/downloads/book',
      jobId: 'job-6',
      downloadHistoryId: 'dh-client',
    });

    expect(result.success).toBe(false);
    expect(prismaMock.request.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'warn' }),
      })
    );
    expect(jobQueueMock.addNotificationJob).toHaveBeenCalledWith(
      'request_error',
      'req-6',
      'Book',
      'Author',
      'user',
      expect.stringContaining('Max retries')
    );
    // Terminal warn writes a single blocklist row keyed on the selected download.
    expect(prismaMock.blockedRelease.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { requestId_releaseKey: { requestId: 'req-6', releaseKey: 'book by author [m4b]' } },
        create: expect.objectContaining({
          requestId: 'req-6',
          releaseName: 'Book by Author [M4B]',
          releaseKey: 'book by author [m4b]',
          releaseHash: 'hash-6',
          indexerName: 'TestIndexer',
          indexerId: 7,
          source: 'organize_fail',
          reason: 'No audiobook files found',
          downloadHistoryId: 'dh-6',
        }),
      })
    );
  });

  it('marks request failed for non-retryable errors and notifies user', async () => {
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.audiobook.findUnique.mockResolvedValue({
      id: 'a7',
      title: 'Book',
      author: 'Author',
      narrator: null,
      coverArtUrl: null,
      audibleAsin: 'ASIN7',
    });
    organizerMock.organize.mockResolvedValue({
      success: false,
      targetPath: '',
      filesMovedCount: 0,
      errors: ['Unexpected error'],
      audioFiles: [],
    });
    prismaMock.request.findUnique.mockResolvedValue({
      id: 'req-7',
      audiobook: { title: 'Book', author: 'Author' },
      user: { plexUsername: 'user' },
    });
    configMock.get.mockResolvedValue(null);

    const { processOrganizeFiles } = await import('@/lib/processors/organize-files.processor');

    await expect(processOrganizeFiles({
      requestId: 'req-7',
      audiobookId: 'a7',
      downloadPath: '/downloads/book',
      jobId: 'job-7',
    })).rejects.toThrow(/File organization failed/i);

    expect(prismaMock.request.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
      })
    );
    expect(jobQueueMock.addNotificationJob).toHaveBeenCalledWith(
      'request_error',
      'req-7',
      'Book',
      'Author',
      'user',
      expect.stringContaining('File organization failed')
    );
    // Non-retryable failures do not auto-block — only terminal warn does.
    expect(prismaMock.blockedRelease.upsert).not.toHaveBeenCalled();
  });

  it('queues retry when organizer returns EPERM copy failure', async () => {
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.audiobook.findUnique.mockResolvedValue({
      id: 'a-eperm',
      title: 'Theo of Golden',
      author: 'Allen Levi',
      narrator: null,
      coverArtUrl: null,
      audibleAsin: 'B0FTT6KFKR',
    });
    // Organizer returns success: false with EPERM error (the fixed behavior)
    organizerMock.organize.mockResolvedValue({
      success: false,
      targetPath: '/media/audiobooks/Fiction/Allen Levi/Theo of Golden B0FTT6KFKR',
      filesMovedCount: 0,
      errors: [
        'Failed to copy Theo of Golden [B0FTT6KFKR].m4b: EPERM: operation not permitted, copyfile',
        'No audio files were successfully copied to the target directory',
      ],
      audioFiles: [],
    });
    prismaMock.request.findFirst.mockResolvedValue({
      importAttempts: 0,
      maxImportRetries: 3,
      deletedAt: null,
    });
    configMock.get.mockImplementation(async (key: string) => {
      if (key === 'audiobook_path_template') return '{author}/{title} {asin}';
      return null;
    });

    const { processOrganizeFiles } = await import('@/lib/processors/organize-files.processor');
    const result = await processOrganizeFiles({
      requestId: 'req-eperm',
      audiobookId: 'a-eperm',
      downloadPath: '/data/torrents/bookbit',
      jobId: 'job-eperm',
      downloadHistoryId: 'dh-client',
    });

    // Should be identified as retryable and queued for re-import
    expect(result.success).toBe(false);
    expect(prismaMock.request.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'awaiting_import',
          importAttempts: 1,
          errorMessage: expect.stringContaining('EPERM'),
        }),
      })
    );
  });

  it('calls Plex format coercion when enabled (default)', async () => {
    prismaMock.audiobook.findUnique.mockResolvedValue({
      id: 'a-coerce-on',
      title: 'Book',
      author: 'Author',
      narrator: null,
      coverArtUrl: null,
      audibleAsin: 'ASIN-CO1',
    });
    // configuration.findUnique returns undefined (no setting persisted) -> default-on
    prismaMock.configuration.findUnique.mockResolvedValue(undefined);
    organizerMock.organize.mockResolvedValue({
      success: true,
      targetPath: '/media/Author/Book',
      filesMovedCount: 1,
      errors: [],
      audioFiles: ['/media/Author/Book/Book.mp4'],
      records: [{ source: '/downloads/book/Book.mp4', target: '/media/Author/Book/Book.mp4', status: 'copied', verified: true }],
    });
    configMock.getBackendMode.mockResolvedValue('plex');
    configMock.get.mockResolvedValue('false');

    const { processOrganizeFiles } = await import('@/lib/processors/organize-files.processor');
    const result = await processOrganizeFiles({
      requestId: 'req-coerce-on',
      audiobookId: 'a-coerce-on',
      downloadPath: '/downloads/book',
      jobId: 'job-coerce-on',
    });

    expect(result.success).toBe(true);
    expect(formatCoercionMock.coerceToPlexCompatible).toHaveBeenCalledWith(
      ['/media/Author/Book/Book.mp4'],
      new Set(['/media/Author/Book/Book.mp4']),
      expect.anything()
    );
  });

  it('offers format coercion only the library files holding this import content, never other library files', async () => {
    prismaMock.audiobook.findUnique.mockResolvedValue({
      id: 'a-coerce-own', title: 'Book', author: 'Author', narrator: null, coverArtUrl: null, audibleAsin: null,
    });
    prismaMock.configuration.findUnique.mockResolvedValue(undefined);
    const lib = '/media/Author/Book';
    organizerMock.organize.mockResolvedValue({
      success: true,
      targetPath: lib,
      filesMovedCount: 1,
      errors: [],
      audioFiles: [`${lib}/Part 1.mp4`, `${lib}/Part 2.mp4`, `${lib}/Part 3.mp4`, `${lib}/Part 4.mp4`],
      records: [
        { source: '/downloads/book/Part 1.mp4', target: `${lib}/Part 1.mp4`, status: 'copied', verified: true },
        { source: '/downloads/book/Part 2.mp4', target: `${lib}/Part 2.mp4`, status: 'differs', verified: false },
        { source: '/downloads/book/Part 3.mp4', target: `${lib}/Part 3.mp4`, status: 'present', verified: false },
        { source: '/downloads/book/Part 4.mp4', target: `${lib}/Part 4.mp4`, status: 'identical', verified: true },
      ],
    });
    formatCoercionMock.coerceToPlexCompatible.mockResolvedValueOnce({
      renamed: [{ from: `${lib}/Part 1.mp4`, to: `${lib}/Part 1.m4b` }],
      warnings: [],
      errors: [],
      finalAudioFiles: [`${lib}/Part 1.m4b`, `${lib}/Part 2.mp4`, `${lib}/Part 3.mp4`, `${lib}/Part 4.mp4`],
    });
    configMock.getBackendMode.mockResolvedValue('plex');
    configMock.get.mockResolvedValue('false');

    const { processOrganizeFiles } = await import('@/lib/processors/organize-files.processor');
    await processOrganizeFiles({
      requestId: 'req-coerce-own', audiobookId: 'a-coerce-own', downloadPath: '/downloads/book', jobId: 'job-coerce-own',
    });

    const placed = formatCoercionMock.coerceToPlexCompatible.mock.calls[0][1] as Set<string>;
    // Copied now, or identical (an earlier attempt's copy after a crash); never present or differs
    expect([...placed]).toEqual([`${lib}/Part 1.mp4`, `${lib}/Part 4.mp4`]);
  });

  it('skips Plex format coercion when disabled', async () => {
    prismaMock.audiobook.findUnique.mockResolvedValue({
      id: 'a-coerce-off',
      title: 'Book',
      author: 'Author',
      narrator: null,
      coverArtUrl: null,
      audibleAsin: 'ASIN-CO2',
    });
    prismaMock.configuration.findUnique.mockImplementation(async (args: any) => {
      if (args?.where?.key === 'plex_format_coercion_enabled') {
        return { key: 'plex_format_coercion_enabled', value: 'false' };
      }
      return undefined;
    });
    organizerMock.organize.mockResolvedValue({
      success: true,
      targetPath: '/media/Author/Book',
      filesMovedCount: 1,
      errors: [],
      audioFiles: ['/media/Author/Book/Book.mp4'],
    });
    configMock.getBackendMode.mockResolvedValue('plex');
    configMock.get.mockResolvedValue('false');

    const { processOrganizeFiles } = await import('@/lib/processors/organize-files.processor');
    const result = await processOrganizeFiles({
      requestId: 'req-coerce-off',
      audiobookId: 'a-coerce-off',
      downloadPath: '/downloads/book',
      jobId: 'job-coerce-off',
    });

    expect(result.success).toBe(true);
    expect(formatCoercionMock.coerceToPlexCompatible).not.toHaveBeenCalled();
  });

  it('coercion failure does NOT mark request failed', async () => {
    prismaMock.audiobook.findUnique.mockResolvedValue({
      id: 'a-coerce-throw',
      title: 'Book',
      author: 'Author',
      narrator: null,
      coverArtUrl: null,
      audibleAsin: 'ASIN-CO3',
    });
    prismaMock.configuration.findUnique.mockResolvedValue(undefined);
    organizerMock.organize.mockResolvedValue({
      success: true,
      targetPath: '/media/Author/Book',
      filesMovedCount: 1,
      errors: [],
      audioFiles: ['/media/Author/Book/Book.mp4'],
    });
    formatCoercionMock.coerceToPlexCompatible.mockRejectedValueOnce(new Error('boom'));
    configMock.getBackendMode.mockResolvedValue('plex');
    configMock.get.mockResolvedValue('false');

    const { processOrganizeFiles } = await import('@/lib/processors/organize-files.processor');
    const result = await processOrganizeFiles({
      requestId: 'req-coerce-throw',
      audiobookId: 'a-coerce-throw',
      downloadPath: '/downloads/book',
      jobId: 'job-coerce-throw',
    });

    expect(result.success).toBe(true);
    expect(prismaMock.request.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'downloaded' }),
      })
    );
  });

  it('filesHash reflects post-coercion filenames', async () => {
    prismaMock.audiobook.findUnique.mockResolvedValue({
      id: 'a-coerce-hash',
      title: 'Book',
      author: 'Author',
      narrator: null,
      coverArtUrl: null,
      audibleAsin: 'ASIN-CO4',
    });
    prismaMock.configuration.findUnique.mockResolvedValue(undefined);
    organizerMock.organize.mockResolvedValue({
      success: true,
      targetPath: '/media/Author/Book',
      filesMovedCount: 1,
      errors: [],
      audioFiles: ['/media/Book.mp4'],
    });
    // Coercion renames .mp4 -> .m4b
    formatCoercionMock.coerceToPlexCompatible.mockResolvedValueOnce({
      renamed: [{ from: '/media/Book.mp4', to: '/media/Book.m4b' }],
      warnings: [],
      errors: [],
      finalAudioFiles: ['/media/Book.m4b'],
    });
    configMock.getBackendMode.mockResolvedValue('plex');
    configMock.get.mockResolvedValue('false');

    const { processOrganizeFiles } = await import('@/lib/processors/organize-files.processor');
    const result = await processOrganizeFiles({
      requestId: 'req-coerce-hash',
      audiobookId: 'a-coerce-hash',
      downloadPath: '/downloads/book',
      jobId: 'job-coerce-hash',
    });

    expect(result.success).toBe(true);
    const expectedHash = generateFilesHash(['/media/Book.m4b']);
    expect(expectedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(prismaMock.audiobook.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'a-coerce-hash' },
        data: expect.objectContaining({ filesHash: expectedHash }),
      })
    );
  });

  it('leaves files the library already held (differs) out of coercion and filesHash; writes fileFormat', async () => {
    prismaMock.audiobook.findUnique.mockResolvedValue({
      id: 'a-differs', title: 'Book', author: 'Author', narrator: null, coverArtUrl: null, audibleAsin: 'ASIN-DF1',
    });
    prismaMock.configuration.findUnique.mockResolvedValue(undefined);
    organizerMock.organize.mockResolvedValue({
      success: true,
      targetPath: '/media/Author/Book',
      filesMovedCount: 1,
      errors: [],
      audioFiles: ['/media/Author/Book/01.mp4', '/media/Author/Book/02.mp3'],
      records: [
        { source: '/downloads/book/01.mp4', target: '/media/Author/Book/01.mp4', status: 'copied', verified: true },
        { source: '/downloads/book/02.mp3', target: '/media/Author/Book/02.mp3', status: 'differs', verified: false },
      ],
      inventory: { kind: 'audio', files: ['/downloads/book/01.mp4', '/downloads/book/02.mp3'], complete: true },
    });
    formatCoercionMock.coerceToPlexCompatible.mockResolvedValueOnce({
      renamed: [{ from: '/media/Author/Book/01.mp4', to: '/media/Author/Book/01.m4b' }],
      warnings: [],
      errors: [],
      finalAudioFiles: ['/media/Author/Book/01.m4b'],
    });
    configMock.getBackendMode.mockResolvedValue('plex');
    configMock.get.mockResolvedValue('false');

    const { processOrganizeFiles } = await import('@/lib/processors/organize-files.processor');
    await processOrganizeFiles({ requestId: 'req-differs', audiobookId: 'a-differs', downloadPath: '/downloads/book', jobId: 'job-differs' });

    // Only this import's file may be coerced (every organized file still counts as a sibling);
    // the existing library file is never renamed
    expect(formatCoercionMock.coerceToPlexCompatible).toHaveBeenCalledWith(
      ['/media/Author/Book/01.mp4', '/media/Author/Book/02.mp3'],
      new Set(['/media/Author/Book/01.mp4']),
      expect.anything()
    );
    expect(prismaMock.audiobook.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'a-differs' },
        data: expect.objectContaining({ filesHash: generateFilesHash(['01.m4b']), fileFormat: 'm4b' }),
      })
    );
  });

  it('stores no filesHash when every file was already in the library with different content', async () => {
    prismaMock.audiobook.findUnique.mockResolvedValue({
      id: 'a-all-differs', title: 'Book', author: 'Author', narrator: null, coverArtUrl: null, audibleAsin: 'ASIN-DF2',
    });
    prismaMock.configuration.findUnique.mockResolvedValue(undefined);
    organizerMock.organize.mockResolvedValue({
      success: true,
      targetPath: '/media/Author/Book',
      filesMovedCount: 0,
      errors: [],
      audioFiles: ['/media/Author/Book/Book.mp3'],
      records: [{ source: '/downloads/book/Book.mp3', target: '/media/Author/Book/Book.mp3', status: 'differs', verified: false }],
      inventory: { kind: 'audio', files: ['/downloads/book/Book.mp3'], complete: true },
    });
    configMock.getBackendMode.mockResolvedValue('plex');
    configMock.get.mockResolvedValue('false');

    const { processOrganizeFiles } = await import('@/lib/processors/organize-files.processor');
    await processOrganizeFiles({ requestId: 'req-all-differs', audiobookId: 'a-all-differs', downloadPath: '/downloads/book', jobId: 'job-all-differs' });

    expect(formatCoercionMock.coerceToPlexCompatible).not.toHaveBeenCalled();
    expect(prismaMock.audiobook.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ filesHash: null, fileFormat: 'mp3' }) })
    );
  });

  it('generates and stores filesHash after successful organization', async () => {
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.audiobook.findUnique.mockResolvedValue({
      id: 'a-hash-1',
      title: 'Book With Hash',
      author: 'Author',
      narrator: null,
      coverArtUrl: null,
      audibleAsin: 'ASIN-HASH',
    });
    organizerMock.organize.mockResolvedValue({
      success: true,
      targetPath: '/media/Author/Book',
      filesMovedCount: 3,
      errors: [],
      audioFiles: [
        '/media/Author/Book/Chapter 01.mp3',
        '/media/Author/Book/Chapter 02.mp3',
        '/media/Author/Book/Chapter 03.mp3',
      ],
    });
    prismaMock.audiobook.update.mockResolvedValue({});
    prismaMock.request.update.mockResolvedValue({});
    configMock.getBackendMode.mockResolvedValue('audiobookshelf');
    configMock.get.mockResolvedValue('false');

    const { processOrganizeFiles } = await import('@/lib/processors/organize-files.processor');
    const result = await processOrganizeFiles({
      requestId: 'req-hash-1',
      audiobookId: 'a-hash-1',
      downloadPath: '/downloads/book',
      jobId: 'job-hash-1',
    });

    expect(result.success).toBe(true);

    // Verify filesHash was included in the audiobook update
    expect(prismaMock.audiobook.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'a-hash-1' },
        data: expect.objectContaining({
          filePath: '/media/Author/Book',
          filesHash: expect.stringMatching(/^[a-f0-9]{64}$/), // SHA256 hash format
          status: 'completed',
        }),
      })
    );
  });

  describe('metadata tag details', () => {
    function setupBook(overrides: Record<string, unknown> = {}) {
      prismaMock.request.update.mockResolvedValue({});
      prismaMock.audiobook.findUnique.mockResolvedValue({
        id: 'a-tags',
        title: 'Book',
        author: 'Author',
        narrator: 'Narrator',
        coverArtUrl: null,
        audibleAsin: 'ASIN-TAGS',
        year: 2020,
        description: 'Stored short blurb.',
        series: null,
        seriesPart: null,
        ...overrides,
      });
      organizerMock.organize.mockResolvedValue({
        success: true,
        targetPath: '/media/Author/Book',
        filesMovedCount: 1,
        errors: [],
        audioFiles: ['/media/Author/Book/Book.m4b'],
      });
      prismaMock.audiobook.update.mockResolvedValue({});
      configMock.getBackendMode.mockResolvedValue('audiobookshelf');
      configMock.get.mockResolvedValue(null);
    }

    function taggingEnabled(enabled: boolean) {
      prismaMock.configuration.findUnique.mockImplementation(async (args: { where?: { key?: string } }) =>
        args?.where?.key === 'metadata_tagging_enabled' ? { value: String(enabled) } : null
      );
    }

    async function runOrganize() {
      const { processOrganizeFiles } = await import('@/lib/processors/organize-files.processor');
      const result = await processOrganizeFiles({
        requestId: 'req-tags',
        audiobookId: 'a-tags',
        downloadPath: '/downloads/book',
        jobId: 'job-tags',
      });
      expect(result.success).toBe(true);
      const call = organizerMock.organize.mock.calls[0];
      return { metadata: call[1], placement: call[6] };
    }

    const taggingReads = () =>
      prismaMock.configuration.findUnique.mock.calls.filter((c: unknown[]) => (c[0] as { where?: { key?: string } } | undefined)?.where?.key === 'metadata_tagging_enabled');

    it('passes the Audible summary and top-level genres, looked up once for series and tags', async () => {
      setupBook();
      taggingEnabled(true);
      audibleServiceMock.getAudiobookDetails.mockResolvedValue({
        asin: 'ASIN-TAGS',
        title: 'Book',
        author: 'Author',
        description: 'Full Audible summary.',
        primaryGenres: ['Science Fiction & Fantasy'],
        series: 'The Saga',
        seriesPart: '1',
      });

      const { metadata } = await runOrganize();

      expect(audibleServiceMock.getAudiobookDetails).toHaveBeenCalledTimes(1);
      expect(metadata).toMatchObject({
        series: 'The Saga',
        seriesPart: '1',
        description: 'Full Audible summary.',
        genres: ['Science Fiction & Fantasy'],
      });
    });

    it('series already known: the lookup serves only the tags (one call)', async () => {
      setupBook({ series: 'The Saga', seriesPart: '1' });
      taggingEnabled(true);
      audibleServiceMock.getAudiobookDetails.mockResolvedValue({ description: 'Full Audible summary.', primaryGenres: ['History'] });

      const { metadata } = await runOrganize();

      expect(audibleServiceMock.getAudiobookDetails).toHaveBeenCalledTimes(1);
      expect(metadata).toMatchObject({ description: 'Full Audible summary.', genres: ['History'] });
    });

    it('falls back to the stored description when the lookup finds nothing', async () => {
      setupBook({ series: 'The Saga', seriesPart: '1' });
      taggingEnabled(true);
      audibleServiceMock.getAudiobookDetails.mockResolvedValue(null);

      const { metadata } = await runOrganize();

      expect(audibleServiceMock.getAudiobookDetails).toHaveBeenCalledWith('ASIN-TAGS');
      expect(metadata.description).toBe('Stored short blurb.');
      expect(metadata.genres).toBeUndefined();
    });

    it('does not look anything up for tags when metadata tagging is off', async () => {
      setupBook({ series: 'The Saga', seriesPart: '1' });
      taggingEnabled(false);

      const { metadata, placement } = await runOrganize();

      expect(audibleServiceMock.getAudiobookDetails).not.toHaveBeenCalled();
      expect(metadata.description).toBeUndefined();
      expect(metadata.genres).toBeUndefined();
      expect(placement).toMatchObject({ metadataTaggingEnabled: false });
    });

    it('runs the setup reads while the lookup is pending, and awaits it before organize()', async () => {
      setupBook({ series: 'The Saga', seriesPart: '1' });
      taggingEnabled(true);
      let answer!: (value: unknown) => void;
      audibleServiceMock.getAudiobookDetails.mockReturnValue(new Promise((resolve) => (answer = resolve)));
      const templateRead = () =>
        prismaMock.configuration.findUnique.mock.calls.some(
          (c: unknown[]) => (c[0] as { where?: { key?: string } } | undefined)?.where?.key === 'audiobook_path_template'
        );

      const { processOrganizeFiles } = await import('@/lib/processors/organize-files.processor');
      const run = processOrganizeFiles({ requestId: 'req-tags', audiobookId: 'a-tags', downloadPath: '/downloads/book', jobId: 'job-tags' });
      await vi.waitFor(() => expect(templateRead()).toBe(true));
      expect(organizerMock.organize).not.toHaveBeenCalled();

      answer({ description: 'Full Audible summary.', primaryGenres: ['History'] });
      await expect(run).resolves.toMatchObject({ success: true });
      expect(organizerMock.organize.mock.calls[0][1]).toMatchObject({ description: 'Full Audible summary.', genres: ['History'] });
    });

    it('a setup failure while the tag details are pending leaves no unhandled rejection when they then reject', async () => {
      setupBook({ series: 'The Saga', seriesPart: '1' });
      let fail!: (error: Error) => void;
      tagDetailsOverride.resolve = () => new Promise((_resolve, reject) => (fail = reject));
      prismaMock.configuration.findUnique.mockImplementation(async (args: { where?: { key?: string } }) => {
        if (args?.where?.key === 'metadata_tagging_enabled') return { value: 'true' };
        if (args?.where?.key === 'audiobook_path_template') throw new Error('db gone during setup');
        return null;
      });
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on('unhandledRejection', onUnhandled);
      try {
        const { processOrganizeFiles } = await import('@/lib/processors/organize-files.processor');
        await processOrganizeFiles({ requestId: 'req-tags', audiobookId: 'a-tags', downloadPath: '/downloads/book', jobId: 'job-tags' }).catch(
          () => undefined
        );
        expect(organizerMock.organize).not.toHaveBeenCalled();
        fail(new Error('tag details rejected after the setup failed'));
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(unhandled).toEqual([]);
      } finally {
        process.off('unhandledRejection', onUnhandled);
        tagDetailsOverride.resolve = undefined;
      }
    });

    it.each([true, false])('reads the tagging switch once (tagging %s) and hands that read to the organizer', async (enabled) => {
      setupBook({ series: 'The Saga', seriesPart: '1' });
      taggingEnabled(enabled);

      const { placement } = await runOrganize();

      expect(taggingReads()).toHaveLength(1);
      expect(configMock.get).not.toHaveBeenCalledWith('metadata_tagging_enabled');
      expect(placement).toMatchObject({ metadataTaggingEnabled: enabled });
    });
  });
});


