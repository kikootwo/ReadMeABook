/**
 * Component: Discord Bot Test Route Tests
 * Documentation: documentation/integrations/discord-bot.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { createFakeDiscordState, fakeDiscordModule, resetFakeDiscordState } from '../discord/discord-bot-mock';

const MASK = '••••••••••••';
const SAVED_TOKEN = 'saved.bot.token';
const BOT_ID = '111111111111111111';
const GUILD = '222222222222222222';
const CHANNEL = '444444444444444444';
const ROLE = '555555555555555555';

const discord = vi.hoisted(() => ({ state: null as unknown as ReturnType<typeof createFakeDiscordState> }));
const auth = vi.hoisted(() => ({ role: 'admin' as 'admin' | 'user' }));
const saved = vi.hoisted(() => ({ values: {} as Record<string, string | null> }));

vi.mock('discord.js', () => fakeDiscordModule(discord.state));
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (req: unknown, handler: (r: unknown) => unknown) => handler(req),
  requireAdmin: (_req: unknown, handler: () => unknown) =>
    auth.role === 'admin' ? handler() : NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
}));
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({
    getMany: async (keys: string[]) => Object.fromEntries(keys.map((key) => [key, saved.values[key] ?? null])),
  }),
}));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

discord.state = createFakeDiscordState();

function answerHappyPath() {
  discord.state.restGet = {
    '/users/@me': { id: BOT_ID, username: 'RMAB Bot' },
    '/users/@me/guilds': [{ id: GUILD, name: 'Book Club' }, { id: '777777777777777777', name: 'Other' }],
    [`/guilds/${GUILD}`]: { id: GUILD, name: 'Book Club' },
    [`/guilds/${GUILD}/channels`]: [{ id: CHANNEL, name: 'requests', type: 0 }],
    [`/guilds/${GUILD}/roles`]: [{ id: ROLE, name: 'Librarians' }],
  };
}

async function post(payload: unknown) {
  const { POST } = await import('@/app/api/admin/settings/test-discord/route');
  const response = await POST(
    new NextRequest('http://localhost/api/admin/settings/test-discord', {
      method: 'POST',
      headers: { authorization: 'Bearer jwt', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  );
  return { status: response.status, json: await response.json() };
}

describe('POST /api/admin/settings/test-discord', () => {
  beforeEach(() => {
    vi.resetModules();
    resetFakeDiscordState(discord.state);
    // Re-register so the factory (one evaluation of discord.js) runs again in this test
    vi.doMock('discord.js', () => fakeDiscordModule(discord.state));
    auth.role = 'admin';
    saved.values = { 'discord.bot_token': SAVED_TOKEN };
    answerHappyPath();
  });

  it('loading the route does not load discord.js', async () => {
    await import('@/app/api/admin/settings/test-discord/route');
    expect(discord.state.evaluated).toBe(0);
  });

  it('refuses a non-admin (403) without calling Discord', async () => {
    auth.role = 'user';
    const { status } = await post({ botToken: 'x' });
    expect(status).toBe(403);
    expect(discord.state.restCalls).toEqual([]);
  });

  it('returns the bot identity, server names and a pinned invite URL', async () => {
    const { status, json } = await post({ botToken: MASK, guildId: GUILD, requestChannelId: CHANNEL, adminRoleId: ROLE, adminNotifyChannelId: '' });

    expect(status).toBe(200);
    expect(json.bot).toEqual({ id: BOT_ID, username: 'RMAB Bot' });
    expect(json.guild).toEqual({ id: GUILD, name: 'Book Club' });
    expect(json.names).toEqual({ requestChannelId: 'requests', adminRoleId: 'Librarians' });
    expect(json.guilds).toEqual([{ id: GUILD, name: 'Book Club' }, { id: '777777777777777777', name: 'Other' }]);
    const invite = new URL(json.inviteUrl);
    expect(invite.origin + invite.pathname).toBe('https://discord.com/oauth2/authorize');
    expect(invite.searchParams.get('client_id')).toBe(BOT_ID);
    expect(invite.searchParams.get('permissions')).toBe('84992');
    expect(invite.searchParams.get('scope')).toBe('bot applications.commands');
    expect(invite.searchParams.get('guild_id')).toBe(GUILD);
  });

  it('uses the saved token for the mask or no token, and a typed token otherwise; never echoes it', async () => {
    const masked = await post({ botToken: MASK });
    await post({});
    const typed = await post({ botToken: ' typed.token ' });

    expect(discord.state.restTokens.every((t, i) => (i < discord.state.restTokens.length - 2 ? t === SAVED_TOKEN : t === 'typed.token'))).toBe(true);
    expect(JSON.stringify(masked.json)).not.toContain(SAVED_TOKEN);
    expect(JSON.stringify(typed.json)).not.toContain('typed.token');
  });

  it('builds every Discord path with Routes from validated IDs', async () => {
    await post({ guildId: GUILD, requestChannelId: CHANNEL });
    expect(discord.state.restCalls).toEqual(['/users/@me', '/users/@me/guilds', `/guilds/${GUILD}`, `/guilds/${GUILD}/channels`, `/guilds/${GUILD}/roles`]);
  });

  it.each([
    ['guildId', '../../users/@me'],
    ['guildId', '12345'],
    ['requestChannelId', `${CHANNEL}/messages`],
    ['adminRoleId', '0123456789012345678'],
    ['adminNotifyChannelId', 'abc'],
  ])('refuses an invalid %s (%s) with 400 before any Discord call', async (field, value) => {
    const { status } = await post({ guildId: GUILD, [field]: value });
    expect(status).toBe(400);
    expect(discord.state.restCalls).toEqual([]);
    expect(discord.state.evaluated).toBe(0);
  });

  it('no token saved or typed: 400 without calling Discord', async () => {
    saved.values = {};
    const { status } = await post({ botToken: MASK });
    expect(status).toBe(400);
    expect(discord.state.restCalls).toEqual([]);
  });

  it('a rejected token: 400 with a fixed message', async () => {
    discord.state.restGet['/users/@me'] = () => {
      throw Object.assign(new Error('401: Unauthorized'), { status: 401 });
    };
    const { status, json } = await post({ botToken: 'bad' });
    expect(status).toBe(400);
    expect(json.error).toBe('Discord rejected the bot token');
  });

  it('Discord unreachable: 502 with a fixed message (no raw error)', async () => {
    discord.state.restGet['/users/@me'] = () => {
      throw new Error('connect ECONNREFUSED 162.159.135.232:443');
    };
    const { status, json } = await post({});
    expect(status).toBe(502);
    expect(json.error).toBe('Could not reach Discord');
    expect(JSON.stringify(json)).not.toContain('ECONNREFUSED');
  });

  it('a server the bot is not in: identity still returned, with a warning', async () => {
    discord.state.restGet[`/guilds/${GUILD}`] = () => {
      throw Object.assign(new Error('Missing Access'), { status: 403 });
    };
    const { status, json } = await post({ guildId: GUILD, requestChannelId: CHANNEL });
    expect(status).toBe(200);
    expect(json.bot.id).toBe(BOT_ID);
    expect(json.guild).toBeNull();
    expect(json.warnings).toContain('The bot is not in this server yet. Use the invite link, then test again.');
  });

  it('an ID that is not in the server is reported, not guessed', async () => {
    const { json } = await post({ guildId: GUILD, requestChannelId: '888888888888888888' });
    expect(json.names).toEqual({});
    expect(json.warnings).toContain('Request channel 888888888888888888 was not found in this server.');
  });
});
