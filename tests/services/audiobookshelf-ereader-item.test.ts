/**
 * Component: Audiobookshelf E-Reader Item Lookup Tests
 * Documentation: documentation/integrations/ebook-sidecar.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const configMock = vi.hoisted(() => ({ get: vi.fn() }));
const absApiMock = vi.hoisted(() => {
  class ABSApiError extends Error {
    constructor(readonly status: number, statusText: string) {
      super(`ABS API error: ${status} ${statusText}`);
    }
  }
  return { ABSApiError, getABSItem: vi.fn(), getABSLibraries: vi.fn(), searchABSItems: vi.fn() };
});

vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/audiobookshelf/api', () => absApiMock);
vi.mock('@/lib/utils/media-dir', () => ({ getMediaDir: async () => '/media/audiobooks' }));
vi.mock('@/lib/utils/delete-guard', () => ({ canonicalPath: async (p: string) => p }));

const logger = { info: vi.fn(), warn: vi.fn() };
const FOLDER = '/media/audiobooks/Ebooks/Pierce Brown/Red Rising';
const ebookFile = { metadata: { filename: 'Red Rising.epub' } };
const meta = (title = 'Red Rising', authorName = 'Pierce Brown') => ({ metadata: { title, authorName } });

/** ABS items by id, as GET /items/:id returns them */
let items: Record<string, any>;
/** Search hits per library id */
let hits: Record<string, any[]>;

function setup(config: Record<string, string> = { 'audiobookshelf.library_id': 'lib-audio' }) {
  configMock.get.mockImplementation(async (key: string) => config[key] ?? null);
  absApiMock.getABSItem.mockImplementation(async (id: string) => {
    if (!items[id]) throw new absApiMock.ABSApiError(404, 'Not Found');
    return items[id];
  });
  absApiMock.searchABSItems.mockImplementation(async (libraryId: string) =>
    (hits[libraryId] ?? []).map((libraryItem) => ({ libraryItem }))
  );
  absApiMock.getABSLibraries.mockResolvedValue([
    { id: 'lib-audio', mediaType: 'book' },
    { id: 'lib-podcasts', mediaType: 'podcast' },
    { id: 'lib-other', mediaType: 'book' },
  ]);
}

const find = async (query: { absItemId?: string | null; folder?: string | null }) => {
  const { findEbookItem } = await import('@/lib/services/audiobookshelf/ereader-item');
  return findEbookItem({ title: 'Red Rising', author: 'Pierce Brown', ...query }, logger as any);
};

describe('findEbookItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    items = {};
    hits = {};
  });

  describe('with the folder RMAB put the ebook in', () => {
    it('uses the linked item when it is at that folder and has the ebook', async () => {
      setup();
      items.linked = { id: 'linked', path: FOLDER, media: { ...meta(), ebookFile } };

      expect(await find({ absItemId: 'linked', folder: FOLDER })).toEqual({ found: true, itemId: 'linked' });
      expect(absApiMock.searchABSItems).not.toHaveBeenCalled();
    });

    it("finds the ebook library's item when the linked item is the audiobook's folder", async () => {
      setup({ 'audiobookshelf.library_id': 'lib-audio', 'audiobookshelf.ebook_library_id': 'lib-ebooks' });
      items.audio = { id: 'audio', path: '/media/audiobooks/Pierce Brown/Red Rising', media: { ...meta(), ebookFile: null } };
      items.ebook = { id: 'ebook', path: FOLDER, media: { ...meta(), ebookFile } };
      hits['lib-ebooks'] = [items.ebook];
      hits['lib-audio'] = [items.audio];

      expect(await find({ absItemId: 'audio', folder: FOLDER })).toEqual({ found: true, itemId: 'ebook' });
      expect(absApiMock.searchABSItems.mock.calls.map((c) => c[0])).toEqual(['lib-ebooks', 'lib-audio', 'lib-other']);
    });

    it('accepts an ABS path that ends with the folder relative to the media dir (another mount)', async () => {
      setup();
      items.ebook = { id: 'ebook', path: '/audiobooks/Ebooks/Pierce Brown/Red Rising', media: { ...meta(), ebookFile } };
      hits['lib-audio'] = [items.ebook];

      expect(await find({ folder: FOLDER })).toEqual({ found: true, itemId: 'ebook' });
    });

    it('searches book libraries RMAB was never told about, never podcast libraries', async () => {
      setup();
      items.ebook = { id: 'ebook', path: FOLDER, media: { ...meta(), ebookFile } };
      hits['lib-other'] = [items.ebook];

      expect(await find({ folder: FOLDER })).toEqual({ found: true, itemId: 'ebook' });
      expect(absApiMock.searchABSItems).not.toHaveBeenCalledWith('lib-podcasts', expect.anything());
    });

    it('still searches the configured libraries when ABS cannot list its libraries', async () => {
      setup();
      absApiMock.getABSLibraries.mockRejectedValue(new Error('ABS API error: 403 Forbidden'));
      items.ebook = { id: 'ebook', path: FOLDER, media: { ...meta(), ebookFile } };
      hits['lib-audio'] = [items.ebook];

      expect(await find({ folder: FOLDER })).toEqual({ found: true, itemId: 'ebook' });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/Could not list Audiobookshelf libraries/));
    });

    it('never accepts a same-titled item at another folder', async () => {
      setup();
      items.copy = { id: 'copy', path: '/media/audiobooks/Pierce Brown/Red Rising', media: { ...meta(), ebookFile } };
      hits['lib-audio'] = [items.copy];

      const result = await find({ folder: FOLDER });

      expect(result).toEqual({ found: false, reason: expect.stringMatching(/isn't in Audiobookshelf at .*Red Rising yet/) });
    });

    it('retries while the item at the folder has no ebook yet', async () => {
      setup();
      items.ebook = { id: 'ebook', path: FOLDER, media: { ...meta(), ebookFile: null } };
      hits['lib-audio'] = [items.ebook];

      expect(await find({ folder: FOLDER })).toEqual({ found: false, reason: expect.stringMatching(/has no ebook yet.*Audiobooks only/) });
    });

    it('skips a linked item ABS no longer has (404) and searches instead', async () => {
      setup();
      items.ebook = { id: 'ebook', path: FOLDER, media: { ...meta(), ebookFile } };
      hits['lib-audio'] = [items.ebook];

      expect(await find({ absItemId: 'gone', folder: FOLDER })).toEqual({ found: true, itemId: 'ebook' });
    });

    it('lets any other ABS error throw, so the job retries', async () => {
      setup();
      absApiMock.getABSItem.mockRejectedValue(new absApiMock.ABSApiError(500, 'Internal Server Error'));

      await expect(find({ absItemId: 'linked', folder: FOLDER })).rejects.toThrow(/500/);
    });
  });

  describe('without a folder', () => {
    it('uses the linked item when it has the ebook', async () => {
      setup();
      items.linked = { id: 'linked', path: '/anywhere', media: { ...meta(), ebookFile } };

      expect(await find({ absItemId: 'linked' })).toEqual({ found: true, itemId: 'linked' });
      expect(absApiMock.searchABSItems).not.toHaveBeenCalled();
    });

    it('finds an item by exact title and author in the configured libraries only', async () => {
      setup({ 'audiobookshelf.library_id': 'lib-audio', 'audiobookshelf.ebook_library_id': 'lib-ebooks' });
      items.wrong = { id: 'wrong', media: { ...meta('Red Rising', 'Someone Else'), ebookFile } };
      items.right = { id: 'right', media: { ...meta(), ebookFile } };
      hits['lib-ebooks'] = [items.wrong, items.right];

      expect(await find({ absItemId: null })).toEqual({ found: true, itemId: 'right' });
      expect(absApiMock.getABSLibraries).not.toHaveBeenCalled();
    });

    it('never settles for a fuzzy match', async () => {
      setup();
      hits['lib-audio'] = [{ id: 'sequel', media: { ...meta('Red Rising: Golden Son'), ebookFile } }];

      expect(await find({})).toEqual({ found: false, reason: expect.stringMatching(/isn't in Audiobookshelf yet/) });
    });

    it('says so when no library is configured', async () => {
      setup({});

      expect(await find({})).toEqual({ found: false, reason: expect.stringMatching(/No Audiobookshelf library is configured/) });
    });
  });
});
