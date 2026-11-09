/**
 * Component: Audible DRM Release Detection Tests (#518)
 * Documentation: documentation/phase3/ranking-algorithm.md
 */

import { describe, expect, it } from 'vitest';
import { drmReleaseMarker } from '@/lib/utils/drm-release';
import { rankTorrents } from '@/lib/utils/ranking-algorithm';

const MB = 1024 * 1024;

const release = (guid: string, title: string) => ({
  indexer: 'X',
  indexerId: 1,
  title,
  size: 600 * MB,
  seeders: 20,
  publishDate: new Date('2025-01-01T00:00:00Z'),
  downloadUrl: `https://indexer/${guid}`,
  guid,
});

const DUNE = { title: 'Dune', author: 'Frank Herbert', durationMinutes: 600 };

describe('drmReleaseMarker: the title marks the release as Audible DRM', () => {
  it.each<[string, string, string]>([
    ['bracketed AAX tag', 'Frank Herbert - Dune [AAX]', '[AAX]'],
    ['parenthesised AA tag', 'Frank Herbert - Dune (AA)', '(AA)'],
    ['braced AAXC tag', 'Frank Herbert - Dune {AAXC}', '{AAXC}'],
    ['tag with spaces and a dot', 'Frank Herbert - Dune [ .aax ]', '[ .aax ]'],
    ['.aax extension', 'Frank Herbert - Dune.aax', '.aax'],
    ['.aa extension', 'Frank Herbert - Dune.aa', '.aa'],
    ['.aaxc extension', 'Frank Herbert - Dune.aaxc', '.aaxc'],
    ['dotted name ending in .aax', 'frank.herbert.dune.AAX', '.AAX'],
    ['extension before a group suffix', 'Frank.Herbert.Dune.aax-GRP', '.aax'],
    ['extension before a year in brackets', 'Frank Herbert - Dune.aaxc (2007)', '.aaxc'],
  ])('%s', (_label, title, marker) => {
    expect(drmReleaseMarker(title)).toBe(marker);
  });
});

describe('drmReleaseMarker: titles that do not mark the release as DRM', () => {
  it.each<[string, string]>([
    ['converted, M4B tag and AAX source', 'Dune [M4B] (from AAX)'],
    ['converted, "AAX to M4B"', 'Frank Herbert - Dune AAX to M4B'],
    ['converted, "AAX-M4B"', 'Frank Herbert - Dune AAX-M4B'],
    ['converted, names its source', 'Frank Herbert - Dune ripped from Audible AAX'],
    ['playable format next to an AAX tag', 'Frank Herbert - Dune [AAX] [MP3]'],
    ['playable format next to an .aax extension', 'Frank.Herbert.Dune.aax.flac'],
    ['opus named with an AAX tag', 'Frank Herbert - Dune (AAX) opus'],
    ['bare AAX word', 'Frank Herbert - Dune AAX'],
    ['bare AAX word in a dotted name', 'Frank.Herbert.Dune.AAX.2007'],
    ['"aa" inside a word', 'Isaac and the Aardvark - Author Name'],
    ['"AA" initialism', 'Winnie-the-Pooh - AA Milne'],
    ['"AA" initialism in a dotted name', 'Winnie.the.Pooh.AA.Milne'],
    ['longer word starting with aax', 'Frank Herbert - Dune.aaxz'],
    ['tag with other words in it', 'Frank Herbert - Dune (Audible AAX source)'],
  ])('%s', (_label, title) => {
    expect(drmReleaseMarker(title)).toBeNull();
  });
});

describe('rankTorrents rejectDrm', () => {
  const drm = release('drm', 'Frank Herbert - Dune [AAX]');
  const converted = release('converted', 'Frank Herbert - Dune [M4B] (from AAX)');
  const bare = release('bare', 'Frank Herbert - Dune AAX');

  it('drops a DRM release when set (automatic search)', () => {
    const ranked = rankTorrents([drm, converted, bare], DUNE, { rejectDrm: true });
    expect(ranked.map((r) => r.guid).sort()).toEqual(['bare', 'converted']);
  });

  it('lists a DRM release when not set (interactive search)', () => {
    const ranked = rankTorrents([drm, converted], DUNE, {});
    expect(ranked.map((r) => r.guid).sort()).toEqual(['converted', 'drm']);
  });
});
