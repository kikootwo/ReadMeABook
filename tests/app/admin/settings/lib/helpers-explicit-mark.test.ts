/**
 * Component: Admin Settings Helpers, the Explicit mark setting (#542)
 * Documentation: documentation/features/explicit-flag.md
 *
 * The Library tab save sends explicitMarkEnabled with the Audiobookshelf settings, then revalidates
 * the cached providers response so the pages pick up the change without a reload.
 */

import { describe, expect, it, vi } from 'vitest';

const fetchWithAuthMock = vi.hoisted(() => vi.fn());
const mutateMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/utils/api', () => ({ fetchWithAuth: fetchWithAuthMock }));
vi.mock('swr', () => ({ default: vi.fn(), mutate: mutateMock }));

const settings = {
  backendMode: 'audiobookshelf',
  audibleRegion: 'us',
  audibleLanguageFilter: false,
  audiobookshelf: { serverUrl: 'http://abs', apiToken: 't', libraryId: 'lib', ebookLibraryId: '', triggerScanAfterImport: false, tagRequester: false, explicitMarkEnabled: true },
};

describe('saveTabSettings: the Explicit mark (#542)', () => {
  it('sends the setting, then revalidates /api/auth/providers', async () => {
    fetchWithAuthMock.mockResolvedValue({ ok: true });
    const { saveTabSettings } = await import('@/app/admin/settings/lib/helpers');

    await saveTabSettings('library', settings as never, [], []);

    const absCall = fetchWithAuthMock.mock.calls.find(([url]) => url === '/api/admin/settings/audiobookshelf');
    expect(JSON.parse(absCall![1].body).explicitMarkEnabled).toBe(true);
    expect(mutateMock).toHaveBeenCalledWith('/api/auth/providers');
    expect(mutateMock.mock.invocationCallOrder[0]).toBeGreaterThan(fetchWithAuthMock.mock.invocationCallOrder.at(-1)!);
  });

  it('a failed save does not revalidate', async () => {
    fetchWithAuthMock.mockReset();
    mutateMock.mockReset();
    fetchWithAuthMock.mockImplementation(async (url: string) => ({ ok: url !== '/api/admin/settings/audiobookshelf' }));
    const { saveTabSettings } = await import('@/app/admin/settings/lib/helpers');

    await expect(saveTabSettings('library', settings as never, [], [])).rejects.toThrow('Failed to save Audiobookshelf settings');
    expect(mutateMock).not.toHaveBeenCalled();
  });
});
