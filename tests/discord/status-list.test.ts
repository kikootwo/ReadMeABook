/**
 * Component: Discord /status List Tests
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Whose requests /status lists comes from the account acting now: a user sees only their own,
 * an RMAB admin (database role) sees every user's, and nobody sees a deleted request. A page
 * button carries only a page number, so a crafted custom_id cannot widen what a user sees.
 * Cancel is offered only for requests that can still be cancelled; book text is escaped.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeStep, lastText, selectOptions, type FakeStep } from './discord-request-fakes';

type Row = {
  id: string; userId: string; status: string; type: string; deletedAt: Date | null; createdAt: Date;
  audiobook: { title: string; author: string }; user: { plexUsername: string };
};

const state = vi.hoisted(() => ({ rows: [] as unknown[] }));
const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  request: {
    // Applies the where (deletedAt, userId), order, skip and take like the database
    findMany: vi.fn(async (args: { where: Record<string, unknown>; skip: number; take: number }) =>
      (state.rows as Row[])
        .filter((row) => Object.entries(args.where).every(([key, value]) => row[key as keyof Row] === value))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(args.skip, args.skip + args.take)
    ),
    findFirst: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/services/request-cancel.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/request-cancel.service')>()),
  cancelLoadedRequest: vi.fn(),
}));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

const uuid = (n: number) => `0b6f2c1e-4d6a-4c1e-9a8b-${String(n).padStart(12, '0')}`;
let next = 0;
function row(userId: string, fields: Partial<Row> = {}): Row {
  next += 1;
  return {
    id: uuid(next), userId, status: 'downloading', type: 'audiobook', deletedAt: null, createdAt: new Date(Date.UTC(2026, 0, 1, 0, next)),
    audiobook: { title: `Book ${next}`, author: 'Author' }, user: { plexUsername: userId === 'user-1' ? 'reader' : 'other' }, ...fields,
  };
}

const account = (role: 'user' | 'admin') => ({ id: role === 'admin' ? 'admin-1' : 'user-1', plexUsername: role, role, registrationStatus: 'approved', deletedAt: null });

async function statusCommand() {
  const { handleStatusCommand } = await import('@/lib/services/discord/manage/discord-status-handler');
  const step = fakeStep('command');
  await handleStatusCommand(step as never);
  return step;
}

async function pageClick(customId: string) {
  const { handleStatusComponent } = await import('@/lib/services/discord/manage/discord-status-handler');
  const step = fakeStep('button', { customId });
  await handleStatusComponent(step as never);
  return step;
}

type Embed = { title: string; description: string; footer: { text: string } };
const embed = (step: FakeStep) => (step.editReply.mock.calls.at(-1)![0].embeds as Embed[])[0];
const listed = (step: FakeStep) => embed(step).description;
type Rows = Array<{ components: Array<{ type: number; label?: string; custom_id: string; disabled?: boolean }> }>;
const buttons = (step: FakeStep) =>
  (step.editReply.mock.calls.at(-1)![0].components as Rows).flatMap((r) => r.components).filter((c) => c.type === 2);

beforeEach(() => {
  vi.clearAllMocks();
  next = 0;
  state.rows = [];
  db.user.findUnique.mockResolvedValue(account('user'));
});

describe('/status lists', () => {
  it('a user sees only their own requests, newest first, ephemerally', async () => {
    state.rows = [row('user-1'), row('user-2'), row('user-1', { audiobook: { title: 'Newest', author: 'A' } })];
    const step = await statusCommand();

    expect(step.deferReply).toHaveBeenCalledWith({ flags: 64 });
    expect(embed(step).title).toBe('Your requests');
    expect(listed(step).split('\n')).toEqual([
      '**1.** Newest by A · Audiobook · Downloading',
      '**2.** Book 1 by Author · Audiobook · Downloading',
    ]);
    expect(listed(step)).not.toContain('Book 2');
  });

  it('an RMAB admin (database role) sees every user\'s requests, with the requester', async () => {
    db.user.findUnique.mockResolvedValue(account('admin'));
    state.rows = [row('user-1'), row('user-2')];
    const step = await statusCommand();

    expect(embed(step).title).toBe('All requests');
    expect(listed(step)).toContain('Book 1');
    expect(listed(step)).toContain('Book 2');
    expect(listed(step)).toContain('· other');
  });

  it('deleted requests are never listed, for a user or an admin', async () => {
    state.rows = [row('user-1', { deletedAt: new Date(), audiobook: { title: 'Gone', author: 'A' } }), row('user-1')];
    expect(listed(await statusCommand())).not.toContain('Gone');
    db.user.findUnique.mockResolvedValue(account('admin'));
    expect(listed(await statusCommand())).not.toContain('Gone');
  });

  it('a user\'s page button lists only their own requests on every page, whatever the custom_id', async () => {
    const { encodePageCustomId } = await import('@/lib/services/discord/discord-custom-id');
    state.rows = [...Array.from({ length: 12 }, () => row('user-2')), ...Array.from({ length: 11 }, () => row('user-1'))];

    const first = await pageClick(encodePageCustomId('status', 'page', 0));
    const second = await pageClick(encodePageCustomId('status', 'page', 1));

    expect(listed(first).split('\n')).toHaveLength(10);
    expect(listed(second).split('\n')).toHaveLength(1);
    for (const step of [first, second]) expect(listed(step)).not.toMatch(/\bother\b|Book ([1-9]|1[0-2])\b by/);
    expect(db.request.findMany.mock.calls.every(([args]) => args.where.userId === 'user-1')).toBe(true);
  });

  it.each([
    'rmab:sts:p:0:all:abcdefghij',
    'rmab:sts:a:0:abcdefghij',
    'rmab:sts:p:-1:abcdefghij',
    'rmab:sts:p:1000:abcdefghij',
    'rmab:sts:p:01:abcdefghij',
  ])('a crafted page custom_id (%s) is ignored: nothing is read or shown', async (customId) => {
    state.rows = [row('user-2')];
    const step = await pageClick(customId);

    expect(step.deferUpdate).not.toHaveBeenCalled();
    expect(db.user.findUnique).not.toHaveBeenCalled();
    expect(db.request.findMany).not.toHaveBeenCalled();
  });

  it('pages: Next while there are more, Previous after the first page', async () => {
    const { decodeManageCustomId } = await import('@/lib/services/discord/discord-custom-id');
    state.rows = Array.from({ length: 11 }, () => row('user-1'));
    const step = await statusCommand();

    const [previous, nextButton] = buttons(step);
    expect(previous).toMatchObject({ label: 'Previous', disabled: true });
    expect(nextButton).toMatchObject({ label: 'Next', disabled: false });
    expect(decodeManageCustomId(nextButton.custom_id)).toMatchObject({ area: 'status', action: 'page', page: 1 });
    expect(embed(step).footer.text).toBe('Page 1');
  });

  it('offers Cancel only for requests that can still be cancelled', async () => {
    state.rows = [
      row('user-1', { status: 'available' }),
      row('user-1', { status: 'awaiting_approval' }),
      row('user-1', { status: 'processing' }),
      row('user-1', { status: 'cancelled' }),
      row('user-1', { status: 'pending' }),
    ];
    const step = await statusCommand();

    expect(selectOptions(step).map((o) => o.label).sort()).toEqual(['Book 2', 'Book 5']);
  });

  it('no Cancel menu when nothing can be cancelled, and a fixed text when there are no requests', async () => {
    state.rows = [row('user-1', { status: 'available' })];
    expect(selectOptions(await statusCommand())).toEqual([]);
    state.rows = [];
    expect(listed(await statusCommand())).toBe('No requests yet.');
  });

  it('escapes markdown in book and user text; menu labels stay plain', async () => {
    db.user.findUnique.mockResolvedValue(account('admin'));
    state.rows = [row('user-2', { audiobook: { title: '**Bold** [x](https://e.example) @everyone', author: '_A_' }, user: { plexUsername: '<@1234567890123456>' } })];
    const step = await statusCommand();

    expect(listed(step)).toContain('\\*\\*Bold\\*\\* \\[x\\]\\(https\\://e\\.example\\) \\@everyone by \\_A\\_');
    expect(listed(step)).toContain('\\<\\@1234567890123456\\>');
    expect(selectOptions(step)[0].label).toBe('**Bold** [x](https://e.example) @everyone');
    expect(step.editReply.mock.calls.at(-1)![0]).toMatchObject({ allowedMentions: { parse: [] } });
  });

  it('an unlinked user gets the fixed text and no list', async () => {
    db.user.findUnique.mockResolvedValue(null);
    const step = await statusCommand();
    expect(db.request.findMany).not.toHaveBeenCalled();
    expect(lastText(step)).toBe('Your Discord account is not linked to an RMAB account. Ask an RMAB admin to link it.');
  });
});
