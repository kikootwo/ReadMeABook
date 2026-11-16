/**
 * Component: Discord Request Card Tests
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Cards hold book metadata and a status label only (never release picks, URLs, keys, paths or
 * error text), every send and edit says which mentions may ping, database text is
 * markdown-escaped, and the stored card list follows what was posted and decided.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, resetFakeDb, seedRequest } from './approval-db-fake';

const db = vi.hoisted(() => ({ rows: new Map(), histories: [], hooks: {} }) as ReturnType<typeof createFakeDb>);
const configMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', async () => (await import('./approval-db-fake')).fakePrisma(db));
vi.mock('@/lib/services/discord/discord-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/discord/discord-config')>()),
  loadDiscordConfig: configMock,
}));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

const ID = '0b6f2c1e-4d6a-4c1e-9a8b-1f2e3d4c5b6a';
const REQUEST_CHANNEL = '444444444444444441';
const ADMIN_CHANNEL = '444444444444444442';
const DM_CHANNEL = '444444444444444443';
const ADMIN_ROLE = '666666666666666666';

type Call = { method: 'post' | 'patch'; route: string; body: Record<string, any> };

function fakeBot(calls: Call[], fail: (route: string) => boolean = () => false) {
  let next = 900000000000000000n;
  const rest = {
    post: vi.fn(async (route: string, { body }: { body: Record<string, any> }) => {
      calls.push({ method: 'post', route, body });
      if (fail(route)) throw new Error('Cannot send messages to this user');
      if (route === '/users/@me/channels') return { id: DM_CHANNEL };
      next += 1n;
      return { id: String(next), channel_id: route.split('/')[2] };
    }),
    patch: vi.fn(async (route: string, { body }: { body: Record<string, any> }) => {
      calls.push({ method: 'patch', route, body });
      if (fail(route)) throw new Error('Unknown Message');
      return {};
    }),
  };
  return { getClient: () => ({ rest }) } as never;
}

function config(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true, botToken: 't', guildId: '222222222222222222', requesterRoleId: '',
    requestChannelId: REQUEST_CHANNEL, adminNotifyChannelId: ADMIN_CHANNEL, adminRoleId: ADMIN_ROLE, requestCardMode: 'dm',
    ...overrides,
  };
}

const messageSends = (calls: Call[]) => calls.filter((c) => c.route.endsWith('/messages') || c.method === 'patch');
const storedCards = () => db.rows.get(ID)!.discordCards as Array<{ kind: string; channelId: string; messageId: string }>;

describe('announceRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFakeDb(db);
    configMock.mockResolvedValue(config());
  });

  it.each([
    ['dm', ['dm']],
    ['public', ['public']],
    ['both', ['public', 'dm']],
  ] as const)('card mode %s posts %j (plus the approval message while it waits)', async (mode, kinds) => {
    configMock.mockResolvedValue(config({ requestCardMode: mode }));
    seedRequest(db);
    const calls: Call[] = [];
    const { announceRequest } = await import('@/lib/services/discord/cards/discord-cards');
    await announceRequest(fakeBot(calls), ID);

    expect(storedCards().map((c) => c.kind)).toEqual([...kinds, 'approval']);
    const approval = storedCards().find((c) => c.kind === 'approval')!;
    expect(approval.channelId).toBe(ADMIN_CHANNEL);
    if (kinds.includes('dm' as never)) {
      expect(calls).toContainEqual({ method: 'post', route: '/users/@me/channels', body: { recipient_id: '222222222222222222' } });
    }
  });

  it('every send says which mentions may ping: none on cards, only the admin role on the approval message', async () => {
    configMock.mockResolvedValue(config({ requestCardMode: 'both' }));
    seedRequest(db);
    const calls: Call[] = [];
    const { announceRequest } = await import('@/lib/services/discord/cards/discord-cards');
    await announceRequest(fakeBot(calls), ID);

    const sends = messageSends(calls);
    expect(sends).toHaveLength(3);
    for (const send of sends) expect(send.body.allowed_mentions.parse).toEqual([]);
    const approval = sends.find((s) => s.route === `/channels/${ADMIN_CHANNEL}/messages`)!;
    expect(approval.body.allowed_mentions).toEqual({ parse: [], roles: [ADMIN_ROLE] });
    expect(approval.body.content).toBe(`<@&${ADMIN_ROLE}> A request needs approval.`);
    expect(sends.filter((s) => s !== approval).every((s) => s.body.allowed_mentions.roles === undefined)).toBe(true);
  });

  it('no admin role set: no ping and no roles list (an empty role ID would fail the send)', async () => {
    configMock.mockResolvedValue(config({ adminRoleId: '' }));
    seedRequest(db);
    const calls: Call[] = [];
    const { announceRequest } = await import('@/lib/services/discord/cards/discord-cards');
    await announceRequest(fakeBot(calls), ID);

    const approval = messageSends(calls).find((s) => s.route === `/channels/${ADMIN_CHANNEL}/messages`)!;
    expect(approval.body.allowed_mentions).toEqual({ parse: [] });
    expect(approval.body.content).toBe('A request needs approval.');
  });

  it('cards carry book text and a status label only, markdown-escaped, never request internals', async () => {
    configMock.mockResolvedValue(config({ requestCardMode: 'both' }));
    seedRequest(db, {
      errorMessage: 'ENOENT /downloads/secret/file.m4b',
      selectedTorrent: { downloadUrl: 'http://prowlarr:9696/1/download?apikey=SECRETKEY', title: 'Release' },
      placedEbookFiles: [{ path: '/library/x.epub' }],
    });
    const { AUDIOBOOK } = await import('./approval-db-fake');
    Object.assign(AUDIOBOOK, { title: '**Bold** @everyone [link](http://x)', narrator: '_Reader_' });
    const calls: Call[] = [];
    try {
      const { announceRequest } = await import('@/lib/services/discord/cards/discord-cards');
      await announceRequest(fakeBot(calls), ID);
    } finally {
      Object.assign(AUDIOBOOK, { title: 'The Book', narrator: 'A Reader' });
    }

    const text = JSON.stringify(messageSends(calls).map((s) => s.body));
    for (const leak of ['downloadUrl', 'apikey', 'SECRETKEY', '/downloads/', '/library/', 'selectedTorrent', 'errorMessage', 'ENOENT', 'prowlarr']) {
      expect(text).not.toContain(leak);
    }
    const embed = messageSends(calls)[0].body.embeds[0];
    expect(embed.title).toBe(String.raw`\*\*Bold\*\* \@everyone \[link\]\(http\://x\)`);
    const approvalEmbed = messageSends(calls).find((s) => s.route === `/channels/${ADMIN_CHANNEL}/messages`)!.body.embeds[0];
    expect(approvalEmbed.fields).toContainEqual({ name: 'Narrator', value: String.raw`\_Reader\_`, inline: true });
    expect(embed.fields).toContainEqual({ name: 'Status', value: 'Waiting for approval', inline: true });
  });

  it('a failed post is skipped (logged): the others are still posted and stored', async () => {
    configMock.mockResolvedValue(config({ requestCardMode: 'both' }));
    seedRequest(db);
    const calls: Call[] = [];
    const { announceRequest } = await import('@/lib/services/discord/cards/discord-cards');
    await announceRequest(fakeBot(calls, (route) => route === '/users/@me/channels'), ID);

    expect(storedCards().map((c) => c.kind)).toEqual(['public', 'approval']);
  });

  it('nothing could be posted: an empty list still marks the request as made in Discord', async () => {
    configMock.mockResolvedValue(config({ requestCardMode: 'public', requestChannelId: '', adminNotifyChannelId: '' }));
    seedRequest(db);
    const { announceRequest } = await import('@/lib/services/discord/cards/discord-cards');
    await announceRequest(fakeBot([]), ID);
    expect(storedCards()).toEqual([]);
  });

  it('a request that no longer waits for approval gets no approval message', async () => {
    seedRequest(db, { status: 'pending' });
    const calls: Call[] = [];
    const { announceRequest } = await import('@/lib/services/discord/cards/discord-cards');
    await announceRequest(fakeBot(calls), ID);
    expect(storedCards().map((c) => c.kind)).toEqual(['dm']);
  });

  it('bot client not ready: nothing posted, nothing written', async () => {
    seedRequest(db);
    const { announceRequest } = await import('@/lib/services/discord/cards/discord-cards');
    await announceRequest({ getClient: () => null } as never, ID);
    expect(db.rows.get(ID)!.discordCards).toBeNull();
  });
});

describe('refreshRequestCards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFakeDb(db);
  });

  const CARDS = [
    { kind: 'dm', channelId: DM_CHANNEL, messageId: '900000000000000001' },
    { kind: 'approval', channelId: ADMIN_CHANNEL, messageId: '900000000000000002' },
  ];

  it('a request made on the web (no cards): one read, no Discord call', async () => {
    seedRequest(db, { status: 'downloading' });
    const calls: Call[] = [];
    const { refreshRequestCards } = await import('@/lib/services/discord/cards/discord-cards');
    await refreshRequestCards(fakeBot(calls), ID);
    expect(calls).toEqual([]);
  });

  it('still waiting: the card is edited, the approval message is left as it is', async () => {
    seedRequest(db, { discordCards: CARDS });
    const calls: Call[] = [];
    const { refreshRequestCards } = await import('@/lib/services/discord/cards/discord-cards');
    await refreshRequestCards(fakeBot(calls), ID);

    expect(calls.map((c) => c.route)).toEqual([`/channels/${DM_CHANNEL}/messages/900000000000000001`]);
    expect(storedCards()).toEqual(CARDS);
  });

  it('completed straight from awaiting approval (a library match): the approval message loses its buttons and shows the status', async () => {
    seedRequest(db, { status: 'available', discordCards: CARDS });
    const calls: Call[] = [];
    const { refreshRequestCards } = await import('@/lib/services/discord/cards/discord-cards');
    await refreshRequestCards(fakeBot(calls), ID);

    const approval = calls.find((c) => c.route.endsWith('900000000000000002'))!;
    expect(approval.method).toBe('patch');
    expect(approval.body.components).toEqual([]);
    expect(approval.body.content).toBe('No longer waiting for approval.');
    expect(approval.body.embeds[0].fields).toContainEqual({ name: 'Status', value: 'Available', inline: true });
    expect(approval.body.allowed_mentions).toEqual({ parse: [] });
    // Decided: dropped from the list, never edited again
    expect(storedCards()).toEqual([CARDS[0]]);
  });

  it('an edit that fails keeps the approval message in the list (tried again next time)', async () => {
    seedRequest(db, { status: 'denied', discordCards: CARDS });
    const { refreshRequestCards } = await import('@/lib/services/discord/cards/discord-cards');
    await refreshRequestCards(fakeBot([], (route) => route.endsWith('900000000000000002')), ID);
    expect(storedCards()).toEqual(CARDS);
  });

  it('stored entries that are not valid card references are ignored', async () => {
    seedRequest(db, { status: 'pending', discordCards: [{ kind: 'dm', channelId: '../../guilds', messageId: '1' }, { kind: 'other' }, 'x'] });
    const calls: Call[] = [];
    const { refreshRequestCards } = await import('@/lib/services/discord/cards/discord-cards');
    await refreshRequestCards(fakeBot(calls), ID);
    expect(calls).toEqual([]);
  });
});
