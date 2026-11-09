/**
 * Component: Audiobookshelf API Client Tests (library scan id)
 * Documentation: documentation/phase3/file-organization.md
 *
 * The library id is a saved setting placed in the scan URL: it is sent as one encoded path
 * segment, and an empty, "." or ".." id is refused before any request.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { triggerABSScan } from '@/lib/services/audiobookshelf/api';

const configServiceMock = vi.hoisted(() => ({ get: vi.fn() }));
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configServiceMock }));

describe('triggerABSScan: library id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, text: async () => 'OK' });
    vi.stubGlobal('fetch', fetchMock);
    configServiceMock.get.mockImplementation(async (key: string) => {
      if (key === 'audiobookshelf.server_url') return 'http://abs/';
      if (key === 'audiobookshelf.api_token') return 'token';
      return null;
    });
  });

  it('sends the id as one encoded path segment', async () => {
    await triggerABSScan('../users?x=1#y');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://abs/api/libraries/..%2Fusers%3Fx%3D1%23y/scan',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it.each(['', '.', '..'])('refuses id "%s" without a request', async (libraryId) => {
    await expect(triggerABSScan(libraryId)).rejects.toThrow('Invalid Audiobookshelf library id');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
