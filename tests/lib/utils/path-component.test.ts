/**
 * Component: Path Component Byte Limit Helper Tests (#264)
 * Documentation: documentation/phase3/file-organization.md
 */

import { describe, it, expect } from 'vitest';
import { MAX_COMPONENT_BYTES, capComponentBytes, capFilenameBytes, capPathComponents } from '@/lib/utils/path-component';

const bytes = (value: string) => Buffer.byteLength(value, 'utf8');
const roundTrips = (value: string) => Buffer.from(value, 'utf8').toString('utf8') === value;

describe('capComponentBytes', () => {
  it('returns a name that fits unchanged, trailing space or dot included', () => {
    expect(MAX_COMPONENT_BYTES).toBe(255);
    for (const name of ['', 'Book', 'x'.repeat(255), 'Ж'.repeat(127), 'Title. ', '吾'.repeat(85)]) {
      expect(capComponentBytes(name)).toBe(name);
    }
  });

  it.each([
    ['2-byte', 'Ж', 2],
    ['3-byte', '吾', 3],
    ['4-byte surrogate pair', '📚', 4],
  ])('cuts %s characters only between characters', (_label, char, size) => {
    for (const lead of ['', 'a', 'ab', 'abc']) {
      const name = `${lead}${char.repeat(200)}`;
      const cut = capComponentBytes(name);
      expect(bytes(cut)).toBeLessThanOrEqual(255);
      expect(bytes(cut)).toBeGreaterThan(255 - size);
      expect(roundTrips(cut)).toBe(true);
      expect(name.startsWith(cut)).toBe(true);
    }
  });

  // Built from code points so no editor or tool normalises them
  const FAMILY = String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467); // 18 bytes, one cluster
  const FLAG_JP = String.fromCodePoint(0x1f1ef, 0x1f1f5); // 8 bytes, one cluster
  const E_ACUTE = `e${String.fromCodePoint(0x301)}`; // e + combining acute, 3 bytes, one cluster

  it.each([
    ['a joined family emoji', 'a'.repeat(245), FAMILY],
    ['a flag', 'a'.repeat(251), FLAG_JP],
    ['an accented letter (e + combining accent)', 'a'.repeat(254), E_ACUTE],
  ])('never cuts %s in half: it is dropped whole', (_label, lead, cluster) => {
    expect(capComponentBytes(`${lead}${cluster}`)).toBe(lead);
    expect(capFilenameBytes(`${lead}${cluster}`, '.m4b')).toBe(`${lead.slice(0, 251)}.m4b`);
  });

  it('keeps those clusters whole when they fit, and unchanged names stay unchanged', () => {
    const fits = `${'a'.repeat(200)}${FAMILY}${FLAG_JP}${E_ACUTE}`;
    expect(capComponentBytes(fits)).toBe(fits);
    const cut = capComponentBytes(`${'a'.repeat(230)}${FAMILY}${FAMILY}`);
    expect(cut).toBe(`${'a'.repeat(230)}${FAMILY}`);
  });

  it('trims trailing spaces and dots left by the cut', () => {
    expect(capComponentBytes(`${'a'.repeat(250)} ...  ${'b'.repeat(20)}`)).toBe('a'.repeat(250));
    expect(capComponentBytes('abc. def', 5)).toBe('abc');
  });

  it('honours a smaller limit', () => {
    expect(capComponentBytes('ЖЖЖ', 5)).toBe('ЖЖ');
    expect(capComponentBytes('📚📚', 7)).toBe('📚');
  });
});

describe('capFilenameBytes', () => {
  it('returns stem + suffix unchanged when it fits', () => {
    expect(capFilenameBytes('Book', ' - 1.mp3')).toBe('Book - 1.mp3');
    expect(capFilenameBytes('Ж'.repeat(123), ' - 1.mp3')).toBe(`${'Ж'.repeat(123)} - 1.mp3`);
  });

  it('cuts only the stem, keeping the suffix whole', () => {
    const name = capFilenameBytes('吾'.repeat(200), ' - 12.m4b');
    expect(name.endsWith(' - 12.m4b')).toBe(true);
    expect(bytes(name)).toBeLessThanOrEqual(255);
    expect(bytes(name)).toBeGreaterThan(252);
    expect(roundTrips(name)).toBe(true);
  });

  it('cuts the whole name when the suffix leaves no room', () => {
    const name = capFilenameBytes('stem', `.${'e'.repeat(300)}`);
    expect(name).toBe(`stem.${'e'.repeat(250)}`);
  });
});

describe('capPathComponents', () => {
  it('caps each component and keeps short ones as they are', () => {
    expect(capPathComponents('Author/Book')).toBe('Author/Book');
    const result = capPathComponents(`Автор/${'Ж'.repeat(200)}/Book`);
    const parts = result.split('/');
    expect(parts[0]).toBe('Автор');
    expect(parts[1]).toBe('Ж'.repeat(127));
    expect(parts[2]).toBe('Book');
  });

  it('drops a component the cut leaves empty', () => {
    expect(capPathComponents(`A/${'.'.repeat(300)}/B`)).toBe('A/B');
  });
});
