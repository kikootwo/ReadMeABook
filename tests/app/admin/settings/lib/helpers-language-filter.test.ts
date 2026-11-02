/**
 * Component: Admin Settings Save, Audible Language Filter (#259)
 * Documentation: documentation/integrations/audible-language-filter.md
 */

// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '@/app/admin/settings/lib/types';

const fetchWithAuthMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/utils/api', () => ({
  fetchWithAuth: fetchWithAuthMock,
}));

describe('saveTabSettings (library tab)', () => {
  it.each([true, false])('sends languageFilter %s with the Audible region', async (languageFilter) => {
    fetchWithAuthMock.mockResolvedValue({ ok: true });
    const settings = { backendMode: 'plex', audibleRegion: 'de', audibleLanguageFilter: languageFilter, plex: {} } as unknown as Settings;

    const { saveTabSettings } = await import('@/app/admin/settings/lib/helpers');
    await saveTabSettings('library', settings, [], []);

    const [, init] = fetchWithAuthMock.mock.calls.find(([url]: [string]) => url === '/api/admin/settings/audible');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ region: 'de', languageFilter });
  });
});
