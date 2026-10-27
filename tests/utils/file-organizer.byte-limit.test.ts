/**
 * Component: File Organizer Byte Limit Tests (#264)
 * Documentation: documentation/phase3/file-organization.md
 */

import path from 'path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));

import { FileOrganizer } from '@/lib/utils/file-organizer';

const MAX = 255;
const bytes = (value: string) => Buffer.byteLength(value, 'utf8');

function expectFits(name: string) {
  expect(bytes(name)).toBeLessThanOrEqual(MAX);
  expect(Buffer.from(name, 'utf8').toString('utf8')).toBe(name);
}

type Organizer = {
  buildSourceAwareFilename(source: string, duplicates: Set<string>, used: Set<string>): string;
  makeUniqueFilename(name: string, used: Set<string>): string;
};
const organizer = () => new FileOrganizer('/media', '/tmp') as unknown as Organizer;

describe('organizer file names fit in 255 bytes (#264)', () => {
  // Each folder fits on its own (200 and 211 bytes); joined as a prefix they do not
  const BOOK = 'Ж'.repeat(100);
  const disc = (n: number) => `Диск ${n} ${'Ж'.repeat(100)}`;

  it('duplicate track names in long nested folders: the folder prefix is cut, the track name and extension kept', () => {
    const org = organizer();
    const used = new Set<string>();
    const duplicates = new Set(['Track01.mp3']);

    const one = org.buildSourceAwareFilename(path.join(BOOK, disc(1), 'Track01.mp3'), duplicates, used);
    const two = org.buildSourceAwareFilename(path.join(BOOK, disc(2), 'Track01.mp3'), duplicates, used);

    for (const name of [one, two]) {
      expectFits(name);
      expect(name.endsWith('-Track01.mp3')).toBe(true);
      expect(name.startsWith(`${BOOK}-Диск `)).toBe(true);
    }
    expect(one).not.toBe(two);
    expect(one).toContain('Диск 1');
    expect(two).toContain('Диск 2');
  });

  it('a second file of a name at the limit gets " (2)" and keeps its extension', () => {
    const org = organizer();
    const name = `${'Ж'.repeat(125)}.mp3`; // 254 bytes
    const used = new Set([name]);

    const second = org.makeUniqueFilename(name, used);

    expectFits(second);
    expect(second.endsWith(' (2).mp3')).toBe(true);
    expect(second).not.toBe(name);
    expect(used.has(second)).toBe(true);
  });

  it('names that fit are unchanged', () => {
    const org = organizer();
    const used = new Set<string>();
    const duplicates = new Set(['Track01.mp3']);

    expect(org.buildSourceAwareFilename(path.join('CD1', 'Track01.mp3'), duplicates, used)).toBe('CD1-Track01.mp3');
    expect(org.buildSourceAwareFilename(path.join('Book', 'Chapter 1.mp3'), duplicates, used)).toBe('Chapter 1.mp3');
    expect(org.makeUniqueFilename('Chapter 1.mp3', used)).toBe('Chapter 1 (2).mp3');
    const long = `${'Ж'.repeat(123)}.mp3`; // 250 bytes; with " (2)" 254
    used.add(long);
    expect(org.makeUniqueFilename(long, used)).toBe(`${'Ж'.repeat(123)} (2).mp3`);
  });
});
