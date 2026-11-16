/**
 * Component: Discord Cancel Handler Tests (card button, /status menu, confirm)
 * Documentation: documentation/integrations/discord-bot.md
 *
 * A Cancel from a card or the /status menu only asks first: one ephemeral confirmation worded as
 * the web's, with Cancel request (Withdraw request while it awaits approval) and Keep request.
 * Only the confirm cancels, after resolving the clicking user, re-reading the request and checking
 * requester or RMAB admin again (database role; a Discord role grants nothing). A click on a
 * request that can no longer be cancelled brings its cards up to date. Replies are fixed texts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CANCEL_CONFIRM_AUDIOBOOK } from '@/lib/utils/cancel-confirm-text';
import { DISCORD_USER, fakeStep, lastText, type FakeStep } from './discord-request-fakes';
import { ADMIN_ROLE, ID, account, admin, cancelled, expectNoMentions, lastButtons, record } from './manage-handler-fakes';

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  request: { findFirst: vi.fn(), findMany: vi.fn() },
}));
const cancelMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/services/request-cancel.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/request-cancel.service')>()),
  cancelLoadedRequest: cancelMock,
}));
vi.mock('@/lib/services/discord/discord-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/discord/discord-runtime')>()),
  refreshDiscordRequestCards: refreshMock,
}));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

const NOT_LINKED = 'Your Discord account is not linked to an RMAB account. Ask an RMAB admin to link it.';
const ids = () => import('@/lib/services/discord/discord-custom-id');
const handler = () => import('@/lib/services/discord/manage/discord-status-handler');
// The clicker holds the Discord admin role in every case: it must never matter
const member = { roles: [ADMIN_ROLE] };

async function cardClick(opts: { guildId?: string | null } = {}) {
  const step = fakeStep('button', { customId: (await ids()).encodeRequestActionCustomId('status', ID), member, ...opts });
  await (await handler()).handleStatusComponent(step as never);
  return step;
}

async function menuChoose(values: string[] = [ID], page = 0) {
  const step = fakeStep('select', { customId: (await ids()).encodePageCustomId('status', 'menu', page), values, member });
  await (await handler()).handleStatusComponent(step as never);
  return step;
}

async function confirmClick(opts: { order?: string[]; customId?: string } = {}) {
  const step = fakeStep('button', { customId: (await ids()).encodeCancelConfirmCustomId(ID), member, ...opts });
  await (await handler()).handleStatusComponent(step as never);
  return step;
}

const payloads = (step: FakeStep) => step.editReply.mock.calls.map(([payload]) => payload as { content: string; components: unknown[] });

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUnique.mockResolvedValue(account());
  db.request.findFirst.mockResolvedValue(record());
  db.request.findMany.mockResolvedValue([]);
  cancelMock.mockResolvedValue(cancelled());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Cancel asks once', () => {
  it('a card click shows the confirmation ephemerally and cancels nothing', async () => {
    const { decodeManageCustomId } = await ids();
    const step = await cardClick();

    expect(step.deferReply).toHaveBeenCalledWith({ flags: 64 });
    expect(db.request.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: ID, deletedAt: null } }));
    expect(cancelMock).not.toHaveBeenCalled();
    expect(lastText(step)).toBe(`Cancel this request? ${CANCEL_CONFIRM_AUDIOBOOK}`);
    const [yes, keep] = lastButtons(step);
    expect([yes.label, keep.label]).toEqual(['Cancel request', 'Keep request']);
    expect(decodeManageCustomId(yes.custom_id)).toMatchObject({ area: 'status', action: 'confirm', requestId: ID });
    expect(decodeManageCustomId(keep.custom_id)).toMatchObject({ area: 'status', action: 'page', page: 0 });
    expectNoMentions(step);
  });

  it('a request awaiting approval is withdrawn, worded as on the web', async () => {
    db.request.findFirst.mockResolvedValue(record('user-1', 'awaiting_approval'));
    const own = await cardClick();
    expect(lastText(own)).toBe('This request is pending admin approval and will be withdrawn. You can request it again later.');
    expect(lastButtons(own).map((b) => b.label)).toEqual(['Withdraw request', 'Keep request']);

    db.user.findUnique.mockResolvedValue(admin());
    db.request.findFirst.mockResolvedValue(record('user-2', 'awaiting_approval'));
    const other = await cardClick();
    expect(lastText(other)).toBe('This request is pending admin approval and will be withdrawn. The user can request it again later.');
  });

  it('the /status menu shows the confirmation in place; Keep request lists that page again', async () => {
    const { decodeManageCustomId } = await ids();
    const step = await menuChoose([ID], 2);

    expect(step.deferUpdate).toHaveBeenCalledTimes(1);
    expect(cancelMock).not.toHaveBeenCalled();
    expect(lastText(step)).toMatch(/^Cancel this request\?/);
    expect(decodeManageCustomId(lastButtons(step)[1].custom_id)).toMatchObject({ action: 'page', page: 2 });
  });

  it('Keep request changes nothing: no request is read or cancelled, the page is listed', async () => {
    const { decodeManageCustomId } = await ids();
    const keepId = lastButtons(await cardClick())[1].custom_id;
    vi.clearAllMocks();
    db.user.findUnique.mockResolvedValue(account());
    db.request.findMany.mockResolvedValue([]);

    const keep = fakeStep('button', { customId: keepId, member });
    expect(decodeManageCustomId(keep.customId)).toMatchObject({ action: 'page' });
    await (await handler()).handleStatusComponent(keep as never);

    expect(cancelMock).not.toHaveBeenCalled();
    expect(db.request.findFirst).not.toHaveBeenCalled();
    expect(db.request.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { deletedAt: null, userId: 'user-1' } }));
  });

  it('the confirm cancels as the requester: buttons go first, then the outcome above the list', async () => {
    const step = await confirmClick();

    expect(step.deferUpdate).toHaveBeenCalledTimes(1);
    expect(db.request.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: ID, deletedAt: null } }));
    expect(cancelMock).toHaveBeenCalledWith(expect.objectContaining({ id: ID, status: 'downloading' }), { audience: 'owner' });
    const [first, last] = [payloads(step)[0], payloads(step).at(-1)!];
    expect(first).toMatchObject({ content: 'Cancelling…', components: [] });
    expect(last.content).toBe('Request cancelled.');
    expect(db.request.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { deletedAt: null, userId: 'user-1' } }));
    expect(refreshMock).not.toHaveBeenCalled();
    expectNoMentions(step);
  });

  it('an RMAB admin confirms a cancel of another user\'s request as the admin audience', async () => {
    db.user.findUnique.mockResolvedValue(admin());
    db.request.findFirst.mockResolvedValue(record('user-2'));
    await confirmClick();
    expect(cancelMock).toHaveBeenCalledWith(expect.objectContaining({ id: ID }), { audience: 'admin' });
  });

  it('the confirm checks again: an admin demoted after the confirmation was shown is refused', async () => {
    db.user.findUnique.mockResolvedValue(admin());
    db.request.findFirst.mockResolvedValue(record('user-2'));
    expect(lastButtons(await cardClick())[0].label).toBe('Cancel request');

    db.user.findUnique.mockResolvedValue(admin({ role: 'user' }));
    const step = await confirmClick();

    expect(cancelMock).not.toHaveBeenCalled();
    expect(lastText(step)).toBe('You can cancel only your own requests.');
  });

  it('a confirm id built for another user\'s request is refused for a non-admin', async () => {
    db.request.findFirst.mockResolvedValue(record('user-2'));
    const step = await confirmClick({ customId: `rmab:sts:y:${ID}:abcdefghij` });

    expect(db.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { discordUserId: DISCORD_USER } }));
    expect(cancelMock).not.toHaveBeenCalled();
    expect(lastText(step)).toBe('You can cancel only your own requests.');
  });

  it.each([
    ['an unlinked member holding the Discord admin role', null],
    ['a linked account pending approval', account({ registrationStatus: 'pending_approval' })],
    ['a linked account that was rejected', account({ registrationStatus: 'rejected' })],
    ['a linked account that was deleted', account({ deletedAt: new Date() })],
  ])('%s is refused at the click and the confirm; nothing is read or cancelled', async (_label, linked) => {
    db.user.findUnique.mockResolvedValue(linked);
    for (const step of [await cardClick(), await confirmClick()]) expect(lastText(step)).toBe(NOT_LINKED);
    expect(db.request.findFirst).not.toHaveBeenCalled();
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it('a second confirm press while the first runs cancels nothing more', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    cancelMock.mockImplementation(async () => {
      await gate;
      return cancelled();
    });

    const first = confirmClick();
    await vi.waitFor(() => expect(cancelMock).toHaveBeenCalledTimes(1));
    const second = confirmClick();
    const secondState = await Promise.race([second.then(() => 'returned'), new Promise((resolve) => setTimeout(() => resolve('still running'), 500))]);
    release();
    const [done, again] = await Promise.all([first, second]);

    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(secondState).toBe('returned');
    expect(again.editReply).not.toHaveBeenCalled();
    expect(lastText(done)).toBe('Request cancelled.');
  });

  it('defers before any database work, and a cancel that takes 10 s still answers', async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    db.user.findUnique.mockImplementation(async () => {
      order.push('db');
      return account();
    });
    cancelMock.mockImplementation(() => {
      order.push('cancel');
      return new Promise((resolve) => setTimeout(() => resolve(cancelled()), 10_000));
    });

    const done = confirmClick({ order });
    await vi.advanceTimersByTimeAsync(10_000);
    const step = await done;

    expect(order.slice(0, 2)).toEqual(['deferUpdate', 'db']);
    expect(lastText(step)).toBe('Request cancelled.');
  });

  it('after a cancel, a list that cannot be read still shows the outcome, never a failure', async () => {
    db.request.findMany.mockRejectedValue(new Error('database unavailable'));
    const step = await confirmClick();
    expect(payloads(step).at(-1)).toMatchObject({ content: 'Request cancelled.', embeds: [], components: [] });
  });
});

describe('Cancel outcomes and stale cards', () => {
  it.each([
    ['not cancellable', record('user-1', 'processing'), 'This request can no longer be cancelled. Status: Processing.'],
    ['already cancelled', record('user-1', 'cancelled'), 'This request was already cancelled.'],
    ['gone', null, 'This request no longer exists.'],
  ])('a card click on a request that is %s answers and brings its cards up to date', async (_label, row, text) => {
    db.request.findFirst.mockResolvedValue(row);
    const step = await cardClick();

    expect(cancelMock).not.toHaveBeenCalled();
    expect(lastText(step)).toBe(text);
    expect(refreshMock).toHaveBeenCalledExactlyOnceWith(ID);
  });

  it.each([
    ['already cancelled', cancelled({ alreadyCancelled: true }), 'This request was already cancelled.', true],
    ['not cancellable', { success: false, reason: 'not_cancellable', status: 'processing' }, 'This request can no longer be cancelled. Status: Processing.', true],
    ['gone meanwhile', { success: false, reason: 'not_found' }, 'This request no longer exists.', true],
    ['download kept (requester view)', cancelled({ download: 'kept' }), 'Request cancelled. Its download stays in the download client.', false],
    ['download removed', cancelled({ download: 'removed' }), 'Request cancelled. Its download was removed from the download client.', false],
  ])('confirm result %s maps to a fixed reply', async (_label, result, text, refreshes) => {
    cancelMock.mockResolvedValue(result);
    expect(lastText(await confirmClick())).toBe(text);
    expect(refreshMock).toHaveBeenCalledTimes(refreshes ? 1 : 0);
  });

  it('a request deleted before the confirm is not cancelled; its cards are brought up to date', async () => {
    db.request.findFirst.mockResolvedValue(null);
    const step = await confirmClick();
    expect(cancelMock).not.toHaveBeenCalled();
    expect(lastText(step)).toBe('This request no longer exists.');
    expect(refreshMock).toHaveBeenCalledWith(ID);
  });

  it('a refusal for another user\'s request does not touch the cards', async () => {
    db.request.findFirst.mockResolvedValue(record('user-2'));
    await cardClick();
    await menuChoose();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('an admin reply never shows the service message (it can name the download client)', async () => {
    db.user.findUnique.mockResolvedValue(admin());
    cancelMock.mockResolvedValue(cancelled({ download: 'kept_shared', message: 'Request cancelled. Its download stays in qBittorrent-Home: another request still uses it.' }));
    const step = await confirmClick();

    expect(lastText(step)).toBe('Request cancelled. Its download stays in the download client: another request still uses it.');
    expect(JSON.stringify(step.editReply.mock.calls)).not.toContain('qBittorrent-Home');
  });

  it('a card in a DM works the same way (the requester\'s own card)', async () => {
    expect(lastText(await cardClick({ guildId: null }))).toMatch(/^Cancel this request\?/);
  });

  it('the /status menu refuses another user\'s request for a non-admin, above the list', async () => {
    db.request.findFirst.mockResolvedValue(record('user-2'));
    const step = await menuChoose();
    expect(lastText(step)).toBe('You can cancel only your own requests.');
    expect(db.request.findMany).toHaveBeenCalled();
  });

  it('a menu value that is not a request ID reads and cancels nothing', async () => {
    const step = await menuChoose(['../../etc']);
    expect(db.request.findFirst).not.toHaveBeenCalled();
    expect(lastText(step)).toBe('That choice is no longer available. Run the command again.');
  });

  it('a failing cancel shows the generic text, never the error', async () => {
    cancelMock.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:8080 /downloads/Book'));
    const step = await confirmClick();
    expect(lastText(step)).toBe('Something went wrong. Try again in a moment.');
    expect(JSON.stringify(step.editReply.mock.calls)).not.toMatch(/ECONNREFUSED|downloads/);
  });
});
