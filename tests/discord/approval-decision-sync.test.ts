/**
 * Component: Discord sync on approve/deny
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Regression cover for the gap found in manual testing: the Web UI's Deny button goes through
 * processRequestApproval, not deleteRequest, so hooking Discord into deletion alone left the
 * approval embed live with working buttons and never DMed the requester. These tests drive the
 * shared service and the real web route, rather than the Discord handler, so a surface that skips
 * the sync fails here.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const jobQueueMock = vi.hoisted(() => ({
  addSearchJob: vi.fn(() => Promise.resolve()),
  addSearchEbookJob: vi.fn(() => Promise.resolve()),
  addDownloadJob: vi.fn(() => Promise.resolve()),
  addStartDirectDownloadJob: vi.fn(() => Promise.resolve()),
  addNotificationJob: vi.fn(() => Promise.resolve()),
}));
const botMock = vi.hoisted(() => ({ getClient: vi.fn<() => unknown>(() => ({})) }));
const cardsMock = vi.hoisted(() => ({
  applyDecisionToApprovalMessage: vi.fn(() => Promise.resolve()),
  editRequestCards: vi.fn(() => Promise.resolve()),
  notifyRequesterOfDecision: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/services/discord/discord-bot.service', () => ({
  getDiscordBotService: () => botMock,
}));
vi.mock('@/lib/services/discord/discord-cards', () => cardsMock);
vi.mock('@/lib/middleware/auth', () => ({
  // requireAdmin invokes its handler with no args, matching the real middleware.
  requireAuth: (_req: any, handler: any) =>
    handler({ user: { id: 'admin-1', sub: 'admin-1', role: 'admin' } }),
  requireAdmin: (_req: any, handler: any) => handler(),
}));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: {
    create: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

const baseRequest = {
  id: 'req-1',
  userId: 'user-1',
  type: 'audiobook',
  status: 'awaiting_approval',
  selectedTorrent: null,
  audiobook: { id: 'ab-1', title: 'Dungeon Crawler Carl', author: 'Dinniman', audibleAsin: 'B09' },
  user: { id: 'user-1', plexUsername: 'guggs' },
};

const loadService = () => import('@/lib/services/request-approval.service');

describe('Discord sync on approve/deny', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    botMock.getClient.mockReturnValue({});
    prismaMock.request.findFirst.mockResolvedValue(baseRequest);
    prismaMock.request.updateMany.mockResolvedValue({ count: 1 });
    // The deciding admin has no linked Discord account (matches a Web UI admin).
    prismaMock.user.findUnique.mockResolvedValue({ discordUserId: null });
  });

  it('rewrites the approval embed, refreshes cards and DMs the requester on deny', async () => {
    const { processRequestApproval } = await loadService();

    await processRequestApproval({ requestId: 'req-1', action: 'deny', adminUserId: 'admin-1' });

    expect(cardsMock.applyDecisionToApprovalMessage).toHaveBeenCalledWith('req-1', 'deny', null);
    expect(cardsMock.editRequestCards).toHaveBeenCalledWith('req-1');
    expect(cardsMock.notifyRequesterOfDecision).toHaveBeenCalledWith('req-1', 'deny');
  });

  it('does the same on approve', async () => {
    const { processRequestApproval } = await loadService();

    await processRequestApproval({ requestId: 'req-1', action: 'approve', adminUserId: 'admin-1' });

    expect(cardsMock.applyDecisionToApprovalMessage).toHaveBeenCalledWith('req-1', 'approve', null);
    expect(cardsMock.editRequestCards).toHaveBeenCalledWith('req-1');
    expect(cardsMock.notifyRequesterOfDecision).toHaveBeenCalledWith('req-1', 'approve');
  });

  it('attributes the decision to the admin when they have a linked Discord account', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ discordUserId: 'discord-admin' });
    const { processRequestApproval } = await loadService();

    await processRequestApproval({ requestId: 'req-1', action: 'deny', adminUserId: 'admin-1' });

    expect(cardsMock.applyDecisionToApprovalMessage).toHaveBeenCalledWith(
      'req-1',
      'deny',
      'discord-admin'
    );
  });

  it('uses the raw Discord id for an admin-role holder with no RMAB account', async () => {
    const { processRequestApproval } = await loadService();

    await processRequestApproval({
      requestId: 'req-1',
      action: 'deny',
      adminUserId: 'discord:99887766',
    });

    expect(cardsMock.applyDecisionToApprovalMessage).toHaveBeenCalledWith(
      'req-1',
      'deny',
      '99887766'
    );
    // No RMAB user lookup for a non-RMAB actor.
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('does no Discord work when the bot is not running', async () => {
    botMock.getClient.mockReturnValue(null);
    const { processRequestApproval } = await loadService();

    await processRequestApproval({ requestId: 'req-1', action: 'deny', adminUserId: 'admin-1' });

    expect(cardsMock.applyDecisionToApprovalMessage).not.toHaveBeenCalled();
    expect(cardsMock.notifyRequesterOfDecision).not.toHaveBeenCalled();
  });

  it('still succeeds when the Discord sync throws', async () => {
    cardsMock.applyDecisionToApprovalMessage.mockRejectedValueOnce(new Error('Discord down'));
    const { processRequestApproval } = await loadService();

    const result = await processRequestApproval({
      requestId: 'req-1',
      action: 'deny',
      adminUserId: 'admin-1',
    });

    expect(result.success).toBe(true);
  });

  it('syncs when the decision comes from the web approve route (end to end)', async () => {
    // This is the case manual testing caught: the admin dashboard Deny button posts action:'deny'
    // to this route, which never touched Discord.
    const { POST } = await import('@/app/api/admin/requests/[id]/approve/route');
    const request = { json: vi.fn().mockResolvedValue({ action: 'deny' }) };

    const response = await POST(request as any, { params: Promise.resolve({ id: 'req-1' }) });

    expect(response.status).toBe(200);
    expect(cardsMock.applyDecisionToApprovalMessage).toHaveBeenCalledWith('req-1', 'deny', null);
    expect(cardsMock.notifyRequesterOfDecision).toHaveBeenCalledWith('req-1', 'deny');
  });
});
