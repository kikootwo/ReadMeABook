/**
 * Component: Explicit mark setting gate (#542)
 * Documentation: documentation/features/explicit-flag.md
 *
 * isExplicitMarkOn is true only in Audiobookshelf mode with the key 'true': a 'true' key left over in
 * Plex mode turns nothing on, so the routes store no mark there.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ config: {} as Record<string, string> }));

vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({
    get: async (key: string) => state.config[key] ?? null,
    getBackendMode: async () => (state.config['system.backend_mode'] as 'plex' | 'audiobookshelf') || 'plex',
  }),
}));

beforeEach(() => {
  state.config = {};
});

describe('isExplicitMarkOn', () => {
  it.each([
    ['audiobookshelf', 'true', true],
    ['audiobookshelf', 'false', false],
    ['audiobookshelf', undefined, false],
    ['plex', 'true', false],
    [undefined, 'true', false],
  ])('backend mode %s, key %s: %s', async (mode, key, expected) => {
    if (mode) state.config['system.backend_mode'] = mode;
    if (key) state.config['audiobookshelf.explicit_mark_enabled'] = key;
    const { isExplicitMarkOn } = await import('@/lib/services/audiobookshelf/explicit-flag');

    expect(await isExplicitMarkOn()).toBe(expected);
  });
});
