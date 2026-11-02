/**
 * Component: Ranking Algorithm Tests (subtitle after ". " or " - " in the request title, #466)
 * Documentation: documentation/phase3/ranking-algorithm.md
 */

import { describe, expect, it } from 'vitest';
import { rankTorrents } from '@/lib/utils/ranking-algorithm';
import { LANGUAGE_CONFIGS, SupportedLanguage } from '@/lib/constants/language-config';

const MB = 1024 * 1024;

/** Rank releases for one request through the real entry point; full size and seeder points for each */
function rankAll(releases: string[], title: string, author: string, lang?: SupportedLanguage, requireAuthor = true) {
  const config = lang ? LANGUAGE_CONFIGS[lang] : undefined;
  const torrents = releases.map((release, i) => ({
    indexer: 'X', indexerId: 1, title: release, size: 600 * MB, seeders: 10,
    publishDate: new Date('2025-01-01'), downloadUrl: `x${i}`, guid: `g${i}`,
  }));
  return rankTorrents(torrents, { title, author, durationMinutes: 600 },
    { requireAuthor, stopWords: config?.stopWords, characterReplacements: config?.characterReplacements });
}

const match = (release: string, title: string, author: string, lang?: SupportedLanguage, requireAuthor = true): number =>
  rankAll([release], title, author, lang, requireAuthor)[0].breakdown.matchScore;

describe('the six #466 rows clear word coverage', () => {
  // [request title, release, author, lang, the same title with a colon subtitle or without the apostrophe]
  const rows: [string, string, string, SupportedLanguage, string][] = [
    ["L'intruse", 'L.Intruse.Freida.McFadden.2026.FR.[Mp3.128.Kbps]-NOTAG', 'Freida McFadden', 'fr', 'L intruse'],
    ["Changer l'eau des fleurs", 'Changer.L.Eau.Des.Fleurs.Valerie.Perrin.2022.FR.[M4B.128.kbps]-AG404', 'Valérie Perrin', 'fr', 'Changer l eau des fleurs'],
    ["L'Héritage", 'Cycle.de.l.Heritage.T04.L.Heritage.Christopher.Paolini.2020.FR.[MP3.64kbps]-LiesKey', 'Christopher Paolini', 'fr', 'L Héritage'],
    ["Ender's Game", 'Enders.Game.Orson.Scott.Card.MP3', 'Orson Scott Card', 'en', 'Enders Game'],
    ['Primal Hunter 1. Une aventure de LitRPG', 'Primal.Hunter.T01.Zogarth.2024.FR.[MP3.128.KBPS]-NOTAG', 'Zogarth', 'fr', 'Primal Hunter 1: Une aventure de LitRPG'],
    ["C'était ça ou mourir - Prix du Roman FNAC 2026", 'C.Etait.Ca.Ou.Mourir.Thelyson.Orelien.2026.FR.[MP3.64.kbps]-KIKI', 'Orélien Thélyson', 'fr', "C'était ça ou mourir: Prix du Roman FNAC 2026"],
  ];

  it.each(rows)('automatic: %s', (title, release, author, lang, sameTitle) => {
    const score = match(release, title, author, lang);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeCloseTo(match(release, sameTitle, author, lang), 5);
  });

  it.each(rows)('interactive: %s', (title, release, author, lang, sameTitle) => {
    const score = match(release, title, author, lang, false);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeCloseTo(match(release, sameTitle, author, lang, false), 5);
  });

  it('a spaced en dash splits like " - "', () => {
    const release = 'C.Etait.Ca.Ou.Mourir.Thelyson.Orelien.2026.FR.[MP3.64.kbps]-KIKI';
    expect(match(release, "C'était ça ou mourir – Prix du Roman FNAC 2026", 'Orélien Thélyson', 'fr')).toBeCloseTo(27.28, 1);
  });
});

describe('the part before the split names several books: the requested one still ranks first (#466)', () => {
  // [case, request title, author, lang, right release, wrong release]
  const rows: [string, string, string, SupportedLanguage, string, string][] = [
    ['series before ". "', 'Der Herr der Ringe. Die Gefährten', 'J.R.R. Tolkien', 'de',
      'J.R.R. Tolkien - Der Herr der Ringe - Die Gefährten [MP3]', 'J.R.R. Tolkien - Der Herr der Ringe - Die Rückkehr des Königs [MP3]'],
    ['series before ". ", scene name', 'Der Herr der Ringe. Die Gefährten', 'J.R.R. Tolkien', 'de',
      'J.R.R. Tolkien - Der Herr der Ringe - Die Gefährten [MP3]', 'Der.Herr.der.Ringe.Die.zwei.Tuerme.Tolkien.German.MP3'],
    ['series before " - "', 'Sherlock Holmes - Der Hund der Baskervilles', 'Arthur Conan Doyle', 'de',
      'Arthur Conan Doyle - Sherlock Holmes - Der Hund der Baskervilles [MP3]', 'Arthur Conan Doyle - Sherlock Holmes - Das Zeichen der Vier [MP3]'],
    ['series before " - ", scene name', 'Sherlock Holmes - Der Hund der Baskervilles', 'Arthur Conan Doyle', 'de',
      'Arthur Conan Doyle - Sherlock Holmes - Der Hund der Baskervilles [MP3]', 'Sherlock.Holmes.Eine.Studie.in.Scharlachrot.Arthur.Conan.Doyle.MP3'],
    ['author name before " - "', 'Terry Pratchett - Mort', 'Terry Pratchett', 'en',
      'Terry Pratchett - Mort [MP3]', 'Terry Pratchett - Guards! Guards! [MP3]'],
  ];

  it.each(rows)('automatic: %s', (_name, title, author, lang, right, wrong) => {
    const ranked = rankAll([wrong, right], title, author, lang);
    expect(ranked[0].title).toBe(right);
    expect(ranked[0].breakdown.matchScore).toBeGreaterThan(ranked[1].breakdown.matchScore);
  });

  it.each(rows)('interactive: %s', (_name, title, author, lang, right, wrong) => {
    const ranked = rankAll([wrong, right], title, author, lang, false);
    expect(ranked[0].title).toBe(right);
    expect(ranked[0].breakdown.matchScore).toBeGreaterThan(ranked[1].breakdown.matchScore);
  });

  it.each([true, false])('series and position before ". ": another volume scores 0, the requested one does not (automatic: %s)', (auto) => {
    const title = 'Primal Hunter 1. Une aventure de LitRPG';
    const right = 'Primal.Hunter.T01.Zogarth.2024.FR.[MP3.128.KBPS]-NOTAG';
    expect(match(right, title, 'Zogarth', 'fr', auto)).toBeGreaterThan(0);
    expect(match('Primal.Hunter.T02.Zogarth.2024.FR.[MP3.128.KBPS]-NOTAG', title, 'Zogarth', 'fr', auto)).toBe(0);
    expect(match('Primal Hunter 2 - Zogarth [M4B]', title, 'Zogarth', 'fr', auto)).toBe(0);
  });

  it.each([
    ['de: ". "', 'Suzanne Collins - Die Tribute von Panem - Tödliche Spiele (ungekürzt) [MP3]', 'Die Tribute von Panem 1. Tödliche Spiele', 'Suzanne Collins'],
    ['de: " - "', 'Sarah J. Maas - Throne of Glass - Die Erwählte [MP3]', 'Throne of Glass 1 - Die Erwählte', 'Sarah J. Maas'],
  ])('a release that leaves out the position still clears the threshold (#459, %s)', (_name, release, title, author) => {
    for (const auto of [true, false]) {
      const [ranked] = rankAll([release], title, author, 'de', auto);
      expect(ranked.breakdown.matchScore).toBeGreaterThan(40);
      expect(ranked.score).toBeGreaterThanOrEqual(50);
    }
  });

  it('a release that names the author after " - " is still a complete title', () => {
    expect(match('Der Herr der Ringe - J.R.R. Tolkien [MP3]', 'Der Herr der Ringe. Die Gefährten', 'J.R.R. Tolkien', 'de')).toBe(60);
  });

  it.each([true, false])('a bracketed note after a split title keeps the complete-title match (automatic: %s)', (auto) => {
    // Main scores this 60: the full title without its brackets is still tried before the split
    const release = 'Die Tribute von Panem 1. Tödliche Spiele - Suzanne Collins [MP3]';
    expect(match(release, 'Die Tribute von Panem 1. Tödliche Spiele (ungekürzt)', 'Suzanne Collins', 'de', auto)).toBe(60);
  });
});

describe('a release with neither the position nor the subtitle is another volume (#466)', () => {
  // [request title, author, lang, release]: all score 0 on main; the series position counts as missing
  // unless the release also carries the subtitle (colon, " - " and ". " alike)
  const rows: [string, string, SupportedLanguage, string][] = [
    ['The Primal Hunter 3: A LitRPG Adventure', 'Zogarth', 'en', 'Zogarth - The Primal Hunter [M4B]'],
    ['The Primal Hunter 3: A LitRPG Adventure', 'Zogarth', 'en', 'The.Primal.Hunter.Zogarth.M4B'],
    ['Defiance of the Fall 3: A LitRPG Adventure', 'JF Brink', 'en', 'JF Brink - Defiance of the Fall [M4B]'],
    ['Beware of Chicken 3: A Xianxia Cultivation Novel', 'Casualfarmer', 'en', 'Casualfarmer - Beware of Chicken [M4B]'],
    ['The Primal Hunter 3 - A LitRPG Adventure', 'Zogarth', 'en', 'Zogarth - The Primal Hunter [M4B]'],
    ['Primal Hunter 3. Une aventure de LitRPG', 'Zogarth', 'fr', 'Primal.Hunter.Zogarth.2024.FR.[MP3]'],
    ['Catch-22. A Novel', 'Joseph Heller', 'en', 'Joseph Heller - Catch Me [MP3]'],
    ['Apollo 13 - Lost Moon', 'Jim Lovell', 'en', 'Jim Lovell - Apollo [MP3]'],
  ];

  it.each(rows)('automatic: %s vs %s', (title, author, lang, release) => {
    expect(match(release, title, author, lang)).toBe(0);
  });

  it.each(rows)('interactive: %s vs %s', (title, author, lang, release) => {
    expect(match(release, title, author, lang, false)).toBe(0);
  });

  it('the catalog series part does not let it through, and the right volume still ranks', () => {
    const torrents = ['Zogarth - The Primal Hunter [M4B]', 'Zogarth - The Primal Hunter 3 [M4B]'].map((release, i) => ({
      indexer: 'X', indexerId: 1, title: release, size: 600 * MB, seeders: 10,
      publishDate: new Date('2025-01-01'), downloadUrl: `x${i}`, guid: `g${i}`,
    }));
    const ranked = rankTorrents(torrents,
      { title: 'The Primal Hunter 3: A LitRPG Adventure', author: 'Zogarth', durationMinutes: 600, series: 'The Primal Hunter', seriesPart: '3' },
      { requireAuthor: true });
    expect(ranked[0].title).toBe('Zogarth - The Primal Hunter 3 [M4B]');
    expect(ranked[0].score).toBeGreaterThanOrEqual(50);
    expect(ranked[1].breakdown.matchScore).toBe(0);
  });
});

describe('what is not a split (#466)', () => {
  it('a spaced dash after a hyphenated word splits there, not at the hyphen', () => {
    // Main requires "forever young" and scores this 0
    expect(match('Stefan Petrucha - Spider-Man [MP3]', 'Spider-Man - Forever Young', 'Stefan Petrucha')).toBe(60);
    // A split at the hyphen would leave only "spider" required
    expect(match('Stefan Petrucha - Spider [MP3]', 'Spider-Man - Forever Young', 'Stefan Petrucha')).toBe(0);
  });

  // [case, request title, author, release, matchScore on main]: unchanged by #466
  it.each<[string, string, string, string, number]>([
    ['hyphen inside a word, release has it', 'Spider-Man', 'Stefan Petrucha', 'Stefan Petrucha - Spider-Man [MP3]', 60],
    ['hyphen inside a word, release names only half', 'Spider-Man', 'Stefan Petrucha', 'Stefan Petrucha - Spider [MP3]', 0],
    ['an abbreviation before ". "', 'Mr. Mercedes', 'Stephen King', "Stephen King - Mr. Harrigan's Phone [MP3]", 0],
    ['initials before ". "', 'A. J. Fikry', 'Gabrielle Zevin', 'Gabrielle Zevin - Fikry [MP3]', 0],
    ['a word under four letters before ". "', 'Run. Hide. Fight', 'Jane Doe', 'Jane Doe - Run [MP3]', 0],
  ])('%s', (_name, title, author, release, onMain) => {
    expect(match(release, title, author)).toBeCloseTo(onMain, 5);
  });
});
