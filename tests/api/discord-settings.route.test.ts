/**
 * Component: Discord Bot Settings Route Tests
 * Documentation: documentation/integrations/discord-bot.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const MASK = '••••••••••••';
const TOKEN = 'saved.bot.token';
const GUILD = '222222222222222222';

const auth = vi.hoisted(() => ({ role: 'admin' as 'admin' | 'user' }));
const saved = vi.hoisted(() => ({ values: {} as Record<string, string | null> }));
const setManyAtomic = vi.hoisted(() => vi.fn());
const setMany = vi.hoisted(() => vi.fn());
const bot = vi.hoisted(() => ({ stop: vi.fn(), start: vi.fn(), getStatus: vi.fn() }));

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (req: unknown, handler: (r: unknown) => unknown) => handler(req),
  requireAdmin: (_req: unknown, handler: () => unknown) =>
    auth.role === 'admin' ? handler() : NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
}));
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({
    getMany: async (keys: string[]) => Object.fromEntries(keys.map((key) => [key, saved.values[key] ?? null])),
    setManyAtomic,
    setMany,
  }),
}));
vi.mock('@/lib/services/discord/discord-bot.service', () => ({ getDiscordBotService: () => bot }));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

const body = (overrides: Record<string, unknown> = {}) => ({
  enabled: true,
  botToken: MASK,
  guildId: GUILD,
  requestChannelId: '444444444444444444',
  adminRoleId: '',
  adminNotifyChannelId: '',
  ...overrides,
});

function request(method: 'GET' | 'PUT', payload?: unknown) {
  return new NextRequest('http://localhost/api/admin/settings/discord', {
    method,
    headers: { authorization: 'Bearer jwt', 'content-type': 'application/json' },
    body: payload === undefined ? undefined : typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

async function put(payload: unknown) {
  const { PUT } = await import('@/app/api/admin/settings/discord/route');
  const response = await PUT(request('PUT', payload));
  return { status: response.status, json: await response.json() };
}

async function get() {
  const { GET } = await import('@/app/api/admin/settings/discord/route');
  const response = await GET(request('GET'));
  return { status: response.status, json: await response.json() };
}

const writes = () => (setManyAtomic.mock.calls[0]?.[0] ?? []) as Array<{ key: string; value: string; encrypted?: boolean }>;
const written = (key: string) => writes().find((u) => u.key === key);

describe('/api/admin/settings/discord', () => {
  beforeEach(() => {
    auth.role = 'admin';
    saved.values = { 'discord.enabled': 'false', 'discord.bot_token': TOKEN, 'discord.guild_id': GUILD };
    setManyAtomic.mockReset().mockResolvedValue(undefined);
    setMany.mockReset();
    bot.stop.mockReset().mockResolvedValue(undefined);
    bot.start.mockReset().mockResolvedValue(undefined);
    bot.getStatus.mockReset().mockReturnValue({ state: 'stopped' });
  });

  it('refuses a non-admin (403) on GET and PUT and writes nothing', async () => {
    auth.role = 'user';
    expect((await get()).status).toBe(403);
    expect((await put(body())).status).toBe(403);
    expect(setManyAtomic).not.toHaveBeenCalled();
    expect(bot.start).not.toHaveBeenCalled();
  });

  it('GET masks the token and reports configured state and bot status', async () => {
    saved.values['discord.enabled'] = 'true';
    const { status, json } = await get();

    expect(status).toBe(200);
    expect(json.settings.botToken).toBe(MASK);
    expect(JSON.stringify(json)).not.toContain(TOKEN);
    expect(json.settings.guildId).toBe(GUILD);
    expect(json.isConfigured).toBe(true);
    expect(json.status).toEqual({ state: 'stopped' });
  });

  it('GET with no token returns an empty token and isConfigured false', async () => {
    saved.values = {};
    const { json } = await get();
    expect(json.settings.botToken).toBe('');
    expect(json.isConfigured).toBe(false);
  });

  it('stores a new token encrypted, all keys in one transaction', async () => {
    const { status, json } = await put(body({ botToken: '  new.bot.token  ' }));

    expect(status).toBe(200);
    expect(setManyAtomic).toHaveBeenCalledTimes(1);
    expect(setMany).not.toHaveBeenCalled();
    expect(written('discord.bot_token')).toMatchObject({ value: 'new.bot.token', encrypted: true });
    expect(written('discord.enabled')).toMatchObject({ value: 'true' });
    expect(written('discord.guild_id')).toMatchObject({ value: GUILD });
    expect(written('discord.request_channel_id')).toMatchObject({ value: '444444444444444444' });
    expect(writes().every((u) => u.key === 'discord.bot_token' || !u.encrypted)).toBe(true);
    expect(JSON.stringify(json)).not.toContain('new.bot.token');
  });

  it('the mask keeps the stored token (no token write)', async () => {
    const { status } = await put(body());

    expect(status).toBe(200);
    expect(written('discord.bot_token')).toBeUndefined();
  });

  it('an empty token clears it; enabling then needs a token (400)', async () => {
    expect((await put(body({ enabled: false, botToken: '' }))).status).toBe(200);
    expect(written('discord.bot_token')).toMatchObject({ value: '' });

    setManyAtomic.mockClear();
    const refused = await put(body({ enabled: true, botToken: '' }));
    expect(refused.status).toBe(400);
    expect(setManyAtomic).not.toHaveBeenCalled();
  });

  it('enabling with no server ID is refused (400)', async () => {
    const refused = await put(body({ guildId: '' }));
    expect(refused.status).toBe(400);
    expect(setManyAtomic).not.toHaveBeenCalled();
  });

  it.each([
    ['guildId', '12345'],
    ['guildId', '../users/@me'],
    ['requestChannelId', '0123456789012345678'],
    ['adminRoleId', 'role'],
    ['adminNotifyChannelId', '1234567890123456789012'],
  ])('refuses an invalid %s (%s) with 400 and writes nothing', async (field, value) => {
    const { status } = await put(body({ [field]: value }));
    expect(status).toBe(400);
    expect(setManyAtomic).not.toHaveBeenCalled();
    expect(bot.stop).not.toHaveBeenCalled();
  });

  it('refuses a body that is not JSON (400)', async () => {
    expect((await put('{not json')).status).toBe(400);
  });

  it('a failed transaction returns 500 and does not restart the bot', async () => {
    setManyAtomic.mockRejectedValue(new Error('deadlock'));
    const { status } = await put(body());
    expect(status).toBe(500);
    expect(bot.stop).not.toHaveBeenCalled();
    expect(bot.start).not.toHaveBeenCalled();
  });

  it('after saving: stops the bot, then starts it without waiting for the gateway', async () => {
    bot.start.mockReturnValue(new Promise(() => undefined));

    const started = Date.now();
    const { status } = await put(body());

    expect(status).toBe(200);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(bot.stop).toHaveBeenCalledTimes(1);
    expect(bot.start).toHaveBeenCalledTimes(1);
    expect(bot.stop.mock.invocationCallOrder[0]).toBeLessThan(bot.start.mock.invocationCallOrder[0]);
  });

  it('a failing bot start after saving does not fail the save', async () => {
    bot.start.mockRejectedValue(new Error('gateway unreachable'));
    const { status } = await put(body());
    expect(status).toBe(200);
  });
});
