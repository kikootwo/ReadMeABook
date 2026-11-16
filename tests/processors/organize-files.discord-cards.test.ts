/**
 * Component: Organize Files Processor, Discord card refresh at "downloaded"
 * Documentation: documentation/backend/services/notifications.md
 *
 * An audiobook reaching "downloaded" starts a Discord card refresh through the running-check
 * facade. With the bot running and the refresh hanging forever, the organize job still
 * finishes at once.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const organizerMock = vi.hoisted(() => ({ organize: vi.fn() }));
const jobQueueMock = vi.hoisted(() => ({ addNotificationJob: vi.fn(() => Promise.resolve()) }));
const configMock = vi.hoisted(() => ({ getBackendMode: vi.fn(), get: vi.fn() }));
const refreshMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/utils/file-organizer', () => ({ getFileOrganizer: () => organizerMock }));
vi.mock('@/lib/services/library', () => ({ getLibraryService: () => ({ triggerLibraryScan: vi.fn() }) }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/integrations/audible.service', () => ({ getAudibleService: () => ({ getAudiobookDetails: vi.fn(async () => null) }) }));
vi.mock('@/lib/services/discord/discord-bot.service', () => ({ getDiscordBotService: () => ({ getClient: () => null }) }));
vi.mock('@/lib/services/discord/cards/discord-cards', () => ({ refreshRequestCards: refreshMock }));

describe('processOrganizeFiles: Discord cards at downloaded', () => {
  beforeAll(async () => {
    await import('@/lib/processors/organize-files.processor');
  }, 60000);

  beforeEach(async () => {
    vi.clearAllMocks();
    prismaMock.request.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.request.findUnique.mockResolvedValue({ id: 'req-1', type: 'audiobook', user: { plexUsername: 'testuser' } });
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.audiobook.findUnique.mockResolvedValue({ id: 'a1', title: 'Book', author: 'Author', narrator: null, coverArtUrl: null, audibleAsin: null });
    prismaMock.audiobook.update.mockResolvedValue({});
    organizerMock.organize.mockResolvedValue({
      success: true,
      targetPath: '/media/Author/Book',
      filesMovedCount: 1,
      errors: [],
      audioFiles: ['/media/Author/Book/Book.m4b'],
    });
    configMock.getBackendMode.mockResolvedValue('plex');
    configMock.get.mockResolvedValue(null);
    refreshMock.mockImplementation(() => new Promise(() => undefined));
  });

  it('bot running, refresh hanging: the job still completes and the refresh was started', async () => {
    const { setDiscordBotRunning } = await import('@/lib/services/discord/discord-runtime');
    setDiscordBotRunning(true);
    const { processOrganizeFiles } = await import('@/lib/processors/organize-files.processor');

    const result = await processOrganizeFiles({ requestId: 'req-1', audiobookId: 'a1', downloadPath: '/downloads/book', jobId: 'job-1' });

    expect(result.success).toBe(true);
    expect(prismaMock.request.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'downloaded' }) }));
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalledWith(expect.anything(), 'req-1'));
  });

  it('bot off: no refresh is started', async () => {
    const { setDiscordBotRunning } = await import('@/lib/services/discord/discord-runtime');
    setDiscordBotRunning(false);
    const { processOrganizeFiles } = await import('@/lib/processors/organize-files.processor');

    const result = await processOrganizeFiles({ requestId: 'req-1', audiobookId: 'a1', downloadPath: '/downloads/book', jobId: 'job-1' });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(result.success).toBe(true);
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
