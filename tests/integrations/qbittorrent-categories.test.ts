/**
 * Component: qBittorrent Category Ownership Tests
 * Documentation: documentation/phase3/qbittorrent.md
 *
 * ReadMeABook creates or re-paths only its own category; one that already existed is used in
 * Manual mode (autoTMM=false + savepath) and never touched. The owned lookup is the exact name only.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QBittorrentService } from '@/lib/integrations/qbittorrent.service';

const clientMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const axiosMock = vi.hoisted(() => ({
  create: vi.fn(() => clientMock),
  post: vi.fn(),
  get: vi.fn(),
  isAxiosError: (error: { isAxiosError?: boolean } | undefined) => Boolean(error?.isAxiosError),
}));

vi.mock('axios', () => ({ default: axiosMock, ...axiosMock }));

const MAGNET = 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567';

function service(category: string, owned?: boolean) {
  const s = new QBittorrentService('http://qb', 'user', 'pass', '/downloads', category, false, undefined, owned);
  const internals = s as unknown as { cookie: string; addMagnetLink: (...args: unknown[]) => Promise<unknown> };
  internals.cookie = 'SID=test';
  const add = vi.spyOn(internals, 'addMagnetLink').mockResolvedValue({ id: 'h', alreadyInClient: false });
  return { s, add };
}

const categoryCalls = () => clientMock.post.mock.calls
  .filter(([url]) => url === '/torrents/createCategory' || url === '/torrents/editCategory')
  .map(([url, body]) => ({ url, category: (body as URLSearchParams).get('category'), savePath: (body as URLSearchParams).get('savePath') }));

describe('qBittorrent category ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientMock.get.mockReset();
    clientMock.post.mockReset();
    clientMock.post.mockResolvedValue({ data: 'Ok.' });
  });

  it('a category that already existed is never created or edited, and the add uses Manual mode with the download folder', async () => {
    clientMock.get.mockResolvedValue({ data: { Books: { savePath: '/other' } } });
    const { s, add } = service('Books', false);

    await s.addTorrent(MAGNET);

    expect(categoryCalls()).toEqual([]);
    expect(add).toHaveBeenCalledWith(MAGNET, 'Books', undefined, '/downloads'); // savepath → autoTMM=false
  });

  it('a not-owned category deleted from the client is not re-created', async () => {
    clientMock.get.mockResolvedValue({ data: {} });
    const { s } = service('Books', false);
    await s.addTorrent(MAGNET);
    expect(categoryCalls()).toEqual([]);
  });

  it('ReadMeABook\'s own custom category is created at the download folder when missing (Automatic mode)', async () => {
    clientMock.get.mockResolvedValue({ data: {} });
    const { s, add } = service('audiobooks-rmab', true);

    await s.addTorrent(MAGNET);

    expect(categoryCalls()).toEqual([{ url: '/torrents/createCategory', category: 'audiobooks-rmab', savePath: '/downloads' }]);
    expect(add).toHaveBeenCalledWith(MAGNET, 'audiobooks-rmab', undefined, undefined);
  });

  it('an owned category matches only its exact spelling: another app\'s "AudioBooks" is never edited', async () => {
    clientMock.get.mockResolvedValue({ data: { AudioBooks: { savePath: '/old' } } });
    const { s, add } = service('audiobooks', true);

    await s.addTorrent(MAGNET);

    expect(categoryCalls()).toEqual([{ url: '/torrents/createCategory', category: 'audiobooks', savePath: '/downloads' }]);
    expect(add).toHaveBeenCalledWith(MAGNET, 'audiobooks', undefined, undefined);
  });

  it('a hand-made "ReadMeABook" is not taken over: ReadMeABook creates its own "readmeabook"', async () => {
    clientMock.get.mockResolvedValue({ data: { ReadMeABook: { savePath: '/other' } } });
    const { s } = service('readmeabook');

    await s.addTorrent(MAGNET);

    expect(categoryCalls()).toEqual([{ url: '/torrents/createCategory', category: 'readmeabook', savePath: '/downloads' }]);
  });

  it('a category list that is not a plain object is unreadable: no create or edit, the add uses Manual mode', async () => {
    for (const data of ['<html>login</html>', ['readmeabook'], null]) {
      clientMock.post.mockClear();
      clientMock.get.mockResolvedValue({ data });
      const { s, add } = service('audiobooks', true);
      await s.addTorrent(MAGNET);
      expect(categoryCalls()).toEqual([]);
      expect(add).toHaveBeenCalledWith(MAGNET, 'audiobooks', undefined, '/downloads');
      clientMock.get.mockResolvedValue({ data });
      await expect(s.getCategories()).rejects.toThrow('Failed to get qBittorrent categories: Unrecognised qBittorrent category list');
    }
  });

  it('an exact match wins over another case: the other app\'s "Books" is never edited', async () => {
    clientMock.get.mockResolvedValue({ data: { Books: { savePath: '/other' }, books: { savePath: '/old' } } });
    const { s } = service('books', true);

    await s.addTorrent(MAGNET);

    expect(categoryCalls()).toEqual([{ url: '/torrents/editCategory', category: 'books', savePath: '/downloads' }]);
  });

  it('readmeabook is always ReadMeABook\'s own (default install unchanged)', async () => {
    clientMock.get.mockResolvedValue({ data: { readmeabook: { savePath: '/downloads' } } });
    const { s, add } = service('readmeabook');

    await s.addTorrent(MAGNET);

    expect(categoryCalls()).toEqual([]);
    expect(add).toHaveBeenCalledWith(MAGNET, 'readmeabook', undefined, undefined);
  });

  it('getCategories throws when qBittorrent can\'t be read (an empty list must mean none)', async () => {
    clientMock.get.mockRejectedValueOnce(new Error('socket hang up'));
    const { s } = service('readmeabook');
    await expect(s.getCategories()).rejects.toThrow('Failed to get qBittorrent categories: socket hang up');
  });
});
