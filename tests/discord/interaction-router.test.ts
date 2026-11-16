/**
 * Component: Discord Interaction Router Tests
 * Documentation: documentation/integrations/discord-bot.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DISCORD_COMMANDS, routeInteraction, type RoutableInteraction } from '@/lib/services/discord/discord-interaction-router';

const requestHandlers = vi.hoisted(() => ({
  handleRequestCommand: vi.fn(async () => undefined),
  handleRequestComponent: vi.fn(async () => undefined),
}));
vi.mock('@/lib/services/discord/request/discord-request-handlers', () => requestHandlers);

const GUILD = '222222222222222222';
const REQUEST_ID = 'rmab:req:pick:a:abcdefghij';

type Kind = 'command' | 'autocomplete' | 'modal' | 'button' | 'select' | 'context-menu';

/** Only the kind's own check is true, like discord.js (every type guard present). */
function interaction(kind: Kind, guildId: string | null, extra: Partial<RoutableInteraction> = {}): RoutableInteraction {
  const fake = {
    guildId,
    commandName: 'probe',
    isChatInputCommand: () => kind === 'command',
    isAutocomplete: () => kind === 'autocomplete',
    isModalSubmit: () => kind === 'modal',
    isContextMenuCommand: () => kind === 'context-menu',
    isButton: () => kind === 'button',
    isAnySelectMenu: () => kind === 'select',
    ...extra,
  };
  return fake;
}

describe('Discord interaction router', () => {
  beforeEach(() => {
    requestHandlers.handleRequestCommand.mockClear();
    requestHandlers.handleRequestComponent.mockClear();
  });

  it('registers /request (type required: audiobook or ebook; query optional), server-only', () => {
    expect(DISCORD_COMMANDS.map((command) => command.name)).toEqual(['request']);
    const [request] = DISCORD_COMMANDS as Array<{ options: Array<Record<string, unknown>> }>;
    expect(request.options.map((o) => [o.name, o.required])).toEqual([['type', true], ['query', false]]);
    expect((request.options[0].choices as Array<{ value: string }>).map((c) => c.value)).toEqual(['audiobook', 'ebook']);
  });

  it('the server command carries no global-command fields (dm_permission, contexts)', () => {
    for (const command of DISCORD_COMMANDS) {
      expect(command).not.toHaveProperty('dm_permission');
      expect(command).not.toHaveProperty('contexts');
    }
  });

  it('runs a command handler only for the configured server', async () => {
    const handler = vi.fn(async () => undefined);
    const handlers = new Map([['probe', handler]]);

    expect(await routeInteraction(interaction('command', GUILD), GUILD, handlers)).toBe('handled');
    expect(await routeInteraction(interaction('command', '333333333333333333'), GUILD, handlers)).toBe('ignored-foreign-guild');
    expect(await routeInteraction(interaction('command', null), GUILD, handlers)).toBe('ignored-foreign-guild');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it.each(['autocomplete', 'modal', 'context-menu'] as const)('drops a %s with no server', async (kind) => {
    expect(await routeInteraction(interaction(kind, null, { customId: REQUEST_ID }), GUILD, new Map())).toBe('ignored-foreign-guild');
    expect(requestHandlers.handleRequestComponent).not.toHaveBeenCalled();
  });

  it.each(['button', 'select'] as const)('a %s from a DM passes the server check; from another server it does not', async (kind) => {
    expect(await routeInteraction(interaction(kind, null), GUILD, new Map())).toBe('ignored-unhandled');
    expect(await routeInteraction(interaction(kind, '333333333333333333'), GUILD, new Map())).toBe('ignored-foreign-guild');
  });

  it('an unknown command in the right server is ignored', async () => {
    expect(await routeInteraction(interaction('command', GUILD), GUILD)).toBe('ignored-unhandled');
  });

  it('/request goes to the request command handler (loaded on first use)', async () => {
    const command = interaction('command', GUILD, { commandName: 'request' });
    expect(await routeInteraction(command, GUILD)).toBe('handled');
    expect(requestHandlers.handleRequestCommand).toHaveBeenCalledWith(command);
  });

  it.each(['modal', 'button', 'select'] as const)('a %s with a /request custom id goes to the request step handler', async (kind) => {
    const step = interaction(kind, GUILD, { customId: REQUEST_ID });
    expect(await routeInteraction(step, GUILD)).toBe('handled');
    expect(requestHandlers.handleRequestComponent).toHaveBeenCalledWith(step);
  });

  it('a component with another custom id, or none, is ignored', async () => {
    expect(await routeInteraction(interaction('button', GUILD, { customId: 'other:thing' }), GUILD)).toBe('ignored-unhandled');
    expect(await routeInteraction(interaction('button', GUILD), GUILD)).toBe('ignored-unhandled');
    expect(await routeInteraction(interaction('autocomplete', GUILD, { customId: REQUEST_ID }), GUILD)).toBe('ignored-unhandled');
    expect(requestHandlers.handleRequestComponent).not.toHaveBeenCalled();
  });

  it('a command is never routed by a custom id', async () => {
    const command = interaction('command', GUILD, { commandName: 'probe', customId: REQUEST_ID });
    expect(await routeInteraction(command, GUILD)).toBe('ignored-unhandled');
    expect(requestHandlers.handleRequestComponent).not.toHaveBeenCalled();
  });
});
