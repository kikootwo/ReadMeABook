/**
 * Component: Audiobookshelf API Client Tests
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  absRequest,
  addABSItemTags,
  deleteABSItem,
  formatRequesterTag,
  getABSLibraries,
  getABSLibraryItems,
  getABSRecentItems,
  getABSServerInfo,
  searchABSItems,
  triggerABSItemMatch,
  triggerABSScan,
} from '@/lib/services/audiobookshelf/api';

const configServiceMock = vi.hoisted(() => ({
  get: vi.fn(),
  getAudibleRegion: vi.fn(),
}));

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configServiceMock,
}));

describe('Audiobookshelf API client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configServiceMock.get.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('throws when Audiobookshelf config is missing', async () => {
    configServiceMock.get.mockResolvedValue(null);

    await expect(absRequest('/status')).rejects.toThrow('Audiobookshelf not configured');
  });

  it('returns parsed JSON for successful requests', async () => {
    configServiceMock.get.mockImplementation(async (key: string) => {
      if (key === 'audiobookshelf.server_url') return 'http://abs';
      if (key === 'audiobookshelf.api_token') return 'token';
      return null;
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ version: '2.0.0', name: 'ABS' }),
    });

    const info = await getABSServerInfo();

    expect(info).toEqual({ version: '2.0.0', name: 'ABS' });
    expect(fetchMock).toHaveBeenCalledWith('http://abs/api/status', expect.any(Object));
  });

  it('throws when ABS responds with an error status', async () => {
    configServiceMock.get.mockImplementation(async (key: string) => {
      if (key === 'audiobookshelf.server_url') return 'http://abs';
      if (key === 'audiobookshelf.api_token') return 'token';
      return null;
    });
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });

    await expect(absRequest('/status')).rejects.toThrow('ABS API error: 401 Unauthorized');
  });

  it('maps library responses and search queries', async () => {
    configServiceMock.get.mockImplementation(async (key: string) => {
      if (key === 'audiobookshelf.server_url') return 'http://abs';
      if (key === 'audiobookshelf.api_token') return 'token';
      return null;
    });

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ libraries: [{ id: 'lib-1' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ id: 'item-1' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ id: 'recent-1' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ book: [{ id: 'result-1' }] }),
      });

    expect(await getABSLibraries()).toEqual([{ id: 'lib-1' }]);
    expect(await getABSLibraryItems('lib-1')).toEqual([{ id: 'item-1' }]);
    expect(await getABSRecentItems('lib-1', 5)).toEqual([{ id: 'recent-1' }]);
    expect(await searchABSItems('lib-1', 'hello world')).toEqual([{ id: 'result-1' }]);

    expect(fetchMock.mock.calls[1][0]).toBe('http://abs/api/libraries/lib-1/items');
    expect(fetchMock.mock.calls[2][0]).toBe('http://abs/api/libraries/lib-1/items?sort=addedAt&desc=1&limit=5');
    expect(fetchMock.mock.calls[3][0]).toBe('http://abs/api/libraries/lib-1/search?q=hello%20world');
  });

  it('returns an empty array when search results are missing', async () => {
    configServiceMock.get.mockImplementation(async (key: string) => {
      if (key === 'audiobookshelf.server_url') return 'http://abs';
      if (key === 'audiobookshelf.api_token') return 'token';
      return null;
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    expect(await searchABSItems('lib-1', 'missing')).toEqual([]);
  });

  it('triggers library scan using plain text responses', async () => {
    configServiceMock.get.mockImplementation(async (key: string) => {
      if (key === 'audiobookshelf.server_url') return 'http://abs';
      if (key === 'audiobookshelf.api_token') return 'token';
      return null;
    });
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => 'OK',
    });

    await triggerABSScan('lib-1');

    expect(fetchMock).toHaveBeenCalledWith('http://abs/api/libraries/lib-1/scan', expect.objectContaining({
      method: 'POST',
    }));
  });

  it('includes ASIN overrides in metadata match requests with US region', async () => {
    configServiceMock.get.mockImplementation(async (key: string) => {
      if (key === 'audiobookshelf.server_url') return 'http://abs';
      if (key === 'audiobookshelf.api_token') return 'token';
      return null;
    });
    configServiceMock.getAudibleRegion.mockResolvedValue('us');
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    await triggerABSItemMatch('item-1', 'ASIN123');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({
      provider: 'audible', // US uses 'audible'
      asin: 'ASIN123',
      overrideDefaults: true,
    });
  });

  it('uses region-specific provider for Canada', async () => {
    configServiceMock.get.mockImplementation(async (key: string) => {
      if (key === 'audiobookshelf.server_url') return 'http://abs';
      if (key === 'audiobookshelf.api_token') return 'token';
      return null;
    });
    configServiceMock.getAudibleRegion.mockResolvedValue('ca');
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    await triggerABSItemMatch('item-1', 'ASIN123');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({
      provider: 'audible.ca',
      asin: 'ASIN123',
      overrideDefaults: true,
    });
  });

  it('uses region-specific provider for UK', async () => {
    configServiceMock.get.mockImplementation(async (key: string) => {
      if (key === 'audiobookshelf.server_url') return 'http://abs';
      if (key === 'audiobookshelf.api_token') return 'token';
      return null;
    });
    configServiceMock.getAudibleRegion.mockResolvedValue('uk');
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    await triggerABSItemMatch('item-1');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({
      provider: 'audible.uk',
    });
  });

  it('uses region-specific provider for Australia', async () => {
    configServiceMock.get.mockImplementation(async (key: string) => {
      if (key === 'audiobookshelf.server_url') return 'http://abs';
      if (key === 'audiobookshelf.api_token') return 'token';
      return null;
    });
    configServiceMock.getAudibleRegion.mockResolvedValue('au');
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    await triggerABSItemMatch('item-1', 'ASIN456');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({
      provider: 'audible.au',
      asin: 'ASIN456',
      overrideDefaults: true,
    });
  });

  it('uses region-specific provider for India', async () => {
    configServiceMock.get.mockImplementation(async (key: string) => {
      if (key === 'audiobookshelf.server_url') return 'http://abs';
      if (key === 'audiobookshelf.api_token') return 'token';
      return null;
    });
    configServiceMock.getAudibleRegion.mockResolvedValue('in');
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    await triggerABSItemMatch('item-1', 'ASIN789');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({
      provider: 'audible.in',
      asin: 'ASIN789',
      overrideDefaults: true,
    });
  });

  it('suppresses errors when metadata match fails', async () => {
    configServiceMock.get.mockImplementation(async (key: string) => {
      if (key === 'audiobookshelf.server_url') return 'http://abs';
      if (key === 'audiobookshelf.api_token') return 'token';
      return null;
    });
    configServiceMock.getAudibleRegion.mockResolvedValue('us');
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Boom',
    });

    await expect(triggerABSItemMatch('item-1', 'ASIN123')).resolves.toBeUndefined();
  });

  it('deletes a library item successfully', async () => {
    configServiceMock.get.mockImplementation(async (key: string) => {
      if (key === 'audiobookshelf.server_url') return 'http://abs';
      if (key === 'audiobookshelf.api_token') return 'token';
      return null;
    });
    fetchMock.mockResolvedValue({
      ok: true,
    });

    await expect(deleteABSItem('item-1')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('http://abs/api/items/item-1?hard=1', {
      method: 'DELETE',
      headers: {
        'Authorization': 'Bearer token',
      },
    });
  });

  it('throws when delete fails', async () => {
    configServiceMock.get.mockImplementation(async (key: string) => {
      if (key === 'audiobookshelf.server_url') return 'http://abs';
      if (key === 'audiobookshelf.api_token') return 'token';
      return null;
    });
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Boom',
    });

    await expect(deleteABSItem('item-1')).rejects.toThrow('ABS API error: 500 Boom');
  });

  it('formats requester tags by sanitizing the username', () => {
    expect(formatRequesterTag('John Smith')).toBe('req:john_smith');
    expect(formatRequesterTag('  Jane.Doe!  ')).toBe('req:janedoe');
    expect(formatRequesterTag('user-123_ok')).toBe('req:user-123_ok');
    expect(formatRequesterTag('ALLCAPS')).toBe('req:allcaps');
  });

  it('returns an empty string when the username sanitizes to nothing', () => {
    // All-symbol and non-Latin usernames strip down to nothing — must NOT
    // collapse onto a shared bare `req:` tag.
    expect(formatRequesterTag('!!!')).toBe('');
    expect(formatRequesterTag('   ')).toBe('');
    expect(formatRequesterTag('李雷')).toBe('');
    expect(formatRequesterTag('')).toBe('');
  });

  it('does not write when all tags are empty/blank', async () => {
    configServiceMock.get.mockImplementation(async (key: string) => {
      if (key === 'audiobookshelf.server_url') return 'http://abs';
      if (key === 'audiobookshelf.api_token') return 'token';
      return null;
    });

    await addABSItemTags('item-1', ['', '   ']);

    // Never even fetches the item — nothing usable to add.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('merges new tags with existing ABS item tags via PATCH', async () => {
    configServiceMock.get.mockImplementation(async (key: string) => {
      if (key === 'audiobookshelf.server_url') return 'http://abs';
      if (key === 'audiobookshelf.api_token') return 'token';
      return null;
    });
    // First call: GET item with existing tags. Second call: PATCH media.
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ media: { tags: ['nsfw', 'req:other'] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

    await addABSItemTags('item-1', ['req:john']);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const patchCall = fetchMock.mock.calls[1];
    expect(patchCall[0]).toBe('http://abs/api/items/item-1/media');
    expect(patchCall[1].method).toBe('PATCH');
    expect(JSON.parse(patchCall[1].body)).toEqual({
      tags: ['nsfw', 'req:other', 'req:john'],
    });
  });

  it('skips the PATCH when all tags already exist', async () => {
    configServiceMock.get.mockImplementation(async (key: string) => {
      if (key === 'audiobookshelf.server_url') return 'http://abs';
      if (key === 'audiobookshelf.api_token') return 'token';
      return null;
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ media: { tags: ['req:john'] } }),
    });

    await addABSItemTags('item-1', ['req:john']);

    // Only the GET happened, no PATCH
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('suppresses errors when tagging fails', async () => {
    configServiceMock.get.mockImplementation(async (key: string) => {
      if (key === 'audiobookshelf.server_url') return 'http://abs';
      if (key === 'audiobookshelf.api_token') return 'token';
      return null;
    });
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Boom',
    });

    await expect(addABSItemTags('item-1', ['req:john'])).resolves.toBeUndefined();
  });
});
