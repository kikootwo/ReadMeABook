/**
 * Component: Discord Bot Test Doubles (shared by the discord tests)
 * Documentation: documentation/integrations/discord-bot.md
 *
 * A fake `discord.js` module: a Client class that records construction, listeners,
 * login, command registration and destroy, plus REST/Routes fakes for the test route.
 * Use from a vi.mock factory: `vi.mock('discord.js', () => fakeDiscordModule(state))`.
 */

import { vi } from 'vitest';

type Listener = (...args: unknown[]) => unknown;

export interface FakeDiscordState {
  /** Times the fake module factory ran (each one is an evaluation of `discord.js`). */
  evaluated: number;
  clients: FakeClient[];
  /** Replaces login; default resolves and emits clientReady. */
  login?: (client: FakeClient, token: string) => Promise<string>;
  /** REST GET answers keyed by route path; a function may throw. */
  restGet: Record<string, unknown | ((path: string) => unknown)>;
  restCalls: string[];
  restTokens: string[];
  restOptions: Record<string, unknown>[];
}

export interface FakeClient {
  options: Record<string, unknown>;
  listeners: Map<string, Listener[]>;
  login: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  application: { commands: { set: ReturnType<typeof vi.fn> } };
  user: { id: string; tag: string };
  emit(event: string, ...args: unknown[]): void;
}

export function createFakeDiscordState(): FakeDiscordState {
  return { evaluated: 0, clients: [], restGet: {}, restCalls: [], restTokens: [], restOptions: [] };
}

export function resetFakeDiscordState(state: FakeDiscordState): void {
  state.evaluated = 0;
  state.clients.length = 0;
  state.login = undefined;
  state.restGet = {};
  state.restCalls.length = 0;
  state.restTokens.length = 0;
  state.restOptions.length = 0;
}

export const FAKE_EVENTS = {
  ClientReady: 'clientReady',
  InteractionCreate: 'interactionCreate',
  Error: 'error',
  ShardError: 'shardError',
  ShardDisconnect: 'shardDisconnect',
};

export function fakeDiscordModule(state: FakeDiscordState) {
  state.evaluated++;

  class Client implements FakeClient {
    options: Record<string, unknown>;
    listeners = new Map<string, Listener[]>();
    application = { commands: { set: vi.fn(async () => new Map()) } };
    user = { id: '111111111111111111', tag: 'RMAB Bot#0001' };
    login = vi.fn(async (token: string) => {
      if (state.login) return state.login(this, token);
      this.emit(FAKE_EVENTS.ClientReady, this);
      return token;
    });
    destroy = vi.fn(async () => undefined);

    constructor(options: Record<string, unknown>) {
      this.options = options;
      state.clients.push(this);
    }

    on(event: string, listener: Listener) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
      return this;
    }

    once(event: string, listener: Listener) {
      return this.on(event, listener);
    }

    emit(event: string, ...args: unknown[]) {
      for (const listener of this.listeners.get(event) ?? []) void listener(...args);
    }
  }

  class REST {
    private token = '';
    constructor(public options: Record<string, unknown> = {}) {
      state.restOptions.push(options);
    }
    setToken(token: string) {
      this.token = token;
      return this;
    }
    async get(path: string) {
      state.restCalls.push(path);
      state.restTokens.push(this.token);
      const answer = state.restGet[path];
      if (typeof answer === 'function') return (answer as (p: string) => unknown)(path);
      if (answer === undefined) throw Object.assign(new Error('Unknown route'), { status: 404 });
      return answer;
    }
  }

  // Same shapes as discord-api-types' Routes (paths without the /api/v10 prefix)
  const Routes = {
    user: (id = '@me') => `/users/${id}`,
    userGuilds: () => '/users/@me/guilds',
    guild: (id: string) => `/guilds/${id}`,
    guildChannels: (id: string) => `/guilds/${id}/channels`,
    guildRoles: (id: string) => `/guilds/${id}/roles`,
  };

  class DiscordAPIError extends Error {
    constructor(public status: number, message = 'Discord API error') {
      super(message);
    }
  }

  /** What @discordjs/rest throws on a 429 when rejectOnRateLimit says so. */
  class RateLimitError extends Error {
    constructor(public route = '/users/@me') {
      super('Rate limited');
    }
  }

  return {
    Client,
    REST,
    RateLimitError,
    Routes,
    DiscordAPIError,
    Events: FAKE_EVENTS,
    GatewayIntentBits: { Guilds: 1, GuildMembers: 2, GuildMessages: 512, MessageContent: 32768 },
  };
}
