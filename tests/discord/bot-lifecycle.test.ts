/**
 * Component: Discord Bot Lifecycle Tests
 * Documentation: documentation/integrations/discord-bot.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDiscordState, fakeDiscordModule, resetFakeDiscordState, FAKE_EVENTS } from './discord-bot-mock';

const discord = vi.hoisted(() => ({ state: null as unknown as ReturnType<typeof createFakeDiscordState> }));
const config = vi.hoisted(() => ({ values: {} as Record<string, string | null> }));
const logLines = vi.hoisted(() => [] as { level: string; message: string; meta?: unknown }[]);

vi.mock('discord.js', () => fakeDiscordModule(discord.state));
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({
    getMany: async (keys: string[]) => Object.fromEntries(keys.map((key) => [key, config.values[key] ?? null])),
  }),
}));
vi.mock('@/lib/utils/logger', () => {
  const at = (level: string) => (message: string, meta?: unknown) => { logLines.push({ level, message, meta }); };
  return { RMABLogger: { create: () => ({ info: at('info'), debug: at('debug'), warn: at('warn'), error: at('error') }) } };
});

discord.state = createFakeDiscordState();

const GUILD = '222222222222222222';
const OTHER_GUILD = '333333333333333333';
const TOKEN = 'fake.bot.token';
const IGNORED_FOREIGN = 'Ignored a Discord interaction from another server';

/** A slash command from `guildId` (every type guard the router may read). */
function commandFrom(guildId: string | null, reply = vi.fn()) {
  return {
    guildId, commandName: 'request', reply,
    isChatInputCommand: () => true, isAutocomplete: () => false, isModalSubmit: () => false, isButton: () => false, isAnySelectMenu: () => false,
  };
}

function configure(values: Partial<Record<'enabled' | 'token' | 'guild', string | null>>) {
  config.values = {
    'discord.enabled': values.enabled ?? 'true',
    'discord.bot_token': values.token === undefined ? TOKEN : values.token,
    'discord.guild_id': values.guild === undefined ? GUILD : values.guild,
  };
}

async function load() {
  const mod = await import('@/lib/services/discord/discord-bot.service');
  const runtime = await import('@/lib/services/discord/discord-runtime');
  return { service: mod.getDiscordBotService(), runtime };
}

describe('Discord bot lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    resetFakeDiscordState(discord.state);
    // Re-register so the factory (one evaluation of discord.js) runs again in this test
    vi.doMock('discord.js', () => fakeDiscordModule(discord.state));
    logLines.length = 0;
    for (const key of ['discord-bot', 'discord-runtime']) delete (globalThis as Record<symbol, unknown>)[Symbol.for(`rmab.singleton.${key}`)];
    configure({});
  });

  it.each([
    ['disabled', { enabled: 'false' }],
    ['no token', { token: null }],
    ['no guild', { guild: '' }],
  ])('%s: discord.js is never loaded and nothing logs in', async (_label, values) => {
    configure(values);
    const { service, runtime } = await load();

    await service.start();

    expect(discord.state.evaluated).toBe(0);
    expect(discord.state.clients).toHaveLength(0);
    expect(service.getClient()).toBeNull();
    expect(runtime.isDiscordBotRunning()).toBe(false);
    expect(logLines.filter((l) => l.message === 'Discord bot not started')).toHaveLength(1);
  });

  it('enabled: one login with the Guilds intent only and no mentions parsed by default', async () => {
    const { service, runtime } = await load();

    await service.start();

    expect(discord.state.clients).toHaveLength(1);
    const client = discord.state.clients[0];
    expect(client.login).toHaveBeenCalledTimes(1);
    expect(client.login).toHaveBeenCalledWith(TOKEN);
    expect(client.options.intents).toEqual([1]);
    expect(client.options.allowedMentions).toEqual({ parse: [] });
    await vi.waitFor(() => expect(runtime.isDiscordBotRunning()).toBe(true));
    expect(service.getStatus()).toMatchObject({ state: 'running', botTag: 'RMAB Bot#0001' });
  });

  it('registers the current command list (empty) for the configured guild', async () => {
    const { service } = await load();

    await service.start();

    const set = discord.state.clients[0].application.commands.set;
    await vi.waitFor(() => expect(set).toHaveBeenCalledTimes(1));
    expect(set).toHaveBeenCalledWith([], GUILD);
  });

  it('listens for client error and shardError, and logs them without throwing', async () => {
    const { service } = await load();
    await service.start();
    const client = discord.state.clients[0];

    expect(client.listeners.get(FAKE_EVENTS.Error)).toHaveLength(1);
    expect(client.listeners.get(FAKE_EVENTS.ShardError)).toHaveLength(1);
    expect(() => client.emit(FAKE_EVENTS.Error, new Error('socket hang up'))).not.toThrow();
    expect(() => client.emit(FAKE_EVENTS.ShardError, new Error('gateway closed'), 0)).not.toThrow();
    expect(logLines.filter((l) => l.level === 'warn' && /Discord (client|shard) error/.test(l.message))).toHaveLength(2);
  });

  it('restart during start leaves exactly one live client', async () => {
    let releaseFirst!: () => void;
    discord.state.login = (client, token) => {
      if (discord.state.clients.length === 1) {
        return new Promise<string>((resolve) => { releaseFirst = () => resolve(token); });
      }
      client.emit(FAKE_EVENTS.ClientReady, client);
      return Promise.resolve(token);
    };
    const { service } = await load();

    const first = service.start();
    await vi.waitFor(() => expect(discord.state.clients).toHaveLength(1));
    await service.restart();
    releaseFirst();
    await first;

    expect(discord.state.clients).toHaveLength(2);
    expect(discord.state.clients[0].destroy).toHaveBeenCalled();
    expect(discord.state.clients[1].destroy).not.toHaveBeenCalled();
    expect(service.getClient()).toBe(discord.state.clients[1]);
  });

  it('a stop before discord.js finished loading creates no client', async () => {
    const { service } = await load();

    const starting = service.start();
    await service.stop();
    await starting;

    expect(discord.state.clients).toHaveLength(0);
    expect(service.getClient()).toBeNull();
  });

  it('stop destroys the client and clears the running flag', async () => {
    const { service, runtime } = await load();
    await service.start();
    await vi.waitFor(() => expect(runtime.isDiscordBotRunning()).toBe(true));

    await service.stop();

    expect(discord.state.clients[0].destroy).toHaveBeenCalledTimes(1);
    expect(service.getClient()).toBeNull();
    expect(runtime.isDiscordBotRunning()).toBe(false);
    expect(service.getStatus().state).toBe('stopped');
  });

  it('a rejected login is logged, leaves no client and does not throw', async () => {
    discord.state.login = () => Promise.reject(new Error('An invalid token was provided.'));
    const { service, runtime } = await load();

    await expect(service.start()).resolves.toBeUndefined();

    expect(service.getClient()).toBeNull();
    expect(runtime.isDiscordBotRunning()).toBe(false);
    expect(discord.state.clients[0].destroy).toHaveBeenCalled();
    expect(service.getStatus()).toMatchObject({ state: 'failed' });
    const failure = logLines.find((l) => l.message === 'Failed to start the Discord bot');
    expect(failure?.level).toBe('error');
    expect(JSON.stringify(logLines)).not.toContain(TOKEN);
  });

  it('ignores an interaction from another guild (and a command with no guild)', async () => {
    const { service } = await load();
    await service.start();
    const client = discord.state.clients[0];
    const reply = vi.fn();
    const foreign = commandFrom(OTHER_GUILD, reply);
    const noGuild = commandFrom(null, reply);

    client.emit(FAKE_EVENTS.InteractionCreate, foreign);
    client.emit(FAKE_EVENTS.InteractionCreate, noGuild);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(reply).not.toHaveBeenCalled();
    expect(logLines.filter((l) => l.message === IGNORED_FOREIGN)).toHaveLength(2);
  });

  it('a second start with no stop between destroys the first client; the old client is ignored', async () => {
    const { service, runtime } = await load();
    await service.start();
    const [first] = discord.state.clients;
    await vi.waitFor(() => expect(runtime.isDiscordBotRunning()).toBe(true));

    await service.start();

    expect(discord.state.clients).toHaveLength(2);
    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(discord.state.clients[1].destroy).not.toHaveBeenCalled();
    expect(service.getClient()).toBe(discord.state.clients[1]);
    first.emit(FAKE_EVENTS.InteractionCreate, commandFrom(OTHER_GUILD));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(logLines.filter((l) => l.message === IGNORED_FOREIGN)).toHaveLength(0);
  });

  it.each([
    ['invalidated', FAKE_EVENTS.Invalidated, [] as unknown[], 'Discord ended the session'],
    ['a shard closed for good (4004)', FAKE_EVENTS.ShardDisconnect, [{ code: 4004 }, 0], 'Gateway closed (code 4004)'],
  ])('%s: status failed, not running, client destroyed, no retry', async (_label, event, args, reason) => {
    const { service, runtime } = await load();
    await service.start();
    await vi.waitFor(() => expect(runtime.isDiscordBotRunning()).toBe(true));
    const client = discord.state.clients[0];

    client.emit(event, ...args);

    expect(service.getStatus()).toEqual({ state: 'failed', lastError: reason });
    expect(runtime.isDiscordBotRunning()).toBe(false);
    expect(service.getClient()).toBeNull();
    await vi.waitFor(() => expect(client.destroy).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(discord.state.clients).toHaveLength(1);
    expect(JSON.stringify(logLines)).not.toContain(TOKEN);
  });

  it('the shutdown coordinator reaches stop() through the peeked state, without loading discord.js', async () => {
    configure({ enabled: 'false' });
    const { service } = await load();
    await service.start();
    const { peekProcessSingleton } = await import('@/lib/utils/process-singleton');
    const { DISCORD_BOT_SINGLETON_KEY } = await import('@/lib/constants/shutdown');

    await peekProcessSingleton<{ stop(): Promise<void> }>(DISCORD_BOT_SINGLETON_KEY)!.stop();

    expect(discord.state.evaluated).toBe(0);
    expect(service.getStatus().state).toBe('stopped');
  });

  it('the peeked stop() disconnects a running bot', async () => {
    const { service, runtime } = await load();
    await service.start();
    await vi.waitFor(() => expect(runtime.isDiscordBotRunning()).toBe(true));
    const { peekProcessSingleton } = await import('@/lib/utils/process-singleton');

    await peekProcessSingleton<{ stop(): Promise<void> }>('discord-bot')!.stop();

    expect(discord.state.clients[0].destroy).toHaveBeenCalledTimes(1);
    expect(runtime.isDiscordBotRunning()).toBe(false);
  });

  it('loads discord.js once for several starts', async () => {
    const { service } = await load();
    await service.start();
    await service.restart();
    await service.restart();

    expect(discord.state.evaluated).toBe(1);
    expect(discord.state.clients).toHaveLength(3);
  });
});
