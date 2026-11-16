/**
 * Component: Discord Interaction Router Tests
 * Documentation: documentation/integrations/discord-bot.md
 */

import { describe, expect, it, vi } from 'vitest';
import { DISCORD_COMMANDS, routeInteraction, type RoutableInteraction } from '@/lib/services/discord/discord-interaction-router';

const GUILD = '222222222222222222';

type Kind = 'command' | 'autocomplete' | 'modal' | 'button' | 'select' | 'context-menu';

/** Only the kind's own check is true, like discord.js (every type guard present). */
function interaction(kind: Kind, guildId: string | null): RoutableInteraction {
  const fake = {
    guildId,
    commandName: 'probe',
    isChatInputCommand: () => kind === 'command',
    isAutocomplete: () => kind === 'autocomplete',
    isModalSubmit: () => kind === 'modal',
    isContextMenuCommand: () => kind === 'context-menu',
    isButton: () => kind === 'button',
    isAnySelectMenu: () => kind === 'select',
  };
  return fake;
}

describe('Discord interaction router', () => {
  it('registers no commands yet', () => {
    expect(DISCORD_COMMANDS).toEqual([]);
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
    expect(await routeInteraction(interaction(kind, null), GUILD, new Map())).toBe('ignored-foreign-guild');
  });

  it.each(['button', 'select'] as const)('a %s from a DM passes the server check; from another server it does not', async (kind) => {
    expect(await routeInteraction(interaction(kind, null), GUILD, new Map())).toBe('ignored-unhandled');
    expect(await routeInteraction(interaction(kind, '333333333333333333'), GUILD, new Map())).toBe('ignored-foreign-guild');
  });

  it('an unknown command in the right server is ignored (nothing registered)', async () => {
    expect(await routeInteraction(interaction('command', GUILD), GUILD)).toBe('ignored-unhandled');
  });
});
