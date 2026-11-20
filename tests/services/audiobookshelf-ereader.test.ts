/**
 * Component: Audiobookshelf E-Reader Devices Tests
 * Documentation: documentation/integrations/ebook-sidecar.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const configServiceMock = vi.hoisted(() => ({ get: vi.fn() }));
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configServiceMock }));

const json = (body: unknown) => ({ ok: true, json: async () => body });

describe('Audiobookshelf e-reader helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    configServiceMock.get.mockImplementation(async (key: string) =>
      ({ 'audiobookshelf.server_url': 'http://abs', 'audiobookshelf.api_token': 'token' } as Record<string, string>)[key] ?? null
    );
  });

  it("lists ABS devices, marking the ones RMAB's token user may send to", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === 'http://abs/api/emails/settings') {
        return json({
          settings: {
            ereaderDevices: [
              { name: 'Default', email: 'a@kindle.com' },
              { name: 'Mine', email: 'b@kindle.com', availabilityOption: 'specificUsers', users: ['abs-me'] },
              { name: 'Theirs', email: 'c@kindle.com', availabilityOption: 'specificUsers', users: ['abs-other'] },
              { name: 'Anyone', email: 'd@kindle.com', availabilityOption: 'guestOrUp' },
            ],
          },
        });
      }
      if (url === 'http://abs/api/me') return json({ id: 'abs-me', type: 'admin' });
      throw new Error(`unexpected ${url}`);
    });
    const { getEreaderDevices } = await import('@/lib/services/audiobookshelf/ereader');

    expect(await getEreaderDevices()).toEqual([
      { name: 'Default', email: 'a@kindle.com', sendable: true },
      { name: 'Mine', email: 'b@kindle.com', sendable: true },
      { name: 'Theirs', email: 'c@kindle.com', sendable: false },
      { name: 'Anyone', email: 'd@kindle.com', sendable: true },
    ]);
  });

  it('treats admin-only devices as unsendable for a non-admin token user', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/emails/settings')
        ? json({ settings: { ereaderDevices: [{ name: 'Default', email: 'a@kindle.com' }] } })
        : json({ id: 'abs-me', type: 'user' })
    );
    const { getEreaderDevices } = await import('@/lib/services/audiobookshelf/ereader');

    expect((await getEreaderDevices())[0].sendable).toBe(false);
  });

  it('sends the ebook and accepts the plain-text "OK" ABS answers with', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token O in JSON');
      },
    });
    const { sendEbookToDevice } = await import('@/lib/services/audiobookshelf/ereader');

    await expect(sendEbookToDevice('item-1', 'Kindle')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('http://abs/api/emails/send-ebook-to-device', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ libraryItemId: 'item-1', deviceName: 'Kindle' }),
    }));
  });

  it('throws when ABS refuses the send', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden' });
    const { sendEbookToDevice } = await import('@/lib/services/audiobookshelf/ereader');

    await expect(sendEbookToDevice('item-1', 'Kindle')).rejects.toThrow('ABS API error: 403 Forbidden');
  });
});
