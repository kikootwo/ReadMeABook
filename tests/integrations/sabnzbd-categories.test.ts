/**
 * Component: SABnzbd Category Tests (list parsing, ownership, #579)
 * Documentation: documentation/phase3/sabnzbd.md
 *
 * Real SABnzbd 4.x answers get_config `categories` as an array with `*` first. Reading it as an
 * object made every category look missing, so set_config ran on every grab (#579).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SABnzbdService } from '@/lib/integrations/sabnzbd.service';
import { parseSabCategories, sabCategoryFolder } from '@/lib/integrations/sabnzbd-categories';

const clientMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const axiosMock = vi.hoisted(() => ({ create: vi.fn(() => clientMock), get: vi.fn(), isAxiosError: vi.fn(() => false) }));
vi.mock('axios', () => ({ default: axiosMock, ...axiosMock }));

/** get_config as real SABnzbd 4.x returns it */
const realConfig = (categories: unknown) => ({
  data: { config: { version: '4.3.2', misc: { complete_dir: '/data/complete' }, categories } },
});
const sabArray = (...extra: Array<{ name: string; dir: string }>) => [
  { name: '*', order: 0, pp: '3', script: 'None', dir: '', newzbin: '', priority: 0 },
  ...extra.map((c, i) => ({ order: i + 1, pp: '', script: 'Default', newzbin: '', priority: -100, ...c })),
];
const setConfigCalls = () => clientMock.get.mock.calls.filter(([, opts]) => opts?.params?.mode === 'set_config');

describe('SABnzbd categories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientMock.get.mockReset();
  });

  describe('parseSabCategories', () => {
    it('reads the array form by name, and keeps the object form as a fallback', () => {
      expect(parseSabCategories(sabArray({ name: 'books', dir: 'books' }))).toEqual([
        { name: '*', dir: '' },
        { name: 'books', dir: 'books' },
      ]);
      expect(parseSabCategories({ '*': { dir: '' }, readmeabook: { dir: '' } })).toEqual([{ name: '*', dir: '' }, { name: 'readmeabook', dir: '' }]);
    });

    it('throws on an array or object without "*" or an unrecognised shape (fails closed)', () => {
      expect(() => parseSabCategories([{ name: 'books', dir: '' }])).toThrow(/no "\*"/);
      expect(() => parseSabCategories({ readmeabook: { dir: '' } })).toThrow(/no "\*"/);
      expect(() => parseSabCategories({})).toThrow(/no "\*"/);
      expect(() => parseSabCategories([{ dir: 'x' }])).toThrow('Unrecognised SABnzbd category list');
      expect(() => parseSabCategories('books')).toThrow('Unrecognised SABnzbd category list');
      expect(() => parseSabCategories(undefined)).toThrow('Unrecognised SABnzbd category list');
    });
  });

  describe('sabCategoryFolder', () => {
    const cats = sabArray({ name: 'books', dir: 'other-app' }, { name: 'flat', dir: 'flat*' }, { name: 'abs', dir: '/srv/abs' }, { name: 'root', dir: '' });
    it('is the category dir under complete_dir, an absolute dir as is, or complete_dir itself', () => {
      const parsed = parseSabCategories(cats);
      expect(sabCategoryFolder('/downloads/', parsed, 'Books')).toBe('/downloads/other-app');
      expect(sabCategoryFolder('/downloads', parsed, 'flat')).toBe('/downloads/flat'); // `*` only turns off job folders
      expect(sabCategoryFolder('/downloads', parsed, 'abs')).toBe('/srv/abs');
      expect(sabCategoryFolder('/downloads', parsed, 'root')).toBe('/downloads');
    });
    it('is null for a category SABnzbd does not list, or an unknown complete_dir', () => {
      const parsed = parseSabCategories(cats);
      expect(sabCategoryFolder('/downloads', parsed, 'movies')).toBeNull();
      expect(sabCategoryFolder('', parsed, 'books')).toBeNull();
    });
    it('getCategoryFolder reads SABnzbd and throws when it cannot', async () => {
      const service = new SABnzbdService('http://sab', 'key');
      clientMock.get.mockResolvedValueOnce(realConfig(cats));
      expect(await service.getCategoryFolder('books')).toBe('/data/complete/other-app');
      clientMock.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await expect(service.getCategoryFolder('books')).rejects.toThrow('ECONNREFUSED');
    });
  });

  describe('getCategories', () => {
    it('returns the names from the array form with "*" left out', async () => {
      clientMock.get.mockResolvedValueOnce(realConfig(sabArray({ name: 'books', dir: 'other-app' }, { name: 'readmeabook', dir: '' })));
      const service = new SABnzbdService('http://sab', 'key');
      expect(await service.getCategories()).toEqual(['books', 'readmeabook']);
    });

    it('throws on HTTP failure and on a list it cannot read', async () => {
      const service = new SABnzbdService('http://sab', 'key');
      clientMock.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await expect(service.getCategories()).rejects.toThrow('Failed to get SABnzbd categories: ECONNREFUSED');
      clientMock.get.mockResolvedValueOnce(realConfig([{ name: 'books', dir: '' }]));
      await expect(service.getCategories()).rejects.toThrow(/Failed to get SABnzbd categories/);
    });
  });

  describe('ensureCategory', () => {
    it('#579: an existing category at the right folder is not re-sent on the next grab', async () => {
      clientMock.get.mockResolvedValue(realConfig(sabArray({ name: 'readmeabook', dir: '/downloads' })));
      const service = new SABnzbdService('http://sab', 'key', 'readmeabook', '/downloads');

      await service.ensureCategory();
      await service.ensureCategory();

      expect(setConfigCalls()).toEqual([]);
    });

    it('an owned category in another case is updated under SABnzbd\'s name, not created again', async () => {
      clientMock.get
        .mockResolvedValueOnce(realConfig(sabArray({ name: 'audiobooks', dir: 'old' })))
        .mockResolvedValueOnce({ data: { status: true } });
      const service = new SABnzbdService('http://sab', 'key', 'AudioBooks', '/downloads', false, undefined, true);

      await service.ensureCategory();

      expect(setConfigCalls()).toHaveLength(1);
      expect(setConfigCalls()[0][1].params).toMatchObject({ keyword: 'audiobooks', dir: '/downloads' });
    });

    it('a category that already existed (not owned) gets no set_config at all, present or missing', async () => {
      clientMock.get.mockResolvedValue(realConfig(sabArray({ name: 'books', dir: 'other-app' })));
      await new SABnzbdService('http://sab', 'key', 'books', '/downloads', false, undefined, false).ensureCategory();
      clientMock.get.mockResolvedValue(realConfig(sabArray()));
      await new SABnzbdService('http://sab', 'key', 'books', '/downloads', false, undefined, false).ensureCategory();
      expect(setConfigCalls()).toEqual([]);
    });

    it('a list it cannot read sends no set_config (a misread list would rewrite a category)', async () => {
      clientMock.get.mockResolvedValue(realConfig([{ name: 'readmeabook', dir: 'x' }]));
      await new SABnzbdService('http://sab', 'key', 'readmeabook', '/downloads').ensureCategory();
      expect(setConfigCalls()).toEqual([]);
    });

    it('the add sends the stored name as cat for a not-owned category', async () => {
      clientMock.get.mockResolvedValue(realConfig(sabArray({ name: 'books', dir: 'other-app' })));
      axiosMock.get.mockResolvedValueOnce({ data: Buffer.from('<nzb/>'), headers: { 'content-type': 'application/x-nzb' }, status: 200 });
      clientMock.post.mockResolvedValueOnce({ data: { status: true, nzo_ids: ['SABnzbd_nzo_1'] } });
      const service = new SABnzbdService('http://sab', 'key', 'books', '/downloads', false, undefined, false);

      await service.addNZB('http://prowlarr/download/1');

      const form = clientMock.post.mock.calls[0]?.[1];
      expect(form?.getBuffer?.().toString()).toContain('books');
      expect(setConfigCalls()).toEqual([]);
    });

    it('a grab with a list it cannot read still adds the job with its cat and sends no set_config', async () => {
      clientMock.get.mockResolvedValue(realConfig({ audiobooks: { dir: 'x' } })); // object form without "*"
      axiosMock.get.mockResolvedValueOnce({ data: Buffer.from('<nzb/>'), headers: { 'content-type': 'application/x-nzb' }, status: 200 });
      clientMock.post.mockResolvedValueOnce({ data: { status: true, nzo_ids: ['SABnzbd_nzo_2'] } });
      const service = new SABnzbdService('http://sab', 'key', 'audiobooks', '/downloads', false, undefined, true);

      await service.addNZB('http://prowlarr/download/2');

      expect(clientMock.post.mock.calls[0]?.[1]?.getBuffer?.().toString()).toContain('audiobooks');
      expect(setConfigCalls()).toEqual([]);
    });
  });
});
