/**
 * Component: Organize Files Processor Tests
 * Documentation: documentation/phase3/file-organization.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

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

describe('processOrganizeFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock for request lookup (processor needs to determine request type)
    prismaMock.request.findUnique.mockResolvedValue({
      id: 'req-default',
      type: 'audiobook', // Default to audiobook type
      user: { plexUsername: 'testuser' },
    });
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
      if (key === 'audiobook_path_template') return '{author}/{title} {[asin]}';
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
      if (key === 'audiobook_path_template') return '{author}/{title} {[asin]}';
      return null;
    });

    const { processOrganizeFiles } = await import('@/lib/processors/organize-files.processor');
    const result = await processOrganizeFiles({
      requestId: 'req-2',
      audiobookId: 'a2',
      downloadPath: '/downloads/book',
      jobId: 'job-2',
    });

    expect(result.success).toBe(false);
    expect(prismaMock.request.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'awaiting_import' }),
      })
    );
  });

  it('marks request as warn when max retries exceeded and notifies user', async () => {
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
    configMock.get.mockResolvedValue(null);

    const { processOrganizeFiles } = await import('@/lib/processors/organize-files.processor');
    const result = await processOrganizeFiles({
      requestId: 'req-6',
      audiobookId: 'a6',
      downloadPath: '/downloads/book',
      jobId: 'job-6',
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
      if (key === 'audiobook_path_template') return '{author}/{title} {[asin]}';
      return null;
    });

    const { processOrganizeFiles } = await import('@/lib/processors/organize-files.processor');
    const result = await processOrganizeFiles({
      requestId: 'req-eperm',
      audiobookId: 'a-eperm',
      downloadPath: '/data/torrents/bookbit',
      jobId: 'job-eperm',
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
});


