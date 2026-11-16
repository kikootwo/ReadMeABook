/**
 * Component: Discord /request Handler Tests
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Access on every step (real resolver over a mocked database), the requester role at the
 * command and again at confirm, the shared creators, defer-before-work, fixed reply texts
 * (never a service message or raw error), markdown escaping and the server checks.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { ASIN, DISCORD_USER, GUILD, REQUESTER_ROLE, componentIds, fakeStep, lastText, selectOptions, sent, type FakeStep } from './discord-request-fakes';

const prismaMock = createPrismaMock();
const settings = vi.hoisted(() => ({ requesterRole: '' }));
const audible = vi.hoisted(() => ({ search: vi.fn(), getAudiobookDetails: vi.fn() }));
const creator = vi.hoisted(() => ({ createRequestForUser: vi.fn() }));
const jobQueue = vi.hoisted(() => ({ addSearchEbookJob: vi.fn(async () => undefined), addNotificationJob: vi.fn(async () => undefined) }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({ get: async (key: string) => (key === 'discord.requester_role_id' ? settings.requesterRole : null) }),
}));
vi.mock('@/lib/integrations/audible.service', () => ({ getAudibleService: () => audible }));
vi.mock('@/lib/services/request-creator.service', () => creator);
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueue }));
vi.mock('@/lib/utils/audiobook-matcher', () => ({ findPlexMatch: vi.fn(async () => ({ plexGuid: 'p' })) }));
vi.mock('@/lib/services/ebook-request-creator.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/ebook-request-creator.service')>();
  return { createEbookRequestForUser: vi.fn(actual.createEbookRequestForUser) };
});
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

import type { RoutableInteraction } from '@/lib/services/discord/discord-interaction-router';

// Same texts as discord-request-access.ts (checked below; a static import would load the database mock too early)
const NOT_LINKED = 'Your Discord account is not linked to an RMAB account that can make requests. Ask an RMAB admin to link it.';
const NO_REQUESTER_ROLE = 'You need the requester role in this server to request books.';

// Loaded after the mocks above exist (the database mock is a top-level value)
let handleRequestCommand: typeof import('@/lib/services/discord/request/discord-request-handlers').handleRequestCommand;
let handleRequestComponent: typeof import('@/lib/services/discord/request/discord-request-handlers').handleRequestComponent;
let routeInteraction: typeof import('@/lib/services/discord/discord-interaction-router').routeInteraction;
let TEXT: typeof import('@/lib/services/discord/request/discord-request-replies').TEXT;
let ebookCreator: ReturnType<typeof vi.mocked<typeof import('@/lib/services/ebook-request-creator.service').createEbookRequestForUser>>;

beforeAll(async () => {
  ({ handleRequestCommand, handleRequestComponent } = await import('@/lib/services/discord/request/discord-request-handlers'));
  ({ routeInteraction } = await import('@/lib/services/discord/discord-interaction-router'));
  ({ TEXT } = await import('@/lib/services/discord/request/discord-request-replies'));
  const access = await import('@/lib/services/discord/request/discord-request-access');
  expect([access.NOT_LINKED, access.NO_REQUESTER_ROLE]).toEqual([NOT_LINKED, NO_REQUESTER_ROLE]);
  ebookCreator = vi.mocked((await import('@/lib/services/ebook-request-creator.service')).createEbookRequestForUser);
});
const BOOK = { asin: ASIN, title: 'The Book', author: 'Ann Author', narrator: 'Ned', description: 'About', coverArtUrl: 'https://m.media-amazon.com/c.jpg', series: 'Saga', seriesPart: '2' };
const PATH_ERROR = "EACCES: permission denied, open '/srv/library/Ann Author/The Book/secret.m4b'";

type Account = { role?: string; registrationStatus?: string | null; deletedAt?: Date | null } | null;
let account: Account;
let order: string[];

function linkAs(next: Account) {
  account = next === null ? null : { role: 'user', registrationStatus: 'approved', deletedAt: null, ...next };
}

/** Runs /request with a query, picks the book, and returns the confirm step's custom ids. */
async function toConfirm(type: 'audiobook' | 'ebook', member?: unknown) {
  const command = fakeStep('command', { options: { type, query: 'the book' }, member, order });
  await handleRequestCommand(command);
  const select = fakeStep('select', { customId: componentIds(command)[0], values: [ASIN], member, order });
  await handleRequestComponent(select);
  const [confirmId, cancelId] = componentIds(select);
  return { command, select, confirmId, cancelId };
}

async function confirm(confirmId: string, member?: unknown): Promise<FakeStep> {
  const button = fakeStep('button', { customId: confirmId, member, order });
  await handleRequestComponent(button);
  return button;
}

beforeEach(() => {
  vi.clearAllMocks();
  order = [];
  settings.requesterRole = REQUESTER_ROLE;
  linkAs({});
  prismaMock.user.findUnique.mockImplementation(async ({ where }: { where: { discordUserId?: string; id?: string } }) => {
    order.push('db');
    if (where.discordUserId !== undefined) {
      return where.discordUserId === DISCORD_USER && account ? { id: 'user-1', plexUsername: 'alice', ...account } : null;
    }
    return { role: account?.role ?? 'user', autoApproveRequests: true, plexUsername: 'alice' };
  });
  prismaMock.configuration.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
    where.key === 'ebook_annas_archive_enabled' ? { key: where.key, value: 'true' } : null
  );
  prismaMock.audiobook.findFirst.mockResolvedValue({ id: 'ab-1', title: 'The Book', author: 'Ann Author', audibleAsin: ASIN });
  prismaMock.request.findFirst.mockResolvedValue(null);
  prismaMock.request.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: 'ebook-1', ...args.data }));
  audible.search.mockResolvedValue({ query: 'the book', results: [BOOK], totalResults: 1, page: 1, hasMore: false });
  audible.getAudiobookDetails.mockResolvedValue(BOOK);
  creator.createRequestForUser.mockResolvedValue({ success: true, request: { id: 'req-1', status: 'pending' } });
});

describe('/request access', () => {
  it('unlinked: refused at the command, no search, no creator', async () => {
    linkAs(null);
    const command = fakeStep('command', { options: { type: 'audiobook', query: 'the book' } });
    await handleRequestCommand(command);

    expect(lastText(command)).toBe(NOT_LINKED);
    expect(audible.search).not.toHaveBeenCalled();
    expect(creator.createRequestForUser).not.toHaveBeenCalled();
  });

  it.each([
    ['pending approval', { registrationStatus: 'pending_approval' }],
    ['rejected', { registrationStatus: 'rejected' }],
    ['deleted', { deletedAt: new Date() }],
  ])('%s: refused at the command (with and without a query)', async (_label, state) => {
    linkAs(state);
    const withQuery = fakeStep('command', { options: { type: 'audiobook', query: 'the book' } });
    const withoutQuery = fakeStep('command', { options: { type: 'ebook' } });
    await handleRequestCommand(withQuery);
    await handleRequestCommand(withoutQuery);

    expect(lastText(withQuery)).toBe(NOT_LINKED);
    expect(lastText(withoutQuery)).toBe(NOT_LINKED);
    expect(withoutQuery.showModal).not.toHaveBeenCalled();
    expect(audible.search).not.toHaveBeenCalled();
  });

  it.each([
    ['pending approval', { registrationStatus: 'pending_approval' }],
    ['rejected', { registrationStatus: 'rejected' }],
  ])('%s after the command: refused at confirm, nothing created', async (_label, state) => {
    const { confirmId } = await toConfirm('audiobook');
    linkAs(state);
    const button = await confirm(confirmId);

    expect(lastText(button)).toBe(NOT_LINKED);
    expect(button.editReply).toHaveBeenLastCalledWith(expect.objectContaining({ components: [], embeds: [] }));
    expect(creator.createRequestForUser).not.toHaveBeenCalled();
  });

  it('requester role removed between the command and confirm: refused at confirm', async () => {
    const { confirmId } = await toConfirm('ebook');
    const button = await confirm(confirmId, { roles: [] });

    expect(lastText(button)).toBe(NO_REQUESTER_ROLE);
    expect(ebookCreator).not.toHaveBeenCalled();
  });

  it('no requester role at the command: refused (role read from interaction.member, cached shape too)', async () => {
    const raw = fakeStep('command', { options: { type: 'audiobook', query: 'x' }, member: { roles: ['999999999999999999'] } });
    const cached = fakeStep('command', { options: { type: 'audiobook', query: 'x' }, member: { roles: { cache: new Map() } } });
    await handleRequestCommand(raw);
    await handleRequestCommand(cached);

    expect(lastText(raw)).toBe(NO_REQUESTER_ROLE);
    expect(lastText(cached)).toBe(NO_REQUESTER_ROLE);
    expect(audible.search).not.toHaveBeenCalled();
  });

  it('a requester role is set and the interaction has no member: refused', async () => {
    const step = fakeStep('command', { options: { type: 'audiobook', query: 'x' }, member: null });
    await handleRequestCommand(step);
    expect(lastText(step)).toBe(NO_REQUESTER_ROLE);
  });

  it('an RMAB admin without the role: allowed through to the creator', async () => {
    linkAs({ role: 'admin' });
    const { confirmId } = await toConfirm('audiobook', { roles: [] });
    await confirm(confirmId, null);

    expect(creator.createRequestForUser).toHaveBeenCalledTimes(1);
  });

  it('no requester role configured: any linked member may request', async () => {
    settings.requesterRole = '';
    const { confirmId } = await toConfirm('audiobook', { roles: [] });
    await confirm(confirmId, { roles: [] });
    expect(creator.createRequestForUser).toHaveBeenCalledTimes(1);
  });
});

describe('/request creates through the shared creators', () => {
  it('audiobook: createRequestForUser as the linked account, with bypassIgnore like POST /api/requests', async () => {
    const { confirmId } = await toConfirm('audiobook');
    const button = await confirm(confirmId);

    expect(creator.createRequestForUser).toHaveBeenCalledWith(
      'user-1',
      { asin: ASIN, title: 'The Book', author: 'Ann Author', narrator: 'Ned', description: 'About', coverArtUrl: BOOK.coverArtUrl },
      { bypassIgnore: true }
    );
    expect(ebookCreator).not.toHaveBeenCalled();
    expect(lastText(button)).toBe('Requested. The search has started.');
    expect(button.editReply).toHaveBeenLastCalledWith(expect.objectContaining({ components: [] }));
  });

  it('ebook: the shared ebook creator as the linked account', async () => {
    const { confirmId } = await toConfirm('ebook');
    const button = await confirm(confirmId);

    expect(ebookCreator).toHaveBeenCalledWith('user-1', ASIN);
    expect(creator.createRequestForUser).not.toHaveBeenCalled();
    expect(prismaMock.request.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'user-1', type: 'ebook' }) });
    expect(lastText(button)).toBe('Ebook requested. The search has started.');
  });

  it.each([
    [{ success: true, request: { status: 'awaiting_approval' } }, 'Requested. An admin needs to approve it before it downloads.'],
    [{ success: true, request: { status: 'awaiting_release' } }, 'Requested. It is not released yet; the search starts once it is.'],
    [{ success: false, reason: 'duplicate', message: 'You have already requested this audiobook' }, 'You have already requested this audiobook.'],
    [{ success: false, reason: 'already_available', message: `In library at ${PATH_ERROR}` }, 'This audiobook is already in the library.'],
    [{ success: false, reason: 'being_processed', message: PATH_ERROR }, 'This audiobook is already being downloaded or processed.'],
    [{ success: false, reason: 'user_not_found', message: 'User not found' }, NOT_LINKED],
  ])('audiobook result %j → a fixed reply', async (result, text) => {
    creator.createRequestForUser.mockResolvedValue(result);
    const { confirmId } = await toConfirm('audiobook');
    expect(lastText(await confirm(confirmId))).toBe(text);
  });

  it('cancel: nothing created', async () => {
    const { cancelId } = await toConfirm('audiobook');
    const button = await confirm(cancelId);
    expect(lastText(button)).toBe(TEXT.cancelled);
    expect(creator.createRequestForUser).not.toHaveBeenCalled();
  });
});

describe('/request never shows a service message or raw error', () => {
  const shown = (step: FakeStep) => JSON.stringify(sent(step));

  it('ebook creator 500 with a path in its error: the route body keeps it, the reply does not', async () => {
    prismaMock.request.create.mockRejectedValue(new Error(PATH_ERROR));
    const { confirmId } = await toConfirm('ebook');
    const button = await confirm(confirmId);

    const result = await ebookCreator.mock.results[0].value;
    expect(result).toMatchObject({ outcome: 'error', status: 500, body: { error: PATH_ERROR } });
    expect(lastText(button)).toBe(TEXT.generic);
    expect(shown(button)).not.toContain('/srv/library');
  });

  it('audiobook creator throws a path-bearing error: fixed text only', async () => {
    creator.createRequestForUser.mockRejectedValue(new Error(PATH_ERROR));
    const { confirmId } = await toConfirm('audiobook');
    const button = await confirm(confirmId);

    expect(lastText(button)).toBe(TEXT.generic);
    expect(shown(button)).not.toContain('/srv/library');
  });

  it('a 409 ebook body message is not shown either', async () => {
    prismaMock.request.findFirst.mockImplementation(async ({ where }: { where: { type: string } }) =>
      where.type === 'ebook' ? { id: 'ebook-old', status: 'downloading' } : { id: 'parent' }
    );
    const { confirmId } = await toConfirm('ebook');
    const button = await confirm(confirmId);
    expect(lastText(button)).toBe('This ebook has already been requested.');
    expect(shown(button)).not.toContain('status: downloading');
  });
});

describe('/request: Discord acknowledgement order', () => {
  it('with a query: deferred before any database read or search', async () => {
    const { command, select } = await toConfirm('audiobook');
    expect(command.order.indexOf('deferReply')).toBe(0);
    expect(command.order.indexOf('db')).toBeGreaterThan(0);
    expect(select.order.filter((e) => e !== 'db').slice(0, 3)).toEqual(['deferReply', 'editReply', 'deferUpdate']);
    const button = await confirm(componentIds(select)[0]);
    const fromConfirm = button.order.slice(button.order.lastIndexOf('deferUpdate'));
    expect(fromConfirm[0]).toBe('deferUpdate');
    expect(fromConfirm).toContain('db');
  });

  it('without a query: access read from the database, then the form is the first reply (no defer); the submit checks again', async () => {
    const command = fakeStep('command', { options: { type: 'ebook' }, order });
    await handleRequestCommand(command);

    expect(order).toEqual(['db', 'showModal']);
    expect(command.deferReply).not.toHaveBeenCalled();
    const modal = command.showModal.mock.calls[0][0] as { custom_id: string; components: Array<{ components: Array<{ custom_id: string }> }> };
    expect(modal.components[0].components[0].custom_id).toBe('query');

    linkAs({ registrationStatus: 'rejected' });
    const submit = fakeStep('modal', { customId: modal.custom_id, query: 'the book' });
    await handleRequestComponent(submit);
    expect(submit.order[0]).toBe('deferReply');
    expect(lastText(submit)).toBe(NOT_LINKED);
    expect(audible.search).not.toHaveBeenCalled();
  });

  it('the form submit searches as the command would', async () => {
    const command = fakeStep('command', { options: { type: 'audiobook' } });
    await handleRequestCommand(command);
    const submit = fakeStep('modal', { customId: (command.showModal.mock.calls[0][0] as { custom_id: string }).custom_id, query: ' dune ' });
    await handleRequestComponent(submit);

    expect(audible.search).toHaveBeenCalledWith('dune', 1);
    expect(selectOptions(submit).map((o) => o.value)).toEqual([ASIN]);
  });
});

describe('/request: search results and the book embed', () => {
  it.each([
    ['every result hidden by the language filter', { language: 'en', hiddenCount: 3, firstResultHidden: true }, 'allHidden'],
    ['no results', undefined, 'noResults'],
  ] as const)('%s says so', async (_label, languageFilter, text) => {
    audible.search.mockResolvedValue({ query: 'x', results: [], totalResults: 0, page: 1, hasMore: false, languageFilter });
    const command = fakeStep('command', { options: { type: 'audiobook', query: 'x' } });
    await handleRequestCommand(command);
    expect(lastText(command)).toBe(TEXT[text]);
  });

  it('at most 25 options, one per ASIN, invalid ASINs dropped', async () => {
    const many = Array.from({ length: 40 }, (_, n) => ({ ...BOOK, asin: `B0${String(n).padStart(8, '0')}` }));
    audible.search.mockResolvedValue({ query: 'x', results: [BOOK, BOOK, { ...BOOK, asin: 'bad' }, ...many], totalResults: 43, page: 1, hasMore: true });
    const command = fakeStep('command', { options: { type: 'audiobook', query: 'x' } });
    await handleRequestCommand(command);

    const values = selectOptions(command).map((o) => o.value);
    expect(values).toHaveLength(25);
    expect(new Set(values).size).toBe(25);
    expect(values).not.toContain('bad');
  });

  it('the embed holds metadata only, markdown escaped; no reply parses mentions', async () => {
    audible.getAudiobookDetails.mockResolvedValue({ ...BOOK, title: '**Big** [win](https://x.test) @everyone', author: '_Ann_ `x`', narrator: '> quote', series: '# Saga ||spoiler||' });
    const { command, select } = await toConfirm('audiobook');

    const embed = (select.editReply.mock.calls.at(-1)![0].embeds as Array<Record<string, unknown>>)[0];
    expect(embed.title).toBe('\\*\\*Big\\*\\* \\[win\\]\\(https\\://x\\.test\\) \\@everyone');
    const texts = [embed.title, ...(embed.fields as Array<{ value: string }>).map((f) => f.value)] as string[];
    expect(texts.slice(1)).toEqual(['\\_Ann\\_ \\`x\\`', '\\> quote', '\\# Saga \\|\\|spoiler\\|\\|, book 2']);
    // With every escaped pair removed, no markdown character is left
    for (const text of texts) expect(text.replace(/\\./g, '')).not.toMatch(/[*_`|>#[\]()]/);
    expect(Object.keys(embed).sort()).toEqual(['fields', 'footer', 'thumbnail', 'title']);
    expect((embed.fields as Array<{ name: string }>).map((f) => f.name)).toEqual(['Author', 'Narrator', 'Series']);
    for (const payload of [...sent(command), ...sent(select)].filter((p) => 'content' in p)) {
      expect(payload.allowedMentions).toEqual({ parse: [] });
    }
  });

  it('a stale or forged menu value: no lookup, a fixed text', async () => {
    const command = fakeStep('command', { options: { type: 'audiobook', query: 'x' } });
    await handleRequestCommand(command);
    const select = fakeStep('select', { customId: componentIds(command)[0], values: ['../../etc/passwd'] });
    await handleRequestComponent(select);
    expect(lastText(select)).toBe(TEXT.staleChoice);
    expect(audible.getAudiobookDetails).not.toHaveBeenCalled();
  });
});

describe('/request: server checks and forged ids', () => {
  const asRoutable = (step: FakeStep) => step as unknown as RoutableInteraction;

  it('a command or form submit from another server or a DM is dropped before any database read', async () => {
    for (const guildId of ['444444444444444444', null]) {
      const command = fakeStep('command', { guildId, options: { type: 'audiobook', query: 'x' } });
      const submit = fakeStep('modal', { guildId, customId: 'rmab:req:modal:a:abcdefghij', query: 'x' });
      expect(await routeInteraction(asRoutable(command), GUILD)).toBe('ignored-foreign-guild');
      expect(await routeInteraction(asRoutable(submit), GUILD)).toBe('ignored-foreign-guild');
    }
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('a confirm button pressed in a DM is ignored (no member to check)', async () => {
    const { confirmId } = await toConfirm('audiobook');
    prismaMock.user.findUnique.mockClear();
    const button = fakeStep('button', { guildId: null, customId: confirmId, member: null });
    expect(await routeInteraction(asRoutable(button), GUILD)).toBe('handled');
    expect(button.deferUpdate).not.toHaveBeenCalled();
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(creator.createRequestForUser).not.toHaveBeenCalled();
  });

  it.each([
    `rmab:req:ok:a:${ASIN}:abcdefghij:admin`,
    `rmab:req:ok:a:${ASIN}:${DISCORD_USER}:abcdefghij`,
    `rmab:req:ok:a:${ASIN}:abcdefghij${'x'.repeat(100)}`,
  ])('a forged confirm id (%s) is ignored: no acknowledgement, no read, no request', async (customId) => {
    const button = fakeStep('button', { customId });
    await handleRequestComponent(button);
    expect(button.deferUpdate).not.toHaveBeenCalled();
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(creator.createRequestForUser).not.toHaveBeenCalled();
  });

  it('a confirm id on a menu (step and kind disagree) is ignored', async () => {
    const select = fakeStep('select', { customId: `rmab:req:ok:a:${ASIN}:abcdefghij`, values: [ASIN] });
    await handleRequestComponent(select);
    expect(select.deferUpdate).not.toHaveBeenCalled();
    expect(creator.createRequestForUser).not.toHaveBeenCalled();
  });
});
