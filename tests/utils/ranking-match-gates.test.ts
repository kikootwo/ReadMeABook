/**
 * Component: Ranking Algorithm Tests (automatic-search match gates, #223)
 * Documentation: documentation/phase3/match-gates.md
 */

import { describe, expect, it } from 'vitest';
import { rankEbookTorrents, rankTorrents } from '@/lib/utils/ranking-algorithm';
import { LANGUAGE_CONFIGS, SupportedLanguage } from '@/lib/constants/language-config';

const MB = 1024 * 1024;
const NZB = undefined; // no seeders field: full seeder points, like a Usenet result

interface Shape { sizeMB?: number; minutes?: number; seeders?: number; lang?: SupportedLanguage; requireAuthor?: boolean }

/** Rank one release through the real entry point; defaults earn full size and seeder points */
function rank(release: string, title: string, author: string, shape: Shape = {}) {
  const { sizeMB = 600, minutes = 600, lang, requireAuthor = true } = shape;
  const seeders = 'seeders' in shape ? shape.seeders : NZB;
  const config = lang ? LANGUAGE_CONFIGS[lang] : undefined;
  const [ranked] = rankTorrents(
    [{ indexer: 'X', indexerId: 1, title: release, size: sizeMB * MB, seeders, publishDate: new Date('2025-01-01'), downloadUrl: 'x', guid: 'g' }],
    { title, author, durationMinutes: minutes },
    { requireAuthor, stopWords: config?.stopWords, characterReplacements: config?.characterReplacements },
  );
  return { match: ranked.breakdown.matchScore, total: ranked.score };
}

const IT = ['It', 'Stephen King'] as const;
const DUNE = ['Dune', 'Frank Herbert'] as const;
const MARTIAN = ['The Martian', 'Andy Weir'] as const;
const OP_CENTER = ["Tom Clancy's Op-Center #12: War of Eagles", 'Tom Clancy'] as const;

describe('automatic search: wrong books are rejected by a gate', () => {
  // [case, release, title, author, inputs]: main grabs F1-F7 (total >= 50) with these inputs
  it.each<[string, string, string, string, Shape?]>([
    ['F1 a book containing the one-word title', 'You Like It Darker by Stephen King [ENG / M4B]', ...IT, { sizeMB: 1500, minutes: 2683 }],
    ['F2 a book starting with the one-word title', 'It Grows on You by Stephen King [ENG / M4B]', ...IT, { sizeMB: 1500, minutes: 2683 }],
    ['F3 an anthology starting with the title word', 'The Getaway Car - MatchUp by Lee Child [ENG / M4B]', 'Getaway', 'Lee Child', { sizeMB: 800, minutes: 90 }],
    ['F4 sibling volume, bare number', "Tom Clancy's Op-Center 11 - Call to Treason [ENG / M4B]", ...OP_CENTER, { sizeMB: 500, minutes: 720, seeders: 30 }],
    ['F4b sibling volume, #number', "Tom Clancy's Op-Center #11: Call to Treason by Tom Clancy [ENG / M4B]", ...OP_CENTER, { sizeMB: 500, minutes: 720, seeders: 30 }],
    ['F5 other volume, T2 after the title', 'Le.Probleme.a.Trois.Corps.T2.La.Foret.Sombre.Liu.Cixin.VFF.[M4B.128kbs]-NOTAG', 'Le problème à trois corps (book 1)', 'Liu Cixin', { sizeMB: 900, minutes: 900, seeders: 20, lang: 'fr' }],
    ['F6 other volume, T03 after the title', "Matt Dinniman - Dungeon Crawler Carl, T03 Le Livre de recettes de l'Anarchiste - 2025 [M4B 16 bits 44.1 kHz] - SGFx", 'Dungeon Crawler Carl (book 1)', 'Matt Dinniman', { sizeMB: 900, minutes: 800, seeders: 20, lang: 'fr' }],
    ['F7 author name inside other words', 'Weird Candy Hail by Rando [M4B]', 'Hail', 'Andy Weir', { sizeMB: 900, minutes: 800, seeders: 60 }],
    ['F7b surname inside a longer word', 'Children of the Fleet by Orson Scott Card [M4B]', 'The Fleet', 'Lee Child', { sizeMB: 900, minutes: 800, seeders: 60 }],
    ['Pin Drop for Pin', 'Pin Drop by Stephen King [M4B]', 'Pin', 'Stephen King'],
    ['White Noise Black Sky for White', 'White Noise Black Sky by Stephen King [M4B]', 'White', 'Stephen King'],
    ['Mistborn sequel, no separator', 'Mistborn The Well of Ascension by Brandon Sanderson [M4B]', 'Mistborn', 'Brandon Sanderson'],
    ['Mistborn sequel, author first', 'Brandon Sanderson Mistborn The Hero of Ages M4B', 'Mistborn', 'Brandon Sanderson'],
    ['The Martian Chronicles', 'Andy Weir The Martian Chronicles [M4B]', ...MARTIAN],
    ['The Martian A Novel', 'Andy Weir - The Martian A Novel [M4B]', ...MARTIAN],
    ['The Getaway Car (MatchUp)', 'Lee Child - The Getaway Car (MatchUp) [M4B]', 'Getaway', 'Lee Child'],
    ['It Grows on You and Other Stories', 'It Grows on You and Other Stories by Stephen King [M4B]', ...IT],
    ['You Like It Darker - Stories', 'Stephen King - You Like It Darker - Stories [M4B]', ...IT],
    ['You Like It Darker: It Grows on You', 'Stephen King - You Like It Darker: It Grows on You [M4B]', ...IT],
    ['You Like It Darker (It Grows on You, ...)', 'Stephen King - You Like It Darker (It Grows on You, Rattlesnakes) [M4B]', ...IT],
    ['a list of titles', 'Stephen King - Billy Summers, It, The Stand [M4B]', ...IT],
    ['The It Crowd', 'The It Crowd by Stephen King [M4B]', ...IT],
    ['It Ends With Us', 'It Ends With Us by Stephen King [M4B]', ...IT],
    ['It Grows on You with a bitrate', 'Stephen King - It Grows on You 64kbps MP3', ...IT],
    ['each occurrence is judged on its own', 'Stephen King - It Grows on You and Other It - Stories [M4B]', ...IT],
    ['a sibling with no number', "Tom Clancy's Op-Center: Out of the Ashes (2014) [M4B]", ...OP_CENTER],
    ['"One" is not Book 1', 'Sarah Crossan - Moonrise Book 1 [MP3]', 'One', 'Sarah Crossan'],
    ['"Twelve" is not a bare 12', 'Jasper Kent - Thirteen Years Later Book 2 12 [MP3]', 'Twelve', 'Jasper Kent'],
  ])('%s', (_name, release, title, author, shape) => {
    const { match, total } = rank(release, title, author, shape);
    expect(match).toBe(0);
    expect(total).toBeLessThan(50);
  });
});

describe('automatic search: right books still clear the threshold', () => {
  // [case, release, title, author, lang]: main also passes every row
  it.each<[string, string, string, string, SupportedLanguage?]>([
    ['article after the author (dots)', 'Andy.Weir.The.Martian.Unabridged.M4B', ...MARTIAN],
    ['article after the author, year', 'Andy Weir The Martian 2014 [M4B]', ...MARTIAN],
    ['scene name with underscores', 'Andy_Weir-The_Martian-AUDIOBOOK-WEB-EN-2014-GRP', ...MARTIAN],
    ['dash and unabridged tag', 'Andy Weir - The Martian (Unabridged) [M4B]', ...MARTIAN],
    ['The Shining with a year', 'Stephen.King.The.Shining.1977.MP3', 'The Shining', 'Stephen King'],
    ['The Firm unabridged', 'John.Grisham.The.Firm.Unabridged.MP3', 'The Firm', 'John Grisham'],
    ['collapsed initials before the article', 'JRR Tolkien The Hobbit 1937 MP3', 'The Hobbit', 'J.R.R. Tolkien'],
    ['bitrate after the title', 'Frank.Herbert.Dune.64kbps.MP3', ...DUNE],
    ['short bitrate after the title', 'Frank Herbert Dune 128k M4B', ...DUNE],
    ['ordinal edition', 'Frank Herbert - Dune 40th Anniversary Edition [M4B]', ...DUNE],
    ['retail', 'Frank.Herbert.Dune.Retail.M4B', ...DUNE],
    ['leading bracket tag', '[M4B] Dune - Frank Herbert', ...DUNE],
    ['leading parenthesis tag', '(Audiobook) Dune by Frank Herbert', ...DUNE],
    ['number right before an occurrence', 'Dune Chronicles 01 Dune Frank Herbert M4B', ...DUNE],
    ['numbered pass-only, as on main', 'Dune Book 1 by Frank Herbert [M4B]', ...DUNE],
    ['It by', 'It by Stephen King [ENG / M4B]', ...IT],
    ['It - author', 'It - Stephen King [M4B]', ...IT],
    ['author - It', 'Stephen King - It [M4B]', ...IT],
    ['author - It (Unabridged)', 'Stephen King - It (Unabridged) [M4B]', ...IT],
    ['dotted with a year', 'Stephen.King.It.2017.MP3', ...IT],
    ['possessive author', 'Stephen.Kings.It.MP3', ...IT],
    ['read by', 'Stephen King - It Read by Steven Weber [M4B]', ...IT],
    ['year glued to the author', 'Stephen King2017 - It [M4B]', ...IT],
    ['glued author name', 'leechild-getaway-mp3', 'Getaway', 'Lee Child'],
    ['possessive brand', "Brandon Sanderson's Mistborn [M4B]", 'Mistborn', 'Brandon Sanderson'],
    ['possessive brand, longer title', "Robert Ludlum's The Bourne Evolution [M4B]", 'The Bourne Evolution', 'Robert Ludlum'],
    ['subtitle word after the title', 'Yuval Noah Harari - Sapiens A Brief History [M4B]', 'Sapiens: A Brief History of Humankind', 'Yuval Noah Harari'],
    ['subtitle with the author last', 'Sapiens.Brief.History.of.Humankind.Yuval.Noah.Harari.MP3', 'Sapiens: A Brief History of Humankind', 'Yuval Noah Harari'],
    ['colon subtitle, pass-only as on main', 'Mistborn: The Final Empire by Brandon Sanderson [M4B]', 'Mistborn', 'Brandon Sanderson'],
    ['series prefix', 'Brandon Sanderson - Mistborn - 01 - The Final Empire [M4B]', 'Mistborn: The Final Empire', 'Brandon Sanderson'],
    ['e2e shape', 'Andy Weir - Artemis (Unabridged) [MP3 64kbps]', 'Artemis', 'Andy Weir'],
    ['spelled-out number', 'The Seven Habits of Highly Effective People by Stephen R. Covey [M4B]', 'The 7 Habits of Highly Effective People', 'Stephen R. Covey'],
    ['Op-Center #12', "Tom Clancy's Op-Center #12: War of Eagles [ENG / M4B]", ...OP_CENTER],
    ['Op-Center 12, dashes', 'Tom Clancy - Op-Center 12 - War of Eagles [M4B]', ...OP_CENTER],
    ['Op-Center 12, dots', 'Tom.Clancys.Op-Center.12.War.of.Eagles.MP3', ...OP_CENTER],
    ['sub-series marker is not the volume', 'Terry Pratchett - Discworld 08 - City Watch Book 1 - Guards! Guards! [MP3]', 'Guards! Guards! (Discworld, Book 8)', 'Terry Pratchett'],
    ['de: ungekuerzt', 'Sebastian Fitzek - Das Paket ungekuerzt [MP3]', 'Das Paket', 'Sebastian Fitzek', 'de'],
    ['de: dotted with German', 'Sebastian.Fitzek.Das.Paket.2016.German.MP3', 'Das Paket', 'Sebastian Fitzek', 'de'],
    ['fr: FR tag', 'Joel Dicker - Le Tigre FR [MP3]', 'Le Tigre', 'Joël Dicker', 'fr'],
    ['fr: livre audio', 'Albert.Camus.La.Peste.Livre.Audio.FR.MP3', 'La Peste', 'Albert Camus', 'fr'],
    ['fr: matching volume T1', 'Le.Probleme.a.Trois.Corps.T1.Liu.Cixin.VFF.[M4B.128kbs]-NOTAG', 'Le problème à trois corps (book 1)', 'Liu Cixin', 'fr'],
    ['fr: matching volume T01', 'Matt Dinniman - Dungeon Crawler Carl, T01 - 2024 [M4B] - SGFx', 'Dungeon Crawler Carl (book 1)', 'Matt Dinniman', 'fr'],
    ['fr: Book N as a bare number', 'Primal.Hunter.1.Zogarth.2024.FR.[MP3.128.KBPS]-NOTAG', 'Primal Hunter 1', 'Zogarth', 'fr'],
    ['es: audiolibro completo', 'Isabel Allende Paula Audiolibro Completo MP3', 'Paula', 'Isabel Allende', 'es'],
    ['it: letto da', 'Italo.Calvino.Palomar.Letto.Da.Pietro.Biondi.MP3', 'Palomar', 'Italo Calvino', 'it'],
  ])('%s', (_name, release, title, author, lang) => {
    const { match, total } = rank(release, title, author, { lang });
    expect(match).toBeGreaterThan(0);
    expect(total).toBeGreaterThanOrEqual(50);
  });

  it.each([
    ['Andy Weir - The Martian.epub', ...MARTIAN],
    ['Frank Herbert - Dune retail epub', ...DUNE],
  ])('ebook: %s', (release, title, author) => {
    const [ranked] = rankEbookTorrents(
      [{ indexer: 'X', indexerId: 1, title: release, size: 2 * MB, publishDate: new Date('2025-01-01'), downloadUrl: 'x', guid: 'g' }],
      { title, author, preferredFormat: 'epub' },
      { requireAuthor: true },
    );
    expect(ranked.breakdown.matchScore).toBeGreaterThan(0);
    expect(ranked.score).toBeGreaterThanOrEqual(50);
  });

  it('interactive search still lists a book that only contains the title word', () => {
    expect(rank('You Like It Darker by Stephen King [ENG / M4B]', ...IT, { requireAuthor: false }).match).toBeGreaterThan(0);
  });
});

describe('automatic search: right books that scored low on main', () => {
  it.each<[string, string, string, string, number, SupportedLanguage?]>([
    ['N1 a colon subtitle that agrees with the request', 'Deep Down: A Reacher Story by Lee Child [ENG / MP3]', 'Deep Down (A Jack Reacher short story)', 'Lee Child', 60],
    ['N2 initials earn author credit', 'Naked in Death by JD Robb [ENG / M4B]', 'Naked in Death', 'J D Robb', 60],
    ['N3 a two-letter title, dash', 'Stephen King - It (Unabridged) [M4B]', ...IT, 60],
    ['N3 a two-letter title, dots', 'Stephen.King.It.2017.MP3', ...IT, 60],
  ])('%s', (_name, release, title, author, expected, lang) => {
    expect(rank(release, title, author, { lang }).match).toBeCloseTo(expected, 5);
  });

  it.each<[string, string, string, string, SupportedLanguage?]>([
    ['N3 a two-letter title, glued CamelCase', 'StephenKing-It-AUDIOBOOK-64kbs', ...IT],
    ['N4 a zero-padded number', 'Primal.Hunter.01.Zogarth.2024.FR.[MP3.128.KBPS]-NOTAG', 'Primal Hunter 1', 'Zogarth', 'fr'],
    ['a spelled-out number in the release', 'Thirteen Reasons Why by Jay Asher [M4B]', '13 Reasons Why', 'Jay Asher'],
  ])('%s', (_name, release, title, author, lang) => {
    const { match, total } = rank(release, title, author, { lang });
    expect(match).toBeGreaterThan(0);
    expect(total).toBeGreaterThanOrEqual(50);
  });

  it.each([
    ['Mistborn: The Well of Ascension by Brandon Sanderson [M4B]', 'Mistborn', 'Brandon Sanderson'],
    ['Deep Down: Second Son by Lee Child [ENG / MP3]', 'Deep Down (A Jack Reacher short story)', 'Lee Child'],
    ['Dungeon Crawler Carl: The Gate of the Feral Gods by Matt Dinniman [M4B]', 'Dungeon Crawler Carl: A LitRPG Adventure', 'Matt Dinniman'],
  ])('a colon subtitle that differs from the request earns no complete-title credit: %s', (release, title, author) => {
    expect(rank(release, title, author).match).toBeLessThan(45);
  });
});
