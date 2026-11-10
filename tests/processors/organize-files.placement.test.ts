/**
 * Component: Organize Files Processor - File Placement and metadata.opf Tests
 * Documentation: documentation/features/library-placement.md
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const organizerMock = vi.hoisted(() => ({ organize: vi.fn() }));
const jobQueueMock = vi.hoisted(() => ({ addNotificationJob: vi.fn(() => Promise.resolve()) }));
const configMock = vi.hoisted(() => ({ getBackendMode: vi.fn(), get: vi.fn() }));
const blocklistMock = vi.hoisted(() => ({ addAutoBlock: vi.fn() }));
const stored = vi.hoisted(() => ({ values: new Map<string, string>() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/utils/file-organizer', () => ({ getFileOrganizer: () => organizerMock }));
vi.mock('@/lib/services/library', () => ({ getLibraryService: () => ({ triggerLibraryScan: vi.fn() }) }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/services/blocklist.service', () => blocklistMock);
vi.mock('@/lib/integrations/audible.service', () => ({ getAudibleService: () => ({ getAudiobookDetails: vi.fn(async () => null) }) }));
vi.mock('@/lib/utils/format-coercion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/format-coercion')>()),
  coerceToPlexCompatible: vi.fn(async () => ({ renamed: [], warnings: [], errors: [], finalAudioFiles: [] })),
}));

const ok = (extra: Record<string, unknown> = {}) => ({
  success: true,
  targetPath: '/media/Author/Book',
  filesMovedCount: 1,
  errors: [],
  audioFiles: ['/media/Author/Book/Book.m4b'],
  records: [{ source: '/downloads/book/Book.m4b', target: '/media/Author/Book/Book.m4b', status: 'copied', verified: true }],
  inventory: { kind: 'audio', files: ['/downloads/book/Book.m4b'], complete: true },
  ...extra,
});

const placementArg = () => organizerMock.organize.mock.calls[0][6] as Record<string, unknown>;
const requestWrites = () => prismaMock.request.update.mock.calls.map((c: unknown[]) => (c[0] as { data: Record<string, unknown> }).data);

async function run(payload: Record<string, unknown> = {}) {
  const { processOrganizeFiles } = await import('@/lib/processors/organize-files.processor');
  return processOrganizeFiles({ requestId: 'req-1', audiobookId: 'a1', downloadPath: '/downloads/book', jobId: 'job-1', downloadHistoryId: 'dh-1', ...payload } as any);
}

describe('processOrganizeFiles: File placement and metadata.opf', () => {
  beforeAll(async () => {
    await import('@/lib/processors/organize-files.processor');
  }, 60000);

  beforeEach(() => {
    vi.clearAllMocks();
    stored.values.clear();
    prismaMock.request.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.request.findUnique.mockResolvedValue({
      id: 'req-1', type: 'audiobook', userId: 'u1', user: { plexUsername: 'tester' },
      audiobook: { title: 'Book', author: 'Author' },
    });
    prismaMock.request.findFirst.mockResolvedValue({ importAttempts: 0, maxImportRetries: 3 });
    prismaMock.audiobook.findUnique.mockResolvedValue({ id: 'a1', title: 'Book', author: 'Author', narrator: 'N', year: 2020, series: 'S', coverArtUrl: null, audibleAsin: null });
    prismaMock.audiobook.update.mockResolvedValue({});
    prismaMock.configuration.findUnique.mockImplementation(async ({ where: { key } }: { where: { key: string } }) => {
      const value = stored.values.get(key);
      return value === undefined ? null : { key, value };
    });
    prismaMock.configuration.upsert.mockResolvedValue({});
    prismaMock.configuration.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.downloadHistory.findFirst.mockResolvedValue(null);
    configMock.getBackendMode.mockResolvedValue('audiobookshelf');
    configMock.get.mockResolvedValue(null);
  });

  it('absent settings are today\'s behaviour: copy, tags per the tagging key, no OPF, no backend read', async () => {
    stored.values.set('metadata_tagging_enabled', 'true');
    organizerMock.organize.mockResolvedValue(ok());
    await run();
    expect(placementArg()).toMatchObject({ metadataTaggingEnabled: true, filePlacement: 'copy', writeOpf: false });
  });

  it('passes the effective settings: a hard link with OPF links untagged and writes the OPF', async () => {
    stored.values.set('audiobook_file_placement', 'hardlink');
    stored.values.set('metadata_opf_enabled', 'true');
    organizerMock.organize.mockResolvedValue(ok({ linkedCount: 1 }));
    await run();
    expect(placementArg()).toMatchObject({ metadataTaggingEnabled: false, filePlacement: 'hardlink', writeOpf: true });
    // A linked book clears the Paths page's copy-fallback line
    expect(prismaMock.configuration.deleteMany).toHaveBeenCalledWith({ where: { key: 'audiobook_link_fallback_last' } });
  });

  it('a stored hard link with Tags imports linked without tags', async () => {
    stored.values.set('audiobook_file_placement', 'hardlink_only');
    stored.values.set('metadata_tagging_enabled', 'true');
    stored.values.set('metadata_opf_enabled', 'true');
    organizerMock.organize.mockResolvedValue(ok());
    await run();
    expect(placementArg()).toMatchObject({ metadataTaggingEnabled: false, filePlacement: 'hardlink_only', writeOpf: false });
  });

  it('Plex mode copies and never writes an OPF, whatever is stored', async () => {
    configMock.getBackendMode.mockResolvedValue('plex');
    stored.values.set('audiobook_file_placement', 'hardlink');
    stored.values.set('metadata_opf_enabled', 'true');
    organizerMock.organize.mockResolvedValue(ok());
    await run();
    expect(placementArg()).toMatchObject({ filePlacement: 'copy', writeOpf: false });
  });

  it('Hard link only refused: warn with Retry, one notification, no retry count, no auto-block, not thrown', async () => {
    stored.values.set('audiobook_file_placement', 'hardlink_only');
    stored.values.set('metadata_opf_enabled', 'true');
    organizerMock.organize.mockResolvedValue({
      success: false, targetPath: '/media/Author/Book', filesMovedCount: 0, errors: ['Hard link not possible'], audioFiles: [], records: [],
      linkRefused: { code: 'EPERM', words: 'not permitted: the filesystem has no hard links, or the files belong to another user' },
    });

    const result = await run();

    expect(result.success).toBe(false);
    const writes = requestWrites();
    expect(writes).toHaveLength(1);
    expect(writes[0].status).toBe('warn');
    expect(writes[0].errorMessage).toBe(
      'Not imported: hard link not possible (not permitted: the filesystem has no hard links, or the files belong to another user, EPERM). ' +
        'Nothing was copied. Fix the mounts, or set File placement to Hard link (copy if not possible), then retry.'
    );
    expect(writes[0].importAttempts).toBeUndefined();
    expect(jobQueueMock.addNotificationJob).toHaveBeenCalledTimes(1);
    expect(blocklistMock.addAutoBlock).not.toHaveBeenCalled();
    expect(prismaMock.audiobook.update).not.toHaveBeenCalled();
  });

  it('Hard link only refused on a manual import fails it with the import message', async () => {
    organizerMock.organize.mockResolvedValue({
      success: false, targetPath: '/media/Author/Book', filesMovedCount: 0,
      errors: ['Hard link not possible (the download and library folders are separate mounts (EXDEV)); nothing was imported'],
      audioFiles: [], records: [], linkRefused: { code: 'EXDEV', words: 'the download and library folders are separate mounts' },
    });

    const result = await run({ downloadHistoryId: undefined, cleanupSource: false, downloadPath: '/imports/book' });

    expect(result.success).toBe(false);
    expect(requestWrites()[0]).toMatchObject({ status: 'failed' });
    expect(String(requestWrites()[0].errorMessage)).toMatch(/^Import from \/imports\/book did not complete: Hard link not possible/);
    expect(blocklistMock.addAutoBlock).not.toHaveBeenCalled();
  });

  it('a copy fallback says so on the request and keeps the Paths page line', async () => {
    stored.values.set('audiobook_file_placement', 'hardlink');
    organizerMock.organize.mockResolvedValue(ok({ linkFallback: { code: 'EXDEV', words: 'the download and library folders are separate mounts' } }));

    await run();

    const downloaded = requestWrites().find((d) => d.status === 'downloaded')!;
    expect(downloaded.errorMessage).toBe('copied, not hard-linked (the download and library folders are separate mounts (EXDEV))');
    const upsert = prismaMock.configuration.upsert.mock.calls.find((c: unknown[]) => (c[0] as { where: { key: string } }).where.key === 'audiobook_link_fallback_last');
    expect(upsert).toBeDefined();
    expect(JSON.parse((upsert![0] as { update: { value: string } }).update.value)).toMatchObject({
      title: 'Book', reason: 'the download and library folders are separate mounts (EXDEV)',
    });
  });
});
