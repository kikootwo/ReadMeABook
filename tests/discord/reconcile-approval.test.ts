/**
 * Component: Approval Message Reconcile Tests
 * Documentation: documentation/integrations/discord-bot.md
 *
 * A click that loses a race re-renders the approval message from the request's current state.
 * Since Cancel now really cancels (status 'cancelled', row kept), a cancelled request must read as
 * cancelled there, not fall through to "approved" like every other status past awaiting_approval.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const messageMock = vi.hoisted(() => ({
  embeds: [{ title: '⏳ Pending', fields: [] }],
  edit: vi.fn(() => Promise.resolve()),
}));
const clientMock = vi.hoisted(() => ({
  channels: {
    fetch: vi.fn(async () => ({
      isTextBased: () => true,
      messages: { fetch: vi.fn(async () => messageMock) },
    })),
  },
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/discord/discord-bot.service', () => ({
  getDiscordBotService: () => ({ getClient: () => clientMock }),
}));
vi.mock('@/lib/services/discord/discord-config', () => ({ getDiscordConfig: vi.fn() }));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: {
    create: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

const approvalRef = [{ kind: 'approval', channelId: 'chan-1', messageId: 'msg-1' }];

describe('reconcileApprovalMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['cancelled', { status: 'cancelled', deletedAt: null }],
    ['soft-deleted', { status: 'awaiting_approval', deletedAt: new Date() }],
  ])('renders a %s request as cancelled, with its buttons removed', async (_label, state) => {
    prismaMock.request.findUnique
      .mockResolvedValueOnce(state)
      .mockResolvedValueOnce({ discordCards: approvalRef });
    const { reconcileApprovalMessage } = await import('@/lib/services/discord/discord-cards');

    await reconcileApprovalMessage('req-1');

    const [edit] = messageMock.edit.mock.calls[0] as any[];
    expect(edit.components).toEqual([]);
    expect(edit.embeds[0].toJSON().title).toBe('🚫 Request Cancelled');
  });
});
