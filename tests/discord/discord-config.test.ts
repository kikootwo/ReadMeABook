/**
 * Component: Discord Bot Settings Tests
 * Documentation: documentation/integrations/discord-bot.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const config = vi.hoisted(() => ({ values: {} as Record<string, string | null> }));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({
    getMany: async (keys: string[]) => Object.fromEntries(keys.map((key) => [key, config.values[key] ?? null])),
  }),
}));

import { DISCORD_KEYS, isDiscordConfigured, isSnowflake, loadDiscordConfig, parseCardMode } from '@/lib/services/discord/discord-config';

describe('Discord bot settings', () => {
  beforeEach(() => {
    config.values = {};
  });

  it('defaults: disabled, nothing set, request cards by DM', async () => {
    const loaded = await loadDiscordConfig();

    expect(loaded).toEqual({
      enabled: false,
      botToken: '',
      guildId: '',
      requestChannelId: '',
      adminRoleId: '',
      adminNotifyChannelId: '',
      requestCardMode: 'dm',
    });
    expect(isDiscordConfigured(loaded)).toBe(false);
  });

  it('reads every key', async () => {
    config.values = {
      [DISCORD_KEYS.enabled]: 'true',
      [DISCORD_KEYS.botToken]: 'tok',
      [DISCORD_KEYS.guildId]: '222222222222222222',
      [DISCORD_KEYS.requestChannelId]: '444444444444444444',
      [DISCORD_KEYS.adminRoleId]: '555555555555555555',
      [DISCORD_KEYS.adminNotifyChannelId]: '666666666666666666',
      [DISCORD_KEYS.requestCardMode]: 'both',
    };

    const loaded = await loadDiscordConfig();

    expect(loaded).toMatchObject({ enabled: true, botToken: 'tok', guildId: '222222222222222222', requestCardMode: 'both' });
    expect(isDiscordConfigured(loaded)).toBe(true);
  });

  it.each([
    ['enabled without a token', { enabled: true, botToken: '', guildId: '222222222222222222' }],
    ['enabled without a guild', { enabled: true, botToken: 'tok', guildId: '' }],
    ['token and guild but disabled', { enabled: false, botToken: 'tok', guildId: '222222222222222222' }],
  ])('not configured when %s', (_label, partial) => {
    expect(isDiscordConfigured({ ...partial, requestChannelId: '', adminRoleId: '', adminNotifyChannelId: '', requestCardMode: 'dm' })).toBe(false);
  });

  it.each([[null, 'dm'], ['', 'dm'], ['public', 'public'], ['both', 'both'], ['dm', 'dm'], ['everyone', 'dm']])(
    'card mode %s -> %s',
    (value, expected) => {
      expect(parseCardMode(value)).toBe(expected);
    }
  );

  it.each([
    ['222222222222222222', true],
    ['123456789012345', true],
    ['12345678901234567890', true],
    ['012345678901234567', false],
    ['12345', false],
    ['123456789012345678901', false],
    ['22222222222222222a', false],
    ['../../users/@me', false],
    ['', false],
  ])('isSnowflake(%s) = %s', (value, expected) => {
    expect(isSnowflake(value)).toBe(expected);
  });
});
