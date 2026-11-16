/**
 * Component: Discord Cancel and /delete Handler Tests
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Who may cancel or delete from Discord: Cancel is for the request's requester or an RMAB admin;
 * /delete is for RMAB admins only, checked at the command, every page, the menu and the confirm.
 * Only the account linked to the clicking Discord user counts (database role, read on every
 * step); a Discord role grants nothing. Every step acknowledges Discord before any database work.
 * Replies are fixed texts chosen from result fields, never a service message or error text.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DISCORD_USER, fakeStep, lastText, type FakeStep } from './discord-request-fakes';

const ADMIN_ROLE = '666666666666666666';
const ID = '0b6f2c1e-4d6a-4c1e-9a8b-1f2e3d4c5b6a';

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  request: { findFirst: vi.fn(), findMany: vi.fn() },
}));
const cancelMock = vi.hoisted(() => vi.fn());
const deleteMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/services/request-cancel.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/request-cancel.service')>()),
  cancelLoadedRequest: cancelMock,
}));
vi.mock('@/lib/services/request-delete.service', () => ({ deleteRequest: deleteMock }));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

type Account = { id: string; plexUsername: string; role: string; registrationStatus: string; deletedAt: Date | null };
const account = (overrides: Partial<Account> = {}): Account => ({
  id: 'user-1', plexUsername: 'reader', role: 'user', registrationStatus: 'approved', deletedAt: null, ...overrides,
});
const admin = (overrides: Partial<Account> = {}) => account({ id: 'admin-1', plexUsername: 'boss', role: 'admin', ...overrides });

const record = (userId = 'user-1', status = 'downloading') => ({
  id: ID, userId, status, audiobookId: 'ab-1', type: 'audiobook',
  audiobook: { title: 'Book', author: 'Author' }, user: { plexUsername: 'reader' },
});
const cancelled = (fields: Record<string, unknown> = {}) => ({
  success: true, request: { id: ID, status: 'cancelled', cancelledAt: new Date() }, download: 'none', message: 'Request cancelled.', ...fields,
});
const deleted = (fields: Record<string, unknown> = {}) => ({
  success: true, message: 'Request deleted successfully', filesDeleted: false, torrentsRemoved: 0, torrentsKeptSeeding: 0,
  torrentsKeptUnlimited: 0, torrentsKeptShared: 0, torrentsKeptNotOwned: 0, ...fields,
});

const ids = () => import('@/lib/services/discord/discord-custom-id');

async function cardCancel(opts: { guildId?: string | null; order?: string[] } = {}) {
  const { encodeRequestActionCustomId } = await ids();
  const { handleStatusComponent } = await import('@/lib/services/discord/manage/discord-status-handler');
  // The clicker holds the Discord admin role in every case: it must never matter
  const step = fakeStep('button', { customId: encodeRequestActionCustomId('status', ID), member: { roles: [ADMIN_ROLE] }, ...opts });
  await handleStatusComponent(step as never);
  return step;
}

async function statusMenuCancel(values: string[] = [ID]) {
  const { encodePageCustomId } = await ids();
  const { handleStatusComponent } = await import('@/lib/services/discord/manage/discord-status-handler');
  const step = fakeStep('select', { customId: encodePageCustomId('status', 'menu', 0), values, member: { roles: [ADMIN_ROLE] } });
  await handleStatusComponent(step as never);
  return step;
}

type DeleteStep = 'command' | 'page' | 'menu' | 'confirm';
async function deleteStep(kind: DeleteStep, opts: { guildId?: string | null; order?: string[] } = {}) {
  const { encodePageCustomId, encodeRequestActionCustomId } = await ids();
  const handlers = await import('@/lib/services/discord/manage/discord-delete-handler');
  const member = { roles: [ADMIN_ROLE] };
  let step: FakeStep;
  if (kind === 'command') {
    step = fakeStep('command', { member, ...opts });
    await handlers.handleDeleteCommand(step as never);
    return step;
  }
  if (kind === 'page') step = fakeStep('button', { customId: encodePageCustomId('delete', 'page', 1), member, ...opts });
  else if (kind === 'menu') step = fakeStep('select', { customId: encodePageCustomId('delete', 'menu', 0), values: [ID], member, ...opts });
  else step = fakeStep('button', { customId: encodeRequestActionCustomId('delete', ID), member, ...opts });
  await handlers.handleDeleteComponent(step as never);
  return step;
}

/** Every payload sent carries no-mention allowedMentions. */
function expectNoMentions(step: FakeStep) {
  for (const [payload] of [...step.editReply.mock.calls, ...step.reply.mock.calls]) {
    expect(payload).toMatchObject({ allowedMentions: { parse: [] } });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUnique.mockResolvedValue(account());
  db.request.findFirst.mockResolvedValue(record());
  db.request.findMany.mockResolvedValue([]);
  cancelMock.mockResolvedValue(cancelled());
  deleteMock.mockResolvedValue(deleted());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Cancel from a card or /status', () => {
  it('the requester (non-admin) cancels their own request as the requester audience', async () => {
    const step = await cardCancel();

    expect(db.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { discordUserId: DISCORD_USER } }));
    expect(db.request.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: ID, deletedAt: null } }));
    expect(cancelMock).toHaveBeenCalledWith(expect.objectContaining({ id: ID, status: 'downloading' }), { audience: 'owner' });
    expect(step.deferReply).toHaveBeenCalledWith({ flags: 64 });
    expect(lastText(step)).toBe('Request cancelled.');
    expectNoMentions(step);
  });

  it('a non-admin on another user\'s request is refused and nothing is cancelled', async () => {
    db.request.findFirst.mockResolvedValue(record('user-2'));
    const step = await cardCancel();

    expect(cancelMock).not.toHaveBeenCalled();
    expect(lastText(step)).toBe('You can cancel only your own requests.');
  });

  it('a linked RMAB admin cancels any request as the admin audience (also from the approval message)', async () => {
    db.user.findUnique.mockResolvedValue(admin());
    db.request.findFirst.mockResolvedValue(record('user-2', 'awaiting_approval'));
    await cardCancel();

    expect(cancelMock).toHaveBeenCalledWith(expect.objectContaining({ id: ID }), { audience: 'admin' });
  });

  it('a card in a DM works the same way (the requester\'s own card)', async () => {
    const step = await cardCancel({ guildId: null });
    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(lastText(step)).toBe('Request cancelled.');
  });

  it.each([
    ['an unlinked member holding the Discord admin role', null],
    ['a linked account pending approval', account({ registrationStatus: 'pending_approval' })],
    ['a linked account that was rejected', account({ registrationStatus: 'rejected' })],
    ['a linked account that was deleted', account({ deletedAt: new Date() })],
  ])('%s is refused and nothing is read or cancelled', async (_label, linked) => {
    db.user.findUnique.mockResolvedValue(linked);
    const step = await cardCancel();

    expect(db.request.findFirst).not.toHaveBeenCalled();
    expect(cancelMock).not.toHaveBeenCalled();
    expect(lastText(step)).toBe('Your Discord account is not linked to an RMAB account. Ask an RMAB admin to link it.');
  });

  it('a deleted request (re-read with deletedAt null) is not found and not cancelled', async () => {
    db.request.findFirst.mockResolvedValue(null);
    const step = await cardCancel();
    expect(cancelMock).not.toHaveBeenCalled();
    expect(lastText(step)).toBe('This request no longer exists.');
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

    const done = cardCancel({ order });
    await vi.advanceTimersByTimeAsync(10_000);
    const step = await done;

    expect(order.slice(0, 2)).toEqual(['deferReply', 'db']);
    expect(order.indexOf('deferReply')).toBeLessThan(order.indexOf('cancel'));
    expect(lastText(step)).toBe('Request cancelled.');
  });

  it.each([
    ['already cancelled', cancelled({ alreadyCancelled: true, message: 'This request was already cancelled.' }), 'This request was already cancelled.'],
    ['not cancellable', { success: false, reason: 'not_cancellable', status: 'processing' }, 'This request can no longer be cancelled. Status: Processing.'],
    ['gone meanwhile', { success: false, reason: 'not_found' }, 'This request no longer exists.'],
    ['download kept (requester view)', cancelled({ download: 'kept' }), 'Request cancelled. Its download stays in the download client.'],
    ['download removed', cancelled({ download: 'removed' }), 'Request cancelled. Its download was removed from the download client.'],
  ])('%s maps to a fixed reply', async (_label, result, text) => {
    cancelMock.mockResolvedValue(result);
    expect(lastText(await cardCancel())).toBe(text);
  });

  it('an admin reply never shows the service message (it can name the download client)', async () => {
    db.user.findUnique.mockResolvedValue(admin());
    cancelMock.mockResolvedValue(cancelled({ download: 'kept_shared', message: 'Request cancelled. Its download stays in qBittorrent-Home: another request still uses it.' }));
    const step = await cardCancel();

    expect(lastText(step)).toBe('Request cancelled. Its download stays in the download client: another request still uses it.');
    expect(JSON.stringify(step.editReply.mock.calls)).not.toContain('qBittorrent-Home');
  });

  it('the /status menu cancels the chosen request and lists the page again', async () => {
    const step = await statusMenuCancel();

    expect(step.deferUpdate).toHaveBeenCalledTimes(1);
    expect(cancelMock).toHaveBeenCalledWith(expect.objectContaining({ id: ID }), { audience: 'owner' });
    expect(lastText(step)).toBe('Request cancelled.');
    expect(db.request.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { deletedAt: null, userId: 'user-1' } }));
  });

  it('the /status menu refuses another user\'s request for a non-admin', async () => {
    db.request.findFirst.mockResolvedValue(record('user-2'));
    const step = await statusMenuCancel();
    expect(cancelMock).not.toHaveBeenCalled();
    expect(lastText(step)).toBe('You can cancel only your own requests.');
  });

  it('a menu value that is not a request ID cancels nothing', async () => {
    const step = await statusMenuCancel(['../../etc']);
    expect(db.request.findFirst).not.toHaveBeenCalled();
    expect(cancelMock).not.toHaveBeenCalled();
    expect(lastText(step)).toBe('That choice is no longer available. Run the command again.');
  });

  it('a failing step shows the generic text, never the error', async () => {
    cancelMock.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:8080 /downloads/Book'));
    const step = await cardCancel();
    expect(lastText(step)).toBe('Something went wrong. Try again in a moment.');
    expect(JSON.stringify(step.editReply.mock.calls)).not.toMatch(/ECONNREFUSED|downloads/);
  });
});

describe('/delete (RMAB admins only)', () => {
  it.each<DeleteStep>(['command', 'page', 'menu', 'confirm'])('a linked non-admin is refused at the %s step; nothing is listed or deleted', async (kind) => {
    const step = await deleteStep(kind);

    expect(deleteMock).not.toHaveBeenCalled();
    expect(db.request.findMany).not.toHaveBeenCalled();
    expect(db.request.findFirst).not.toHaveBeenCalled();
    expect(lastText(step)).toBe('Only RMAB admins can delete requests. To stop one of your own requests, use Cancel in /status or on its card.');
  });

  it.each<DeleteStep>(['command', 'page', 'menu', 'confirm'])('an unlinked member holding the Discord admin role is refused at the %s step', async (kind) => {
    db.user.findUnique.mockResolvedValue(null);
    const step = await deleteStep(kind);
    expect(deleteMock).not.toHaveBeenCalled();
    expect(lastText(step)).toBe('Your Discord account is not linked to an RMAB account. Ask an RMAB admin to link it.');
  });

  it.each([
    ['pending approval', admin({ registrationStatus: 'pending_approval' })],
    ['rejected', admin({ registrationStatus: 'rejected' })],
    ['deleted', admin({ deletedAt: new Date() })],
  ])('an admin account that is %s is refused at the confirm', async (_label, linked) => {
    db.user.findUnique.mockResolvedValue(linked);
    await deleteStep('confirm');
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('an admin demoted between the menu and the confirm is refused at the confirm', async () => {
    db.user.findUnique.mockResolvedValue(admin());
    const menu = await deleteStep('menu');
    expect((menu.editReply.mock.calls.at(-1)![0] as { content: string }).content).toMatch(/^Delete this request\?/);

    db.user.findUnique.mockResolvedValue(admin({ role: 'user' }));
    const confirm = await deleteStep('confirm');

    expect(deleteMock).not.toHaveBeenCalled();
    expect(lastText(confirm)).toMatch(/^Only RMAB admins can delete requests/);
  });

  it('a linked admin deletes as themselves after the confirm; each step defers first', async () => {
    const order: string[] = [];
    db.user.findUnique.mockImplementation(async () => {
      order.push('db');
      return admin();
    });
    const step = await deleteStep('confirm', { order });

    expect(order.slice(0, 2)).toEqual(['deferUpdate', 'db']);
    expect(deleteMock).toHaveBeenCalledWith(ID, 'admin-1');
    expect(lastText(step)).toBe('Request deleted.');
    expectNoMentions(step);
  });

  it('the command lists every user\'s requests for an admin, ephemerally', async () => {
    db.user.findUnique.mockResolvedValue(admin());
    const step = await deleteStep('command');
    expect(step.deferReply).toHaveBeenCalledWith({ flags: 64 });
    expect(db.request.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { deletedAt: null } }));
  });

  it('a /delete component from a DM is dropped', async () => {
    db.user.findUnique.mockResolvedValue(admin());
    const step = await deleteStep('confirm', { guildId: null });
    expect(step.deferUpdate).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('a kept-files reason with a path, and the service message, never reach the reply', async () => {
    db.user.findUnique.mockResolvedValue(admin());
    const reason = 'the folder /mnt/media/Secret Author/Book is outside the media library (/mnt/media)';
    deleteMock.mockResolvedValue(deleted({ message: `Request deleted; files kept: ${reason}`, filesKeptReason: reason, torrentsKeptSeeding: 1 }));
    const step = await deleteStep('confirm');

    expect(lastText(step)).toBe('Request deleted. Its library files were kept. Its download stays in the download client to seed.');
    expect(JSON.stringify(step.editReply.mock.calls)).not.toMatch(/mnt|Secret Author|files kept/);
  });

  it('a raw error from the delete never reaches the reply', async () => {
    db.user.findUnique.mockResolvedValue(admin());
    deleteMock.mockResolvedValue({ ...deleted(), success: false, message: 'Failed to delete request', error: "EACCES: permission denied, unlink '/mnt/media/Author/Book/01.m4b'" });
    const step = await deleteStep('confirm');

    expect(lastText(step)).toBe('The request could not be deleted. The RMAB logs say why.');
    expect(JSON.stringify(step.editReply.mock.calls)).not.toMatch(/EACCES|mnt|Failed to delete/);
  });

  it.each([
    [{ filesDeleted: true, torrentsRemoved: 1 }, 'Request deleted. Its library files were removed. Its download was removed from the download client.'],
    [{ folderKept: { folder: '/mnt/media/A/B', files: [{ name: 'notes.txt' }], more: 0 } }, 'Request deleted. Its book folder stays: it still holds other files.'],
    [{ torrentsKeptShared: 1 }, 'Request deleted. Its download stays in the download client.'],
  ])('a successful delete reply is built from the result counts (%o)', async (fields, text) => {
    db.user.findUnique.mockResolvedValue(admin());
    deleteMock.mockResolvedValue(deleted(fields));
    const step = await deleteStep('confirm');
    expect(lastText(step)).toBe(text);
    expect(JSON.stringify(step.editReply.mock.calls)).not.toContain('/mnt/media');
  });

  it('a request deleted meanwhile shows not found', async () => {
    db.user.findUnique.mockResolvedValue(admin());
    deleteMock.mockResolvedValue({ ...deleted(), success: false, message: 'Request not found or already deleted', error: 'NotFound' });
    expect(lastText(await deleteStep('confirm'))).toBe('This request no longer exists.');
  });
});
