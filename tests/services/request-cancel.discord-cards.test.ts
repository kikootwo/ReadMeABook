/**
 * Component: Request Cancel Service Tests (Discord cards)
 * Documentation: documentation/admin-features/request-cancel.md
 *
 * A cancel that flips the status refreshes the request's Discord cards once, in the background,
 * right after the flip. A cancel that changes nothing refreshes nothing. With the bot off no
 * Discord module loads; a failing or hanging Discord update never fails or delays the cancel.
 * The notification job does not refresh the cards a second time for a cancel.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const jobQueueMock = vi.hoisted(() => ({ addNotificationJob: vi.fn() }));
const stepMock = vi.hoisted(() => ({ handleCancelledDownload: vi.fn(), newestSelectedRow: vi.fn() }));
const discord = vi.hoisted(() => ({ botLoads: 0, refresh: vi.fn() }));
const notificationService = vi.hoisted(() => ({ sendNotification: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/services/cancelled-download', () => stepMock);
vi.mock('@/lib/services/notification', () => ({ getNotificationService: () => notificationService }));
vi.mock('@/lib/services/discord/discord-bot.service', () => {
  discord.botLoads++;
  return { getDiscordBotService: () => ({ getClient: () => null }) };
});
vi.mock('@/lib/services/discord/cards/discord-cards', () => ({ refreshRequestCards: discord.refresh }));
vi.mock('@/lib/utils/logger', () => {
  const log = () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() });
  return { RMABLogger: { create: log, forJob: log } };
});

const record = (status = 'downloading') => ({
  id: 'req-1', status, audiobookId: 'ab-1', type: 'audiobook',
  audiobook: { title: 'Book', author: 'Author' }, user: { plexUsername: 'reader' },
});

async function cancel(rec = record()) {
  const { cancelLoadedRequest } = await import('@/lib/services/request-cancel.service');
  return cancelLoadedRequest(rec, { audience: 'owner' });
}

async function botRunning(running: boolean) {
  const { setDiscordBotRunning } = await import('@/lib/services/discord/discord-runtime');
  setDiscordBotRunning(running);
}

beforeEach(() => {
  vi.clearAllMocks();
  jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
  stepMock.newestSelectedRow.mockResolvedValue(null);
  stepMock.handleCancelledDownload.mockResolvedValue({ outcome: 'none', detail: 'no download' });
  prismaMock.request.updateMany.mockResolvedValue({ count: 1 });
  discord.refresh.mockResolvedValue(null);
});

afterEach(async () => {
  await botRunning(false);
});

describe('cancel: Discord cards', () => {
  // Runs first: nothing earlier in this file starts the bot
  it('the bot off: the cancel loads no Discord module and starts no refresh; the same cancel with the bot on refreshes', async () => {
    expect((await cancel()).success).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(discord.botLoads).toBe(0);
    expect(discord.refresh).not.toHaveBeenCalled();

    // Control: the hook is there, gated on the bot only
    await botRunning(true);
    expect((await cancel()).success).toBe(true);
    await vi.waitFor(() => expect(discord.refresh).toHaveBeenCalledTimes(1));
  });

  it('the bot running: one refresh, started right after the flip and before the download step', async () => {
    await botRunning(true);
    const order: string[] = [];
    prismaMock.request.updateMany.mockImplementation(async () => {
      order.push('flip');
      return { count: 1 };
    });
    stepMock.handleCancelledDownload.mockImplementation(async () => {
      order.push('download step');
      return { outcome: 'none', detail: '' };
    });
    discord.refresh.mockImplementation(async () => {
      order.push('refresh');
      return null;
    });

    expect((await cancel()).success).toBe(true);
    await vi.waitFor(() => expect(discord.refresh).toHaveBeenCalledTimes(1));
    expect(discord.refresh.mock.calls[0][1]).toBe('req-1');
    expect(order.indexOf('flip')).toBeLessThan(order.indexOf('refresh'));
  });

  it.each([
    ['a status that moved on meanwhile', () => {
      prismaMock.request.updateMany.mockResolvedValue({ count: 0 });
      prismaMock.request.findFirst.mockResolvedValue({ status: 'processing' });
      return record();
    }],
    ['a status that cannot be cancelled', () => record('available')],
    ['a request already cancelled', () => {
      prismaMock.request.findFirst.mockResolvedValue({ cancelledAt: new Date() });
      return record('cancelled');
    }],
  ])('%s: no refresh (only the cancel that flipped refreshed)', async (_label, arrange) => {
    await botRunning(true);
    expect((await cancel()).success).toBe(true);
    await vi.waitFor(() => expect(discord.refresh).toHaveBeenCalledTimes(1));

    await cancel(arrange());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(discord.refresh).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['rejects', () => Promise.reject(new Error('Discord API 50013'))],
    ['never settles', () => new Promise(() => undefined)],
  ])('the Discord update %s: the cancel still succeeds', async (_label, impl) => {
    await botRunning(true);
    discord.refresh.mockImplementation(impl);
    expect(await cancel()).toMatchObject({ success: true, request: { status: 'cancelled' } });
    await vi.waitFor(() => expect(discord.refresh).toHaveBeenCalledTimes(1));
  });

  it('the cancel notification does not refresh the cards a second time; other notifications do', async () => {
    await botRunning(true);
    notificationService.sendNotification.mockResolvedValue(undefined);
    const { processSendNotification } = await import('@/lib/processors/send-notification.processor');

    await processSendNotification({ event: 'request_cancelled', requestId: 'req-1', title: 'T', author: 'A', userName: 'u' } as never);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(discord.refresh).not.toHaveBeenCalled();

    await processSendNotification({ event: 'request_available', requestId: 'req-1', title: 'T', author: 'A', userName: 'u' } as never);
    await vi.waitFor(() => expect(discord.refresh).toHaveBeenCalledTimes(1));
  });
});
