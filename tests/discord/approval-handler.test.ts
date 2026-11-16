/**
 * Component: Discord Approve / Deny Button Tests
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Who may decide from Discord: only a Discord user linked to an approved, live RMAB account
 * whose database role is admin, checked on every click. Holding the admin role in Discord
 * grants nothing. Replies are fixed texts; a stale click shows the current status.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DISCORD_USER, GUILD, fakeStep, lastText } from './discord-request-fakes';

const ADMIN_ROLE = '666666666666666666';
const ID = '0b6f2c1e-4d6a-4c1e-9a8b-1f2e3d4c5b6a';

const userLookup = vi.hoisted(() => vi.fn());
const decideMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ prisma: { user: { findUnique: userLookup } } }));
vi.mock('@/lib/services/request-approval.service', () => ({ decideRequestApproval: decideMock }));
vi.mock('@/lib/services/discord/discord-runtime', () => ({ refreshDiscordRequestCards: refreshMock }));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

type Account = { id: string; plexUsername: string; role: string; registrationStatus: string; deletedAt: Date | null };
const account = (overrides: Partial<Account> = {}): Account => ({
  id: 'admin-1', plexUsername: 'boss', role: 'admin', registrationStatus: 'approved', deletedAt: null, ...overrides,
});

async function click(action: 'approve' | 'deny', opts: { guildId?: string | null; customId?: string; order?: string[] } = {}) {
  const { encodeApprovalCustomId } = await import('@/lib/services/discord/discord-custom-id');
  const { handleApprovalComponent } = await import('@/lib/services/discord/approval/discord-approval-handler');
  const step = fakeStep('button', {
    guildId: opts.guildId,
    customId: opts.customId ?? encodeApprovalCustomId(action, ID),
    // The clicker holds the Discord admin role in every case: it must never matter
    member: { roles: [ADMIN_ROLE] },
    order: opts.order,
  });
  await handleApprovalComponent(step as never);
  return step;
}

describe('Approve / Deny buttons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userLookup.mockResolvedValue(account());
    decideMock.mockResolvedValue({ ok: true, action: 'approve', status: 'pending', isEbook: false, pickSource: null, droppedPickReason: null, releaseDate: null, request: null });
  });

  it('a linked RMAB admin approves: deferred first, then the shared service as that account', async () => {
    const order: string[] = [];
    userLookup.mockImplementation(async () => {
      order.push('db');
      return account();
    });
    const step = await click('approve', { order });

    expect(order.slice(0, 2)).toEqual(['deferReply', 'db']);
    expect(step.deferReply).toHaveBeenCalledWith({ flags: 64 });
    expect(userLookup).toHaveBeenCalledWith(expect.objectContaining({ where: { discordUserId: DISCORD_USER } }));
    expect(decideMock).toHaveBeenCalledWith({ requestId: ID, action: 'approve', adminId: 'admin-1', via: 'discord' });
    expect(lastText(step)).toBe('Approved. The search has started.');
    expect(step.editReply.mock.calls.at(-1)![0]).toMatchObject({ allowedMentions: { parse: [] } });
  });

  it('a linked RMAB admin denies', async () => {
    decideMock.mockResolvedValue({ ok: true, action: 'deny', request: null });
    const step = await click('deny');
    expect(decideMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'deny' }));
    expect(lastText(step)).toBe('Denied.');
  });

  it.each([
    ['an unlinked member holding the admin role', null, 'Your Discord account is not linked to an RMAB account. Ask an RMAB admin to link it.'],
    ['a linked non-admin', account({ id: 'user-1', role: 'user' }), 'Only RMAB admins can approve or deny requests.'],
    ['a linked admin since demoted to user', account({ role: 'user' }), 'Only RMAB admins can approve or deny requests.'],
    ['a linked admin set to pending approval', account({ registrationStatus: 'pending_approval' }), 'Your Discord account is not linked to an RMAB account. Ask an RMAB admin to link it.'],
    ['a linked admin who was rejected', account({ registrationStatus: 'rejected' }), 'Your Discord account is not linked to an RMAB account. Ask an RMAB admin to link it.'],
    ['a linked admin whose account was deleted', account({ deletedAt: new Date() }), 'Your Discord account is not linked to an RMAB account. Ask an RMAB admin to link it.'],
  ])('%s is refused and nothing is decided', async (_label, linked, text) => {
    userLookup.mockResolvedValue(linked);
    const step = await click('approve');

    expect(decideMock).not.toHaveBeenCalled();
    expect(lastText(step)).toBe(text);
  });

  it('authority is read on every click: an admin demoted between two clicks is refused on the second', async () => {
    await click('approve');
    userLookup.mockResolvedValue(account({ role: 'user' }));
    const second = await click('approve');

    expect(decideMock).toHaveBeenCalledTimes(1);
    expect(userLookup).toHaveBeenCalledTimes(2);
    expect(lastText(second)).toBe('Only RMAB admins can approve or deny requests.');
  });

  it('a stale click (decided or completed elsewhere) shows the current status and refreshes the message', async () => {
    decideMock.mockResolvedValue({ ok: false, code: 'invalid_status', currentStatus: 'available' });
    const step = await click('approve');

    expect(lastText(step)).toBe('This request is no longer waiting for approval. Status: Available.');
    expect(refreshMock).toHaveBeenCalledWith(ID);
  });

  it('a click on a removed request says so and refreshes the message', async () => {
    decideMock.mockResolvedValue({ ok: false, code: 'not_found' });
    const step = await click('deny');
    expect(lastText(step)).toBe('This request no longer exists.');
    expect(refreshMock).toHaveBeenCalledWith(ID);
  });

  it('replies are fixed texts: a pick message or a thrown error is never shown', async () => {
    decideMock.mockResolvedValue({ ok: false, code: 'pick_rejected', message: 'The admin-selected release cannot be used: /secret/path' });
    expect(lastText(await click('approve'))).toBe('Something went wrong. Try again in a moment.');

    decideMock.mockRejectedValue(new Error('connect ECONNREFUSED /var/run/postgres'));
    const step = await click('approve');
    expect(lastText(step)).toBe('Something went wrong. Try again in a moment.');
    expect(JSON.stringify(step.editReply.mock.calls)).not.toContain('ECONNREFUSED');
  });

  it.each([
    ['a stored pick that could not be used', { droppedPickReason: 'link expired', status: 'pending' }, 'Approved. The stored release could not be used, so the search has started instead.'],
    ['a stored pick downloading', { pickSource: 'user', status: 'downloading' }, 'Approved. The download has started.'],
    ['an unreleased book', { status: 'awaiting_release' }, 'Approved. It will be searched on its release date.'],
  ])('approval text for %s', async (_label, fields, text) => {
    decideMock.mockResolvedValue({ ok: true, action: 'approve', isEbook: false, pickSource: null, droppedPickReason: null, releaseDate: null, request: null, ...fields });
    expect(lastText(await click('approve'))).toBe(text);
  });

  it('the source being unreachable says nothing changed', async () => {
    decideMock.mockResolvedValue({ ok: false, code: 'source_unavailable', error: "Couldn't reach Anna's Archive" });
    expect(lastText(await click('approve'))).toBe('The release source could not be reached. Nothing was changed; try again in a moment.');
  });

  it('a click from a DM, or with a forged or unknown custom id, is ignored without a reply or a read', async () => {
    const dm = await click('approve', { guildId: null });
    const forged = await click('approve', { customId: `rmab:apr:a:${ID}:short` });
    const notUuid = await click('approve', { customId: 'rmab:apr:a:../../admin:abcdefghij' });
    const extra = await click('approve', { customId: `rmab:apr:a:${ID}:abcdefghij:admin` });

    for (const step of [dm, forged, notUuid, extra]) {
      expect(step.deferReply).not.toHaveBeenCalled();
      expect(step.editReply).not.toHaveBeenCalled();
    }
    expect(userLookup).not.toHaveBeenCalled();
    expect(decideMock).not.toHaveBeenCalled();
    expect(GUILD).toBeTruthy();
  });
});
