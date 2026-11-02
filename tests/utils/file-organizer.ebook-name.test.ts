/**
 * Component: File Organizer Ebook Name and 200-Unit Cap Tests (#474, real filesystem)
 * Documentation: documentation/phase3/file-organization.md
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: { configuration: { findUnique: vi.fn(async () => null) } },
}));

import { FileOrganizer } from '@/lib/utils/file-organizer';

// A joined family emoji: four people and three joiners, 11 UTF-16 code units, one character on screen
const FAMILY = [0x1f468, 0x1f469, 0x1f467, 0x1f466].map((c) => String.fromCodePoint(c)).join(String.fromCharCode(0x200d));

let root: string;

/** Organize one downloaded ebook with renaming off; return the names in the book folder */
async function organizedNames(sourceName: string): Promise<string[]> {
  const media = path.join(root, 'media');
  const downloads = path.join(root, 'downloads');
  fs.mkdirSync(downloads, { recursive: true });
  const source = path.join(downloads, sourceName);
  fs.writeFileSync(source, 'epub-bytes');

  const organizer = new FileOrganizer(media, path.join(root, 'tmp'));
  const result = await organizer.organizeEbook(source, { title: 'Book', author: 'Author' }, '{author}/{title}', undefined, false);

  expect(result.success).toBe(true);
  return fs.readdirSync(path.join(media, 'Author', 'Book'));
}

describe('organizer: ebook source name keeps its extension (#474)', () => {
  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-ebookname-')));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('a 221-character Latin name is cut to 200 characters and keeps .epub', async () => {
    const source = `${'T'.repeat(184)} - Firstname Middlename Lastname.epub`; // 221 characters
    expect(source).toHaveLength(221);

    const names = await organizedNames(source);

    expect(names).toEqual([`${'T'.repeat(184)} - Firstnam.epub`]);
    expect(path.extname(names[0])).toBe('.epub');
  });

  it.each([
    ['Book.epub', 'Book.epub'],
    ['Mistborn: The <Final> Empire.epub', 'Mistborn The Final Empire.epub'],
    // Exactly 200 characters
    [`${'x'.repeat(195)}.epub`, `${'x'.repeat(195)}.epub`],
    ['Война и мир - Лев Толстой.fb2', 'Война и мир - Лев Толстой.fb2'],
  ])('unchanged when it fits: %s', async (source, expected) => {
    expect(await organizedNames(source)).toEqual([expected]);
  });
});

describe('organizer: the 200-unit name cap never splits a character (#474)', () => {
  type Organizer = { sanitizePath(name: string): string };
  const organizer = () => new FileOrganizer('/media', '/tmp') as unknown as Organizer;

  it('a name ending in a family emoji at unit 200 drops the whole emoji', () => {
    expect(organizer().sanitizePath(`${'a'.repeat(196)}${FAMILY}`)).toBe('a'.repeat(196));
  });

  it('an emoji that ends exactly at the cap is kept', () => {
    const name = `${'a'.repeat(189)}${FAMILY}`;
    expect(organizer().sanitizePath(name)).toBe(name);
  });
});
