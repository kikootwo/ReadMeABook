/**
 * Component: Discord Cancel/Delete Handler Tests
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Non-admins may cancel their own requests from Discord but never delete: the card's Cancel button
 * and the /status menu go through cancelRequest (nothing removed), and /delete is for linked RMAB
 * admins only, re-checked on every click since customIds are untrusted.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const cancelRequestMock = vi.hoisted(() => vi.fn());
const deleteRequestMock = vi.hoisted(() => vi.fn());
const resolveRmabUserMock = vi.hoisted(() => vi.fn());
const helpersMock = vi.hoisted(() => ({
  actorMeta: vi.fn(() => ({})),
  fetchOutstandingRequests: vi.fn(async () => []),
  fetchDeletableRequests: vi.fn(async () => []),
  fetchDeletePreviewItem: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/request-cancel.service', () => ({ cancelRequest: cancelRequestMock }));
vi.mock('@/lib/services/request-delete.service', () => ({ deleteRequest: deleteRequestMock }));
vi.mock('@/lib/services/request-approval.service', () => ({ processRequestApproval: vi.fn() }));
vi.mock('@/lib/services/discord/discord-user.resolver', () => ({ resolveRmabUser: resolveRmabUserMock }));
vi.mock('@/lib/services/discord/discord-config', () => ({
  getDiscordConfig: vi.fn(async () => ({ adminRoleId: null })),
  getApprovalChannelId: vi.fn(),
}));
vi.mock('@/lib/services/discord/discord-cards', () => ({
  editRequestCards: vi.fn(() => Promise.resolve()),
  recordApprovalMessage: vi.fn(),
  reconcileApprovalMessage: vi.fn(),
}));
vi.mock('@/lib/services/discord/discord-helpers', () => helpersMock);
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: {
    create: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

const owner = { user: { id: 'user-1' }, isAdmin: false };
const otherUser = { user: { id: 'user-2' }, isAdmin: false };
const admin = { user: { id: 'admin-1' }, isAdmin: true };

function interaction(extra: Record<string, unknown> = {}) {
  return {
    user: { id: 'discord-1', username: 'reader' },
    deferUpdate: vi.fn(),
    deferReply: vi.fn(),
    editReply: vi.fn(),
    followUp: vi.fn(),
    inCachedGuild: () => false,
    ...extra,
  } as any;
}

/** Text of the first embed passed to an editReply/followUp call. */
const embedText = (fn: any) => JSON.stringify(fn.mock.calls[0][0].embeds[0]);

describe('Discord cancel and delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.request.findFirst.mockResolvedValue({ userId: 'user-1', status: 'downloading' });
    cancelRequestMock.mockResolvedValue({ success: true, request: {} });
    deleteRequestMock.mockResolvedValue({ success: true });
  });

  describe('request card Cancel button', () => {
    it('cancels through cancelRequest and never deletes', async () => {
      resolveRmabUserMock.mockResolvedValue(owner);
      const { handleCancelRequestButton } = await import('@/lib/services/discord/handlers/approval.handler');

      await handleCancelRequestButton(interaction(), 'req-1');

      expect(cancelRequestMock).toHaveBeenCalledWith('req-1', { userId: 'user-1', discordUserId: 'discord-1' });
      expect(deleteRequestMock).not.toHaveBeenCalled();
    });

    it('tells the user when the request can no longer be cancelled', async () => {
      resolveRmabUserMock.mockResolvedValue(owner);
      cancelRequestMock.mockResolvedValue({
        success: false,
        reason: 'not_cancellable',
        message: 'Cannot cancel request with status: processing',
      });
      const { handleCancelRequestButton } = await import('@/lib/services/discord/handlers/approval.handler');
      const i = interaction();

      await handleCancelRequestButton(i, 'req-1');

      expect(embedText(i.followUp)).toContain('Cannot cancel request with status: processing');
    });
  });

  describe('/status cancel menu', () => {
    it('cancels the user\'s own request through cancelRequest', async () => {
      resolveRmabUserMock.mockResolvedValue(owner);
      const { handleStatusCancel } = await import('@/lib/services/discord/handlers/status-delete.handler');

      await handleStatusCancel(interaction({ values: ['req-1'] }), 0, false);

      expect(cancelRequestMock).toHaveBeenCalledWith('req-1', { userId: 'user-1', discordUserId: 'discord-1' });
      expect(deleteRequestMock).not.toHaveBeenCalled();
    });

    it('blocks cancelling someone else\'s request', async () => {
      resolveRmabUserMock.mockResolvedValue(otherUser);
      const { handleStatusCancel } = await import('@/lib/services/discord/handlers/status-delete.handler');

      await handleStatusCancel(interaction({ values: ['req-1'] }), 0, false);

      expect(cancelRequestMock).not.toHaveBeenCalled();
    });
  });

  describe('/delete', () => {
    it('turns non-admins away and points them at cancelling', async () => {
      resolveRmabUserMock.mockResolvedValue(owner);
      const { handleDeleteCommand } = await import('@/lib/services/discord/handlers/status-delete.handler');
      const i = interaction();

      await handleDeleteCommand(i);

      expect(embedText(i.editReply)).toContain('Only admins can delete requests');
      expect(helpersMock.fetchDeletableRequests).not.toHaveBeenCalled();
    });

    it('refuses a stale Confirm button from a non-admin', async () => {
      resolveRmabUserMock.mockResolvedValue(owner);
      const { handleDeleteConfirm } = await import('@/lib/services/discord/handlers/status-delete.handler');

      await handleDeleteConfirm(interaction(), 'req-1');

      expect(deleteRequestMock).not.toHaveBeenCalled();
    });

    it('lets a linked RMAB admin delete any request', async () => {
      resolveRmabUserMock.mockResolvedValue(admin);
      helpersMock.fetchDeletePreviewItem.mockResolvedValue({ id: 'req-1', title: 'Red Rising' });
      const { handleDeleteConfirm } = await import('@/lib/services/discord/handlers/status-delete.handler');

      await handleDeleteConfirm(interaction(), 'req-1');

      expect(deleteRequestMock).toHaveBeenCalledWith('req-1', 'admin-1', 'discord-1');
    });
  });
});
