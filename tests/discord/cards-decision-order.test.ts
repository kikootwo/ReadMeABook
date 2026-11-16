/**
 * Component: Discord Card Decision Order Tests
 * Documentation: documentation/integrations/discord-bot.md
 *
 * A decision made while the cards are still being posted found no cards to update: the
 * announcement applies it (the approval message shows it, the requester gets the decision DM).
 * A refresh without the decision (the approval notification's) that runs before the decision
 * sync reads the decision from the row, so the approval message never loses it. A card Discord
 * reports as deleted is dropped instead of being edited on every refresh.
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
const ADMIN_CHANNEL = '444444444444444442';
const DM_CHANNEL = '444444444444444443';

type Call = { method: 'post' | 'patch'; route: string; body: Record<string, any> };

/** `onPost` runs after each message post (to change the row while the cards are being posted). */
function fakeBot(calls: Call[], opts: { onPost?: (route: string) => void; patchError?: (route: string) => unknown } = {}) {
  let next = 900000000000000000n;
  const rest = {
    post: vi.fn(async (route: string, { body }: { body: Record<string, any> }) => {
      calls.push({ method: 'post', route, body });
      if (route === '/users/@me/channels') return { id: DM_CHANNEL };
      next += 1n;
      opts.onPost?.(route);
      return { id: String(next), channel_id: route.split('/')[2] };
    }),
    patch: vi.fn(async (route: string, { body }: { body: Record<string, any> }) => {
      calls.push({ method: 'patch', route, body });
      const error = opts.patchError?.(route);
      if (error) throw error;
      return {};
    }),
  };
  return { getClient: () => ({ rest }) } as never;
}

const config = {
  enabled: true, botToken: 't', guildId: '222222222222222222', requesterRoleId: '',
  requestChannelId: '', adminNotifyChannelId: ADMIN_CHANNEL, adminRoleId: '', requestCardMode: 'dm',
};
const storedCards = () => db.rows.get(ID)!.discordCards as Array<{ kind: string; messageId: string }>;
const approvalEdit = (calls: Call[]) => calls.find((c) => c.method === 'patch' && c.route.startsWith(`/channels/${ADMIN_CHANNEL}/`));
const decisionDm = (calls: Call[]) => calls.find((c) => c.route === `/channels/${DM_CHANNEL}/messages` && c.body.content.startsWith('Your '));

describe('a decision made while the cards are being posted', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFakeDb(db);
    configMock.mockResolvedValue(config);
  });

  it.each([
    ['approved', 'pending', 'Approved.', 'was approved'],
    ['denied', 'denied', 'Denied.', 'was denied'],
  ] as const)('%s: the approval message shows it and the requester gets the decision DM', async (_d, status, content, dm) => {
    seedRequest(db);
    const calls: Call[] = [];
    // The decision lands right after the approval message is posted, before the IDs are stored
    const bot = fakeBot(calls, { onPost: (route) => {
      if (route === `/channels/${ADMIN_CHANNEL}/messages`) db.rows.get(ID)!.status = status;
    } });
    const { announceRequest } = await import('@/lib/services/discord/cards/discord-cards');
    await announceRequest(bot, ID);

    expect(approvalEdit(calls)?.body).toMatchObject({ content, components: [] });
    expect(decisionDm(calls)?.body.content).toContain(dm);
    expect(storedCards().map((c) => c.kind)).toEqual(['dm']);
  });

  it('a library match completing it meanwhile claims no decision (no DM); a denial meanwhile still does', async () => {
    const { announceRequest } = await import('@/lib/services/discord/cards/discord-cards');
    seedRequest(db);
    const matched: Call[] = [];
    await announceRequest(fakeBot(matched, { onPost: (route) => {
      if (route !== `/channels/${ADMIN_CHANNEL}/messages`) return;
      Object.assign(db.rows.get(ID)!, { status: 'available', approvalBypassedBy: 'asin_match:awaiting_approval' });
    } }), ID);
    expect(approvalEdit(matched)?.body.content).toBe('No longer waiting for approval.');
    expect(decisionDm(matched)).toBeUndefined();

    resetFakeDb(db);
    seedRequest(db);
    const denied: Call[] = [];
    await announceRequest(fakeBot(denied, { onPost: (route) => {
      if (route === `/channels/${ADMIN_CHANNEL}/messages`) db.rows.get(ID)!.status = 'denied';
    } }), ID);
    expect(decisionDm(denied)?.body.content).toContain('was denied');
  });
});

describe('a refresh without the decision runs before the decision sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFakeDb(db);
  });

  it('the approval message still shows Approved. (and Denied. for a denial), and the requester still gets the DM', async () => {
    const { refreshRequestCards } = await import('@/lib/services/discord/cards/discord-cards');
    const { syncApprovalDecision } = await import('@/lib/services/discord/cards/discord-decision-sync');
    for (const [decision, status, content, dm] of [
      ['approved', 'pending', 'Approved.', 'was approved'],
      ['denied', 'denied', 'Denied.', 'was denied'],
    ] as const) {
      resetFakeDb(db);
      seedRequest(db, {
        status,
        discordCards: [
          { kind: 'dm', channelId: DM_CHANNEL, messageId: '900000000000000001' },
          { kind: 'approval', channelId: ADMIN_CHANNEL, messageId: '900000000000000002' },
        ],
      });
      const calls: Call[] = [];
      const bot = fakeBot(calls);
      await refreshRequestCards(bot, ID);
      await syncApprovalDecision(bot, ID, decision);

      const approvalEdits = calls.filter((c) => c.method === 'patch' && c.route.startsWith(`/channels/${ADMIN_CHANNEL}/`));
      expect(approvalEdits.map((c) => c.body.content)).toEqual([content]);
      expect(decisionDm(calls)?.body.content).toContain(dm);
    }
  });
});

describe('a card deleted in Discord', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFakeDb(db);
  });

  it('Unknown Message (10008): the card is dropped and not edited again; other failures keep it', async () => {
    const gone = { kind: 'dm', channelId: DM_CHANNEL, messageId: '900000000000000001' };
    const flaky = { kind: 'public', channelId: '444444444444444441', messageId: '900000000000000003' };
    seedRequest(db, { status: 'downloading', discordCards: [gone, flaky] });
    const unknownMessage = Object.assign(new Error('Unknown Message'), { code: 10008 });
    const patchError = (route: string) => (route.endsWith(gone.messageId) ? unknownMessage : new Error('Service unavailable'));
    const { refreshRequestCards } = await import('@/lib/services/discord/cards/discord-cards');

    await refreshRequestCards(fakeBot([], { patchError }), ID);
    expect(storedCards()).toEqual([flaky]);

    const calls: Call[] = [];
    await refreshRequestCards(fakeBot(calls, { patchError }), ID);
    expect(calls.map((c) => c.route)).toEqual([`/channels/${flaky.channelId}/messages/${flaky.messageId}`]);
  });
});
