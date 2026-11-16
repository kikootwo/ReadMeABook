/**
 * Component: Discord Interaction Router Tests
 * Documentation: documentation/integrations/discord-bot.md
 */

import { describe, expect, it, vi } from 'vitest';
import { DISCORD_COMMANDS, routeInteraction, type RoutableInteraction } from '@/lib/services/discord/discord-interaction-router';

const GUILD = '222222222222222222';

function interaction(kind: 'command' | 'autocomplete' | 'modal' | 'button', guildId: string | null): RoutableInteraction {
  return {
    guildId,
    commandName: 'probe',
    isChatInputCommand: () => kind === 'command',
    isAutocomplete: () => kind === 'autocomplete',
    isModalSubmit: () => kind === 'modal',
  };
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

  it.each(['autocomplete', 'modal'] as const)('drops a %s with no server', async (kind) => {
    expect(await routeInteraction(interaction(kind, null), GUILD, new Map())).toBe('ignored-foreign-guild');
  });

  it('a button from a DM passes the server check; from another server it does not', async () => {
    expect(await routeInteraction(interaction('button', null), GUILD, new Map())).toBe('ignored-unhandled');
    expect(await routeInteraction(interaction('button', '333333333333333333'), GUILD, new Map())).toBe('ignored-foreign-guild');
  });

  it('an unknown command in the right server is ignored (nothing registered)', async () => {
    expect(await routeInteraction(interaction('command', GUILD), GUILD)).toBe('ignored-unhandled');
  });
});
