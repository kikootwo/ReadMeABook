/**
 * Component: Request Cancel Service Tests
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * cancelRequest() is the path behind the Web UI cancel, the Discord card's Cancel button and the
 * /status cancel menu. Cancelling must only stop the request: status → 'cancelled', no files,
 * library items or downloads removed. It must also converge the Discord surfaces from any caller.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@/generated/prisma/client';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const jobQueueMock = vi.hoisted(() => ({ addNotificationJob: vi.fn(() => Promise.resolve()) }));
const botMock = vi.hoisted(() => ({ getClient: vi.fn<() => unknown>(() => ({})) }));
const cardsMock = vi.hoisted(() => ({
  editRequestCards: vi.fn(() => Promise.resolve()),
  cancelApprovalMessage: vi.fn(() => Promise.resolve()),
}));
const deleteRequestMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/services/discord/discord-bot.service', () => ({ getDiscordBotService: () => botMock }));
vi.mock('@/lib/services/discord/discord-cards', () => cardsMock);
vi.mock('@/lib/services/request-delete.service', () => ({ deleteRequest: deleteRequestMock }));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: {
    create: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

const liveRequest = (status: string) => ({
  id: 'req-1',
  userId: 'user-1',
  status,
  audiobook: { id: 'ab-1', title: 'Red Rising', author: 'Pierce Brown' },
  user: { plexUsername: 'reader' },
});

const loadService = () => import('@/lib/services/request-cancel.service');

describe('cancelRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    botMock.getClient.mockReturnValue({});
    prismaMock.request.update.mockImplementation(async ({ where }: any) => ({
      id: where.id,
      status: 'cancelled',
      audiobook: { title: 'Red Rising', author: 'Pierce Brown' },
    }));
    prismaMock.user.findUnique.mockResolvedValue({ discordUserId: 'discord-linked' });
  });

  it('only sets the status to cancelled and never deletes anything', async () => {
    prismaMock.request.findFirst.mockResolvedValue(liveRequest('downloading'));
    const { cancelRequest } = await loadService();

    const result = await cancelRequest('req-1', { userId: 'user-1' });

    expect(result.success).toBe(true);
    const { data } = prismaMock.request.update.mock.calls[0][0];
    expect(data.status).toBe('cancelled');
    expect(data).not.toHaveProperty('deletedAt');
    expect(deleteRequestMock).not.toHaveBeenCalled();
    expect(jobQueueMock.addNotificationJob).toHaveBeenCalledWith(
      'request_cancelled',
      'req-1',
      'Red Rising',
      'Pierce Brown',
      'reader'
    );
  });

  it('renders the Discord card cancelled without touching an approval message it does not have', async () => {
    prismaMock.request.findFirst.mockResolvedValue(liveRequest('searching'));
    const { cancelRequest } = await loadService();

    await cancelRequest('req-1', { userId: 'user-1' });

    expect(cardsMock.editRequestCards).toHaveBeenCalledWith('req-1', 'cancelled');
    expect(cardsMock.cancelApprovalMessage).not.toHaveBeenCalled();
  });

  it('clears the pick and retracts the approval message when cancelled while awaiting approval', async () => {
    prismaMock.request.findFirst.mockResolvedValue(liveRequest('awaiting_approval'));
    const { cancelRequest } = await loadService();

    await cancelRequest('req-1', { userId: 'user-1', discordUserId: 'discord-actor' });

    expect(prismaMock.request.update.mock.calls[0][0].data.selectedTorrent).toBe(Prisma.DbNull);
    // The Discord actor from the interaction wins over the user's linked account.
    expect(cardsMock.cancelApprovalMessage).toHaveBeenCalledWith('req-1', 'discord-actor');
  });

  it('attributes a Web UI cancel to the user\'s linked Discord account', async () => {
    prismaMock.request.findFirst.mockResolvedValue(liveRequest('awaiting_approval'));
    const { cancelRequest } = await loadService();

    await cancelRequest('req-1', { userId: 'user-1' });

    expect(cardsMock.cancelApprovalMessage).toHaveBeenCalledWith('req-1', 'discord-linked');
  });

  it('refuses statuses the server does not cancel (an import already under way)', async () => {
    prismaMock.request.findFirst.mockResolvedValue(liveRequest('processing'));
    const { cancelRequest } = await loadService();

    const result = await cancelRequest('req-1', { userId: 'user-1' });

    expect(result).toEqual({
      success: false,
      reason: 'not_cancellable',
      message: 'Cannot cancel request with status: processing',
    });
    expect(prismaMock.request.update).not.toHaveBeenCalled();
  });

  it('reports a missing or deleted request', async () => {
    prismaMock.request.findFirst.mockResolvedValue(null);
    const { cancelRequest } = await loadService();

    const result = await cancelRequest('gone', { userId: 'user-1' });

    expect(result).toMatchObject({ success: false, reason: 'not_found' });
    expect(prismaMock.request.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'gone', deletedAt: null } })
    );
  });

  it('still cancels when the bot is not running', async () => {
    botMock.getClient.mockReturnValue(null);
    prismaMock.request.findFirst.mockResolvedValue(liveRequest('pending'));
    const { cancelRequest } = await loadService();

    const result = await cancelRequest('req-1', { userId: 'user-1' });

    expect(result.success).toBe(true);
    expect(cardsMock.editRequestCards).not.toHaveBeenCalled();
  });
});
