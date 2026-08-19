/**
 * Component: Discord approval handler notification tests
 * Documentation: documentation/integrations/discord-bot.md
 *
 * The requester must hear about the decision either way. With request cards disabled a deny was
 * previously silent for them, since only approve sent a DM.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const processRequestApproval = vi.hoisted(() => vi.fn());
const resolveRmabUser = vi.hoisted(() => vi.fn());
const editRequestCards = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/request-approval.service', () => ({ processRequestApproval }));
vi.mock('@/lib/services/request-delete.service', () => ({ deleteRequest: vi.fn() }));
vi.mock('@/lib/services/discord/discord-user.resolver', () => ({ resolveRmabUser }));
vi.mock('@/lib/services/discord/discord-cards', () => ({
  editRequestCards,
  recordApprovalMessage: vi.fn(),
}));
vi.mock('@/lib/services/discord/discord-config', () => ({
  getDiscordConfig: vi.fn(() => Promise.resolve({ adminRoleId: null })),
  getApprovalChannelId: vi.fn(),
}));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: {
    create: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

/** The DM target; `send` is what we assert on. */
const dmUser = { send: vi.fn(() => Promise.resolve()) };

const buildInteraction = () => ({
  user: { id: 'discord-admin', username: 'admin' },
  member: null,
  client: { users: { fetch: vi.fn(() => Promise.resolve(dmUser)) } },
  message: { embeds: [], edit: vi.fn(() => Promise.resolve()) },
  reply: vi.fn(() => Promise.resolve()),
  deferUpdate: vi.fn(() => Promise.resolve()),
  followUp: vi.fn(() => Promise.resolve()),
});

describe('handleApprovalButton requester DM', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Authorized as an RMAB admin.
    resolveRmabUser.mockResolvedValue({ user: { id: 'admin-1' }, isAdmin: true });
    processRequestApproval.mockResolvedValue({ success: true, message: 'ok', request: {} });
    prismaMock.request.findUnique.mockResolvedValue({
      audiobook: { title: 'The Hobbit' },
      user: { discordUserId: 'discord-requester' },
    });
  });

  it('DMs the requester when a request is denied', async () => {
    const interaction = buildInteraction();
    const { handleApprovalButton } = await import(
      '@/lib/services/discord/handlers/approval.handler'
    );

    await handleApprovalButton(interaction as any, 'deny', 'req-1');

    expect(interaction.client.users.fetch).toHaveBeenCalledWith('discord-requester');
    expect(dmUser.send).toHaveBeenCalledTimes(1);
    const embed = dmUser.send.mock.calls[0][0].embeds[0];
    expect(JSON.stringify(embed)).toContain('denied');
  });

  it('DMs the requester when a request is approved', async () => {
    const interaction = buildInteraction();
    const { handleApprovalButton } = await import(
      '@/lib/services/discord/handlers/approval.handler'
    );

    await handleApprovalButton(interaction as any, 'approve', 'req-1');

    expect(dmUser.send).toHaveBeenCalledTimes(1);
    const embed = dmUser.send.mock.calls[0][0].embeds[0];
    expect(JSON.stringify(embed)).toContain('approved');
  });

  it('stays quiet when the requester has no linked Discord account', async () => {
    prismaMock.request.findUnique.mockResolvedValue({
      audiobook: { title: 'The Hobbit' },
      user: { discordUserId: null },
    });
    const interaction = buildInteraction();
    const { handleApprovalButton } = await import(
      '@/lib/services/discord/handlers/approval.handler'
    );

    await handleApprovalButton(interaction as any, 'deny', 'req-1');

    expect(dmUser.send).not.toHaveBeenCalled();
  });

  it('does not DM when the decision could not be applied', async () => {
    processRequestApproval.mockResolvedValue({
      success: false,
      reason: 'invalid_status',
      message: 'stale',
    });
    const interaction = buildInteraction();
    const { handleApprovalButton } = await import(
      '@/lib/services/discord/handlers/approval.handler'
    );

    await handleApprovalButton(interaction as any, 'deny', 'req-1');

    expect(dmUser.send).not.toHaveBeenCalled();
  });
});
