/**
 * Component: Discord Bot Service lifecycle tests
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Covers start/stop/restart ordering. The gateway client is only assigned after login() resolves,
 * so anything that tears down mid-login has to be explicitly handled or a settings save silently
 * fails to apply.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Every Client the service constructs, in order. */
const created = vi.hoisted(() => [] as any[]);
/** One entry per login() call, each resolvable on demand so a start can be held mid-flight. */
const logins = vi.hoisted(() => [] as { token: string; resolve: () => void }[]);

const configMock = vi.hoisted(() => ({
  getDiscordConfig: vi.fn(),
  isDiscordBotConfigured: vi.fn(() => true),
}));

vi.mock('discord.js', () => {
  class Client {
    handlers: Record<string, (...args: any[]) => unknown> = {};
    destroy = vi.fn(() => Promise.resolve());
    user = { id: 'app-1', tag: 'bot#0001' };
    constructor() {
      created.push(this);
    }
    once(event: string, cb: (...args: any[]) => unknown) {
      this.handlers[event] = cb;
    }
    on(event: string, cb: (...args: any[]) => unknown) {
      this.handlers[event] = cb;
    }
    login(token: string) {
      return new Promise<void>((resolve) => logins.push({ token, resolve: () => resolve() }));
    }
  }
  return {
    Client,
    Events: {
      ClientReady: 'ready',
      InteractionCreate: 'interactionCreate',
      Error: 'error',
      ShardDisconnect: 'shardDisconnect',
      ShardReconnecting: 'shardReconnecting',
      ShardResume: 'shardResume',
    },
    GatewayIntentBits: { Guilds: 1, GuildMembers: 2 },
    Partials: { Channel: 'channel' },
    REST: class {
      setToken() {
        return this;
      }
      put() {
        return Promise.resolve();
      }
    },
    Routes: { applicationGuildCommands: () => 'route' },
  };
});

vi.mock('@/lib/services/discord/discord-config', () => configMock);
vi.mock('@/lib/services/discord/interaction-router', () => ({ routeInteraction: vi.fn() }));
vi.mock('@/lib/services/discord/command-definitions', () => ({
  buildCommandDefinitions: () => [],
}));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: {
    create: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

const loadService = async () => {
  vi.resetModules();
  const mod = await import('@/lib/services/discord/discord-bot.service');
  return mod.getDiscordBotService();
};

const awaitLogins = (n: number) => vi.waitFor(() => expect(logins.length).toBe(n));

describe('DiscordBotService lifecycle', () => {
  beforeEach(() => {
    created.length = 0;
    logins.length = 0;
    vi.clearAllMocks();
    configMock.isDiscordBotConfigured.mockReturnValue(true);
  });

  it('applies the new config when restart() races an in-flight start', async () => {
    configMock.getDiscordConfig
      .mockResolvedValueOnce({ botToken: 'old-token', guildId: 'g1' })
      .mockResolvedValueOnce({ botToken: 'new-token', guildId: 'g1' });

    const service = await loadService();

    // Start is mid-login: `client` is still null, so a naive stop() would find nothing to destroy.
    const starting = service.start();
    await awaitLogins(1);
    expect(logins[0].token).toBe('old-token');

    const restarting = service.restart();
    logins[0].resolve();
    await starting;

    // The restart must actually reconnect rather than no-op on the in-flight guard.
    await awaitLogins(2);
    logins[1].resolve();
    await restarting;

    expect(logins[1].token).toBe('new-token');
    expect(created).toHaveLength(2);
    expect(created[0].destroy).toHaveBeenCalled();
  });

  it('discards a connection whose start was superseded by stop()', async () => {
    configMock.getDiscordConfig.mockResolvedValue({ botToken: 'old-token', guildId: 'g1' });

    const service = await loadService();
    const starting = service.start();
    await awaitLogins(1);

    const stopping = service.stop();
    logins[0].resolve();
    await Promise.all([starting, stopping]);

    // The late-arriving client must tear itself down rather than becoming the live one.
    expect(created[0].destroy).toHaveBeenCalled();
    expect(service.getClient()).toBeNull();
    expect(service.isReady()).toBe(false);
  });

  it('does not flip to ready when a superseded client emits ready', async () => {
    configMock.getDiscordConfig.mockResolvedValue({ botToken: 'old-token', guildId: 'g1' });

    const service = await loadService();
    const starting = service.start();
    await awaitLogins(1);

    await service.stop();
    logins[0].resolve();
    await starting;

    await created[0].handlers['ready']?.({ user: { id: 'app-1', tag: 'bot#0001' } });

    expect(service.isReady()).toBe(false);
  });

  it('joins an in-flight start instead of opening a second connection', async () => {
    configMock.getDiscordConfig.mockResolvedValue({ botToken: 'tok', guildId: 'g1' });

    const service = await loadService();
    const first = service.start();
    const second = service.start();
    await awaitLogins(1);
    logins[0].resolve();
    await Promise.all([first, second]);

    expect(created).toHaveLength(1);
  });
});
