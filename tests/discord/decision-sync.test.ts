/**
 * Component: Discord Approval Decision Sync Tests
 * Documentation: documentation/integrations/discord-bot.md
 *
 * After an approve or deny the approval message shows the decision without buttons, the
 * cards show the status, and the requester of a request made in Discord gets a DM. With the
 * bot off, nothing Discord is loaded at all.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, resetFakeDb, seedRequest } from './approval-db-fake';

const db = vi.hoisted(() => ({ rows: new Map(), histories: [], hooks: {} }) as ReturnType<typeof createFakeDb>);
const evaluated = vi.hoisted(() => ({ decisionSync: 0 }));

vi.mock('@/lib/db', async () => (await import('./approval-db-fake')).fakePrisma(db));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

const ID = '0b6f2c1e-4d6a-4c1e-9a8b-1f2e3d4c5b6a';
const ADMIN_CHANNEL = '444444444444444442';
const DM_CHANNEL = '444444444444444443';
const CARDS = [
  { kind: 'dm', channelId: DM_CHANNEL, messageId: '900000000000000001' },
  { kind: 'approval', channelId: ADMIN_CHANNEL, messageId: '900000000000000002' },
];

type Call = { method: string; route: string; body: Record<string, any> };

function fakeBot(calls: Call[], failDm = false) {
  const rest = {
    post: vi.fn(async (route: string, { body }: { body: Record<string, any> }) => {
      calls.push({ method: 'post', route, body });
      if (route === '/users/@me/channels') {
        if (failDm) throw new Error('Cannot send messages to this user');
        return { id: DM_CHANNEL };
      }
      return { id: '900000000000000099', channel_id: route.split('/')[2] };
    }),
    patch: vi.fn(async (route: string, { body }: { body: Record<string, any> }) => {
      calls.push({ method: 'patch', route, body });
      return {};
    }),
  };
  return { getClient: () => ({ rest }) } as never;
}

describe('syncApprovalDecision', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFakeDb(db);
  });

  it('a web deny: the approval message says Denied without buttons, the card shows Denied, the requester gets a DM', async () => {
    seedRequest(db, { status: 'denied', discordCards: CARDS });
    const calls: Call[] = [];
    const { syncApprovalDecision } = await import('@/lib/services/discord/cards/discord-decision-sync');
    await syncApprovalDecision(fakeBot(calls), ID, 'denied');

    const approval = calls.find((c) => c.route === `/channels/${ADMIN_CHANNEL}/messages/900000000000000002`)!;
    expect(approval.body).toMatchObject({ content: 'Denied.', components: [], allowed_mentions: { parse: [] } });
    const card = calls.find((c) => c.route === `/channels/${DM_CHANNEL}/messages/900000000000000001`)!;
    expect(card.body.embeds[0].fields).toContainEqual({ name: 'Status', value: 'Denied', inline: true });

    expect(calls).toContainEqual({ method: 'post', route: '/users/@me/channels', body: { recipient_id: '222222222222222222' } });
    const dm = calls.find((c) => c.method === 'post' && c.route === `/channels/${DM_CHANNEL}/messages`)!;
    expect(dm.body).toEqual({ content: 'Your audiobook request for **The Book** was denied.', embeds: [], components: [], allowed_mentions: { parse: [] } });
    expect((db.rows.get(ID)!.discordCards as unknown[]).length).toBe(1);
  });

  it('an approval: the approval message says Approved, the DM says approved', async () => {
    seedRequest(db, { status: 'pending', discordCards: CARDS });
    const calls: Call[] = [];
    const { syncApprovalDecision } = await import('@/lib/services/discord/cards/discord-decision-sync');
    await syncApprovalDecision(fakeBot(calls), ID, 'approved');

    expect(calls.find((c) => c.route.endsWith('900000000000000002'))!.body.content).toBe('Approved.');
    expect(calls.find((c) => c.route === `/channels/${DM_CHANNEL}/messages`)!.body.content).toBe(
      'Your audiobook request for **The Book** was approved.'
    );
  });

  it('a request made on the web (no cards): no edit and no DM', async () => {
    seedRequest(db, { status: 'denied', discordCards: null });
    const calls: Call[] = [];
    const { syncApprovalDecision } = await import('@/lib/services/discord/cards/discord-decision-sync');
    await syncApprovalDecision(fakeBot(calls), ID, 'denied');
    expect(calls).toEqual([]);
  });

  it('a request made in Discord whose cards all failed to post still DMs the requester', async () => {
    seedRequest(db, { status: 'pending', discordCards: [] });
    const calls: Call[] = [];
    const { syncApprovalDecision } = await import('@/lib/services/discord/cards/discord-decision-sync');
    await syncApprovalDecision(fakeBot(calls), ID, 'approved');
    expect(calls.map((c) => c.route)).toEqual(['/users/@me/channels', `/channels/${DM_CHANNEL}/messages`]);
  });

  it('a requester whose link was removed gets no DM; a DM that fails never throws', async () => {
    const { REQUESTER } = await import('./approval-db-fake');
    seedRequest(db, { status: 'denied', discordCards: [] });
    const calls: Call[] = [];
    const { syncApprovalDecision } = await import('@/lib/services/discord/cards/discord-decision-sync');
    const linked = REQUESTER.discordUserId;
    try {
      Object.assign(REQUESTER, { discordUserId: null });
      await syncApprovalDecision(fakeBot(calls), ID, 'denied');
      expect(calls).toEqual([]);
    } finally {
      Object.assign(REQUESTER, { discordUserId: linked });
    }

    await expect(syncApprovalDecision(fakeBot(calls, true), ID, 'denied')).resolves.toBeUndefined();
  });
});

describe('syncDiscordApprovalDecision (facade)', () => {
  beforeEach(() => {
    vi.resetModules();
    evaluated.decisionSync = 0;
    delete (globalThis as Record<symbol, unknown>)[Symbol.for('rmab.singleton.discord-runtime')];
  });

  it('bot not running: the decision sync module is never loaded', async () => {
    vi.doMock('@/lib/services/discord/cards/discord-decision-sync', () => {
      evaluated.decisionSync++;
      return { syncApprovalDecision: vi.fn() };
    });
    const { syncDiscordApprovalDecision } = await import('@/lib/services/discord/discord-runtime');
    syncDiscordApprovalDecision(ID, 'denied');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(evaluated.decisionSync).toBe(0);
  });
});
