/**
 * Component: Download Category Helper Tests
 * Documentation: documentation/phase3/download-clients.md
 *
 * Every row of the ownership decision table, plus the client-safe helpers the modal and card use.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  CategoryChoiceError,
  categoryInputError,
  existingCategoryNote,
  existsInClient,
  findCategory,
  isSharedCategory,
  normalizeCategory,
  ownsCategory,
  resolveCategoryChoice,
} from '@/lib/utils/download-category';

const listing = (names: string[]) => vi.fn(async () => names);
const failing = () => vi.fn(async () => { throw new Error('connect ECONNREFUSED'); });

describe('resolveCategoryChoice', () => {
  it('empty means readmeabook, without reading the client', async () => {
    const list = listing(['Books']);
    expect(await resolveCategoryChoice({ type: 'qbittorrent', category: '  ' }, list)).toEqual({ category: 'readmeabook', existing: false });
    expect(list).not.toHaveBeenCalled();
  });

  it('the default in any case is readmeabook and forgets the saved ownedCategory, without a list call', async () => {
    const list = listing([]);
    const choice = await resolveCategoryChoice({ type: 'qbittorrent', category: 'ReadMeABook', previous: { category: 'audiobooks', ownedCategory: 'audiobooks' } }, list);
    expect(choice).toEqual({ category: 'readmeabook', existing: false });
    expect(list).not.toHaveBeenCalled();
  });

  it('Deluge: lower-cased, no list call; a label Deluge rejects is a field error', async () => {
    const list = listing([]);
    expect((await resolveCategoryChoice({ type: 'deluge', category: 'AudioBooks' }, list)).category).toBe('audiobooks');
    await expect(resolveCategoryChoice({ type: 'deluge', category: 'audio books' }, list)).rejects.toBeInstanceOf(CategoryChoiceError);
    expect(list).not.toHaveBeenCalled();
  });

  it('Transmission: as typed, no list call', async () => {
    const list = listing([]);
    expect((await resolveCategoryChoice({ type: 'transmission', category: ' Books ' }, list)).category).toBe('Books');
    expect(list).not.toHaveBeenCalled();
  });

  it('a name unchanged from the saved one (any case) keeps the saved values, without a list call', async () => {
    const list = listing([]);
    const choice = await resolveCategoryChoice({ type: 'qbittorrent', category: 'BOOKS', previous: { category: 'Books' } }, list);
    expect(choice).toEqual({ category: 'Books', ownedCategory: undefined, existing: true });
    expect(list).not.toHaveBeenCalled();
  });

  it('a return trip to a name ReadMeABook used before lists the client: present means existing', async () => {
    const list = listing(['audiobooks']);
    const choice = await resolveCategoryChoice({ type: 'nzbget', category: 'AudioBooks', previous: { category: 'readmeabook', ownedCategory: 'audiobooks' } }, list);
    expect(choice).toEqual({ category: 'audiobooks', existing: true });
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('an unchanged name keeps ownedCategory only when it is that name', async () => {
    const list = listing([]);
    expect(await resolveCategoryChoice({ type: 'qbittorrent', category: 'Audiobooks', previous: { category: 'audiobooks', ownedCategory: 'audiobooks' } }, list))
      .toEqual({ category: 'audiobooks', ownedCategory: 'audiobooks', existing: false });
    expect(await resolveCategoryChoice({ type: 'qbittorrent', category: 'Books', previous: { category: 'Books', ownedCategory: 'audiobooks' } }, list))
      .toEqual({ category: 'Books', existing: true });
    expect(list).not.toHaveBeenCalled();
  });

  it('a new name missing in the client becomes ReadMeABook\'s own', async () => {
    const list = listing(['Movies']);
    expect(await resolveCategoryChoice({ type: 'qbittorrent', category: 'audiobooks-rmab' }, list)).toEqual({ category: 'audiobooks-rmab', ownedCategory: 'audiobooks-rmab', existing: false });
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('a new name present in the client (any case) is stored in the client\'s spelling and not owned', async () => {
    const choice = await resolveCategoryChoice({ type: 'qbittorrent', category: 'books', previous: { category: 'readmeabook', ownedCategory: 'old' } }, listing(['Books']));
    expect(choice).toEqual({ category: 'Books', existing: true });
  });

  it('SABnzbd names are stored lower-case', async () => {
    expect(await resolveCategoryChoice({ type: 'sabnzbd', category: 'AudioBooks' }, listing(['movies']))).toEqual({ category: 'audiobooks', ownedCategory: 'audiobooks', existing: false });
    expect((await resolveCategoryChoice({ type: 'sabnzbd', category: 'Books' }, listing(['books']))).category).toBe('books');
  });

  it('a list failure throws a readable error instead of guessing', async () => {
    await expect(resolveCategoryChoice({ type: 'sabnzbd', category: 'books' }, failing())).rejects.toThrow(
      "Couldn't read SABnzbd's categories: connect ECONNREFUSED"
    );
  });

  it('refuses SABnzbd\'s default category name', async () => {
    await expect(resolveCategoryChoice({ type: 'sabnzbd', category: '*' }, listing([]))).rejects.toThrow('Choose a category name');
  });
});

describe('ownership helpers', () => {
  it('readmeabook (any case) and the ownedCategory (any case) are owned; others are not', () => {
    expect(ownsCategory(undefined, undefined)).toBe(true);
    expect(ownsCategory('ReadMeABook', undefined)).toBe(true);
    expect(ownsCategory('Audiobooks', 'audiobooks')).toBe(true);
    expect(ownsCategory('books', 'audiobooks')).toBe(false);
  });

  it('only path clients can have a shared category', () => {
    expect(isSharedCategory('qbittorrent', 'books', undefined)).toBe(true);
    expect(isSharedCategory('sabnzbd', 'books', 'books')).toBe(false);
    expect(isSharedCategory('deluge', 'books', undefined)).toBe(false);
    expect(isSharedCategory('transmission', 'books', undefined)).toBe(false);
  });

  it('findCategory tries the exact name before a case-insensitive match', () => {
    expect(findCategory(['Books', 'books'], 'books')).toBe('books');
    expect(findCategory(['Books', 'books'], 'Books')).toBe('Books');
    expect(findCategory(['Books'], 'BOOKS')).toBe('Books');
    expect(findCategory(['Movies'], 'books')).toBeNull();
  });

  it('normalizeCategory trims, defaults, and lower-cases Deluge and SABnzbd', () => {
    expect(normalizeCategory('qbittorrent', ' Books ')).toBe('Books');
    expect(normalizeCategory('sabnzbd', 'Books')).toBe('books');
    expect(normalizeCategory('deluge', 'Books')).toBe('books');
    expect(normalizeCategory('nzbget', '')).toBe('readmeabook');
  });

  it('categoryInputError checks the Deluge charset (after lower-casing)', () => {
    expect(categoryInputError('deluge', 'Audio-Books_1.0')).toBeNull();
    expect(categoryInputError('deluge', 'audio books')).toMatch(/Deluge labels/);
    expect(categoryInputError('qbittorrent', 'audio books')).toBeNull();
  });

  it('categoryInputError refuses a path separator or a control character on every client', () => {
    for (const type of ['qbittorrent', 'sabnzbd', 'nzbget', 'deluge', 'transmission']) {
      for (const name of ['a/b', 'a' + String.fromCharCode(92) + 'b', 'tab' + String.fromCharCode(9) + 'here', 'nul' + String.fromCharCode(0), 'del' + String.fromCharCode(127)]) {
        expect(categoryInputError(type, name), `${type} ${JSON.stringify(name)}`).toMatch(/slashes or control characters/);
      }
    }
    expect(categoryInputError('qbittorrent', '.hidden')).toBeNull();
  });

  it('a name with a slash is a field error on save, before any list call', async () => {
    const list = listing([]);
    await expect(resolveCategoryChoice({ type: 'qbittorrent', category: 'audio//books' }, list)).rejects.toBeInstanceOf(CategoryChoiceError);
    expect(list).not.toHaveBeenCalled();
  });

  it('a dot-prefixed name is a normal new name', async () => {
    expect(await resolveCategoryChoice({ type: 'qbittorrent', category: '.audiobooks' }, listing(['Books'])))
      .toEqual({ category: '.audiobooks', ownedCategory: '.audiobooks', existing: false });
  });
});

describe('display helpers', () => {
  it('existsInClient: a present name that is not ReadMeABook\'s own', () => {
    expect(existsInClient('qbittorrent', 'books', ['Books'])).toBe(true);
    expect(existsInClient('qbittorrent', 'books', ['Books'], 'Books')).toBe(false);
    expect(existsInClient('qbittorrent', 'readmeabook', ['readmeabook'])).toBe(false);
    expect(existsInClient('qbittorrent', 'audiobooks', ['Books'])).toBe(false);
    expect(existsInClient('transmission', 'books', ['books'])).toBe(false);
  });

  it('notes per client', () => {
    expect(existingCategoryNote('qbittorrent', '/downloads')).toBe("Already in qBittorrent. ReadMeABook won't change it; files still go to /downloads.");
    expect(existingCategoryNote('sabnzbd')).toBe("Already in SABnzbd. ReadMeABook won't change it; downloads use its folder and settings.");
    expect(existingCategoryNote('nzbget')).toBe("Already in NZBGet. ReadMeABook won't change it; downloads use its folder and settings.");
    expect(existingCategoryNote('deluge')).toBe('Already in Deluge; its label settings apply.');
    expect(existingCategoryNote('transmission')).toBeNull();
  });
});
