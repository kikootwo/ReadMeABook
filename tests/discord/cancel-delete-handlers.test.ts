/**
 * Component: Discord /delete Handler Tests
 * Documentation: documentation/integrations/discord-bot.md
 *
 * /delete is for RMAB admins only, checked at the command, every page, the menu and the confirm.
 * Only the account linked to the clicking Discord user counts (database role, read on every
 * step); a Discord role grants nothing. Every step acknowledges Discord before any database work,
 * and a delete runs once. Replies are fixed texts chosen from result fields, never a service
 * message or error text. (Cancel: cancel-confirm-handlers.test.ts.)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeStep, lastText, type FakeStep } from './discord-request-fakes';
import { ADMIN_ROLE, ID, account, admin, deleted, expectNoMentions, record } from './manage-handler-fakes';

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  request: { findFirst: vi.fn(), findMany: vi.fn() },
}));
const deleteMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/services/request-delete.service', () => ({ deleteRequest: deleteMock }));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

const ids = () => import('@/lib/services/discord/discord-custom-id');

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

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUnique.mockResolvedValue(account());
  db.request.findFirst.mockResolvedValue(record());
  db.request.findMany.mockResolvedValue([]);
  deleteMock.mockResolvedValue(deleted());
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

describe('/delete runs once and reports what happened', () => {
  beforeEach(() => {
    db.user.findUnique.mockResolvedValue(admin());
  });

  it('the confirmation turns into "Deleting…" with no buttons before the delete starts', async () => {
    const order: string[] = [];
    deleteMock.mockImplementation(async () => {
      order.push('delete');
      return deleted();
    });
    const step = await deleteStep('confirm', { order });

    const first = step.editReply.mock.calls[0][0];
    expect(first).toMatchObject({ content: 'Deleting…', embeds: [], components: [] });
    expect(order.indexOf('editReply')).toBeLessThan(order.indexOf('delete'));
  });

  it('a second Delete press while the first runs deletes nothing more', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    deleteMock.mockImplementation(async () => {
      await gate;
      return deleted();
    });

    const first = deleteStep('confirm');
    await vi.waitFor(() => expect(deleteMock).toHaveBeenCalledTimes(1));
    const second = deleteStep('confirm');
    const secondState = await Promise.race([second.then(() => 'returned'), new Promise((resolve) => setTimeout(() => resolve('still running'), 500))]);
    release();
    const [done, again] = await Promise.all([first, second]);

    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(secondState).toBe('returned');
    expect(again.editReply).not.toHaveBeenCalled();
    expect(lastText(done)).toBe('Request deleted.');
  });

  it('a later Delete press after the first finished runs again (the service then says not found)', async () => {
    await deleteStep('confirm');
    deleteMock.mockResolvedValue({ ...deleted(), success: false, error: 'NotFound' });
    expect(lastText(await deleteStep('confirm'))).toBe('This request no longer exists.');
    expect(deleteMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['some ebook files removed and some kept', { filesDeleted: true, filesKeptReason: 'b.epub could not be removed (EBUSY)' }, 'Request deleted. Some of its library files were kept.'],
    ['every file removed, only the emptied folder could not be', { filesDeleted: true, folderKept: { folder: '/mnt/media/A/B', files: [], more: 0, error: 'could not be removed (EBUSY)' } }, 'Request deleted. Its library files were removed. Its emptied book folder could not be removed.'],
    ['other files keep the folder', { filesDeleted: true, folderKept: { folder: '/mnt/media/A/B', files: [], more: 3 } }, 'Request deleted. Its library files were removed. Its book folder stays: it still holds other files.'],
  ])('%s: a fixed reply', async (_label, fields, text) => {
    deleteMock.mockResolvedValue(deleted(fields));
    const step = await deleteStep('confirm');
    expect(lastText(step)).toBe(text);
    expect(JSON.stringify(step.editReply.mock.calls)).not.toMatch(/mnt|EBUSY|epub/);
  });

  it('after a delete, a list that cannot be read still shows the outcome, never a failure', async () => {
    db.request.findMany.mockRejectedValue(new Error('database unavailable'));
    deleteMock.mockResolvedValue(deleted({ filesDeleted: true }));
    const step = await deleteStep('confirm');
    expect(step.editReply.mock.calls.at(-1)![0]).toMatchObject({ content: 'Request deleted. Its library files were removed.', embeds: [], components: [] });
    expectNoMentions(step);
  });
});
