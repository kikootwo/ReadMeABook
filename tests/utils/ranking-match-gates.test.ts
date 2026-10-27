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
const DIVERGENT = ['Divergent (Divergent Trilogy, Book 1)', 'Veronica Roth'] as const;
const DUNE_1 = ['Dune (Dune Chronicles, Book 1)', 'Frank Herbert'] as const;
const FOUNDATION = ['Foundation', 'Isaac Asimov'] as const;
const big = { sizeMB: 1500, minutes: 2683 };

describe('automatic search: wrong books are rejected by a gate', () => {
  // [case, release, title, author, inputs]: main grabs every row (total >= 50) except "One" and "Twelve"
  it.each<[string, string, string, string, Shape?]>([
    ['F1 a book containing the one-word title', 'You Like It Darker by Stephen King [ENG / M4B]', ...IT, big],
    ['F3 an anthology starting with the title word', 'The Getaway Car - MatchUp by Lee Child [ENG / M4B]', 'Getaway', 'Lee Child', { sizeMB: 800, minutes: 90 }],
    ['F4 sibling volume, bare number', "Tom Clancy's Op-Center 11 - Call to Treason [ENG / M4B]", ...OP_CENTER, { sizeMB: 500, minutes: 720, seeders: 30 }],
    ['F4b sibling volume, #number', "Tom Clancy's Op-Center #11: Call to Treason by Tom Clancy [ENG / M4B]", ...OP_CENTER, { sizeMB: 500, minutes: 720, seeders: 30 }],
    ['F5 other volume, T2 after the title', 'Le.Probleme.a.Trois.Corps.T2.La.Foret.Sombre.Liu.Cixin.VFF.[M4B.128kbs]-NOTAG', 'Le problème à trois corps (book 1)', 'Liu Cixin', { sizeMB: 900, minutes: 900, seeders: 20, lang: 'fr' }],
    ['F6 other volume, T03 after the title', "Matt Dinniman - Dungeon Crawler Carl, T03 Le Livre de recettes de l'Anarchiste - 2025 [M4B 16 bits 44.1 kHz] - SGFx", 'Dungeon Crawler Carl (book 1)', 'Matt Dinniman', { sizeMB: 900, minutes: 800, seeders: 20, lang: 'fr' }],
    ['F7 author name inside other words', 'Weird Candy Hail by Rando [M4B]', 'Hail', 'Andy Weir', { sizeMB: 900, minutes: 800, seeders: 60 }],
    ['F7b surname inside a longer word', 'Children of the Fleet by Orson Scott Card [M4B]', 'The Fleet', 'Lee Child', { sizeMB: 900, minutes: 800, seeders: 60 }],
    ['The Getaway Car (MatchUp)', 'Lee Child - The Getaway Car (MatchUp) [M4B]', 'Getaway', 'Lee Child'],
    ['The Great Getaway', 'Lee Child - The Great Getaway [M4B]', 'Getaway', 'Lee Child'],
    ['Not The Martian', 'Andy Weir - Not The Martian [M4B]', ...MARTIAN],
    ['Secret History of Mistborn', 'Brandon Sanderson - Secret History of Mistborn [M4B]', 'Mistborn', 'Brandon Sanderson'],
    ['You Like It Darker - Stories', 'Stephen King - You Like It Darker - Stories [M4B]', ...IT],
    ['You Like It Darker (It Grows on You, ...)', 'Stephen King - You Like It Darker (It Grows on You, Rattlesnakes) [M4B]', ...IT],
    ['a list of titles', 'Stephen King - Billy Summers, It, The Stand [M4B]', ...IT],
    ['The It Crowd', 'The It Crowd by Stephen King [M4B]', ...IT],
    ['dash-only name, author first', 'Stephen-King-You-Like-It-Darker-ENG-M4B', ...IT, big],
    ['dash-only name, author last', 'You-Like-It-Darker-Stephen-King-M4B', ...IT, big],
    ['dash-only name, article not in the request', 'Lee-Child-The-Getaway-Car-MatchUp', 'Getaway', 'Lee Child'],
    ['Children of Dune', 'Frank Herbert - Children of Dune [M4B]', ...DUNE],
    ['God Emperor of Dune', 'Frank Herbert - God Emperor of Dune [M4B]', ...DUNE],
    ['Heretics of Dune', 'Frank Herbert - Heretics of Dune [M4B]', ...DUNE],
    ['Chapterhouse Dune', 'Frank Herbert - Chapterhouse Dune [M4B]', ...DUNE],
    ['Second Foundation', 'Isaac Asimov - Second Foundation [M4B]', ...FOUNDATION],
    ['Second Foundation, dots', 'Isaac.Asimov.Second.Foundation.MP3', ...FOUNDATION],
    ['Prelude to Foundation', 'Isaac Asimov - Prelude to Foundation [M4B]', ...FOUNDATION],
    ['Forward the Foundation', 'Isaac Asimov - Forward the Foundation (Unabridged) [MP3]', ...FOUNDATION],
    ['The Fall of Hyperion', 'Dan Simmons - The Fall of Hyperion [M4B]', 'Hyperion', 'Dan Simmons'],
    ['sequel after the series name', 'Veronica Roth - Divergent Trilogy 2 - Insurgent [M4B]', ...DIVERGENT],
    ['sequel after the series name, author last', 'Dune Chronicles 2 - Dune Messiah - Frank Herbert', ...DUNE_1],
    ['sequel after the series name, author first', 'Frank Herbert - Dune Chronicles 2 - Dune Messiah [M4B]', ...DUNE_1],
    ['sequel after a request subtitle word', 'Stephenie Meyer - Twilight Saga 2 - New Moon [M4B]', 'Twilight (The Twilight Saga, Book 1)', 'Stephenie Meyer'],
    ['sequel, zero-padded', 'Marie Lu - Legend Trilogy 03 - Champion [M4B]', 'Legend (Legend Trilogy, Book 1)', 'Marie Lu'],
    ['sequel after another subtitle word', 'Christopher Paolini - Eragon Inheritance 2 - Eldest', 'Eragon (The Inheritance Cycle, Book 1)', 'Christopher Paolini'],
    ['sequel after a one-word series name', 'Hugh Howey - Wool Silo 3', 'Wool (Silo, Book 1)', 'Hugh Howey'],
    ['G1: a colon subtitle naming another number', 'Mistborn: Mistborn 2 by Brandon Sanderson', 'Mistborn (Mistborn, Book 1)', 'Brandon Sanderson'],
    ['G1: a colon subtitle naming another book', 'Mistborn: Mistborn Book 2 by Brandon Sanderson', 'Mistborn (Mistborn, Book 1)', 'Brandon Sanderson'],
    ['a colon series subtitle naming another number', 'Pierce Brown - Red Rising: Red Rising Saga 2 [M4B]', 'Red Rising (Red Rising Saga, Book 1)', 'Pierce Brown'],
    ['a number before a colon split is the position', 'Shirtaloon - He Who Fights with Monsters 2 [M4B]', 'He Who Fights with Monsters 1: A LitRPG Adventure', 'Shirtaloon'],
    ['a sibling with no number', "Tom Clancy's Op-Center: Out of the Ashes (2014) [M4B]", ...OP_CENTER],
    ['"One" is not Book 1', 'Sarah Crossan - Moonrise Book 1 [MP3]', 'One', 'Sarah Crossan'],
    ['"Twelve" is not a bare 12', 'Jasper Kent - Thirteen Years Later Book 2 12 [MP3]', 'Twelve', 'Jasper Kent'],
  ])('%s', (_name, release, title, author, shape) => {
    const { match, total } = rank(release, title, author, shape);
    expect(match).toBe(0);
    expect(total).toBeLessThan(50);
  });
});

describe('automatic search: a one-word title is checked on its left only', () => {
  // [case, release, title, author, main matchScore, inputs]: nothing after the word is read, so these score as on main
  it.each<[string, string, string, string, number, Shape?]>([
    ['F2 a book starting with the one-word title', 'It Grows on You by Stephen King [ENG / M4B]', ...IT, 17.903, big],
    ['F2, dash-only name', 'It-Grows-On-You-by-Stephen-King-M4B', ...IT, 18.214, big],
    ['F2 with a bitrate', 'Stephen King - It Grows on You 64kbps MP3', ...IT, 17.813],
    ['F2 after a colon', 'Stephen King - You Like It Darker: It Grows on You [M4B]', ...IT, 17.195],
    ['a number before the word', 'Stephen King - Book 1 It Grows on You [M4B]', ...IT, 17.903, big],
    ['It Ends With Us', 'It Ends With Us by Stephen King [M4B]', ...IT, 18.214],
    ['Pin Drop for Pin', 'Pin Drop by Stephen King [M4B]', 'Pin', 'Stephen King', 22.5],
    ['Mistborn sequel, no separator', 'Mistborn The Well of Ascension by Brandon Sanderson [M4B]', 'Mistborn', 'Brandon Sanderson', 26.887],
    ['The Martian Chronicles', 'Andy Weir The Martian Chronicles [M4B]', ...MARTIAN, 35.769],
    ['Dune Messiah', 'Frank Herbert - Dune Messiah [M4B]', ...DUNE, 24.643],
    ['Chapterhouse: Dune', 'Frank Herbert - Chapterhouse: Dune [M4B]', ...DUNE, 60],
    ['sequel after a series word the request lacks', 'Scott Westerfeld - Uglies Series 2 - Pretties [M4B]', 'Uglies (Uglies, Book 1)', 'Scott Westerfeld', 26.667],
    ['a number word after the volume word', 'Dune: Book Two by Frank Herbert', ...DUNE_1, 26.739],
  ])('%s', (_name, release, title, author, mainMatch, shape) => {
    expect(rank(release, title, author, shape).match).toBeCloseTo(mainMatch, 2);
  });
});

describe('automatic search: right books still clear the threshold', () => {
  // [case, release, title, author, lang]: main also passes every row
  it.each<[string, string, string, string, SupportedLanguage?]>([
    ['article after the author (dots)', 'Andy.Weir.The.Martian.Unabridged.M4B', ...MARTIAN],
    ['article after the author, year', 'Andy Weir The Martian 2014 [M4B]', ...MARTIAN],
    ['scene name with underscores', 'Andy_Weir-The_Martian-AUDIOBOOK-WEB-EN-2014-GRP', ...MARTIAN],
    ['dash and unabridged tag', 'Andy Weir - The Martian (Unabridged) [M4B]', ...MARTIAN],
    ['the book\'s own subtitle', 'Andy Weir - The Martian A Novel [M4B]', ...MARTIAN],
    ['the book\'s own subtitle, no separator', 'Andy Weir The Martian A Novel M4B', ...MARTIAN],
    ['The Shining with a year', 'Stephen.King.The.Shining.1977.MP3', 'The Shining', 'Stephen King'],
    ['The Firm unabridged', 'John.Grisham.The.Firm.Unabridged.MP3', 'The Firm', 'John Grisham'],
    ['collapsed initials before the article', 'JRR Tolkien The Hobbit 1937 MP3', 'The Hobbit', 'J.R.R. Tolkien'],
    ['collapsed initials after the title', 'The Hobbit JRR Tolkien MP3', 'The Hobbit', 'J.R.R. Tolkien'],
    ['surname with its particle, no middle initial', 'Ursula Le Guin Earthsea MP3', 'Earthsea', 'Ursula K. Le Guin'],
    ['surname first', 'Herbert Frank Dune MP3', ...DUNE],
    ['surname first, after the title', 'Dune Herbert, Frank', ...DUNE],
    ['bitrate after the title', 'Frank.Herbert.Dune.64kbps.MP3', ...DUNE],
    ['short bitrate after the title', 'Frank Herbert Dune 128k M4B', ...DUNE],
    ['ordinal edition', 'Frank Herbert - Dune 40th Anniversary Edition [M4B]', ...DUNE],
    ['retail', 'Frank.Herbert.Dune.Retail.M4B', ...DUNE],
    ['narrator after the title', 'Frank Herbert Dune Scott Brick 2007 MP3', ...DUNE],
    ['aax', 'Frank Herbert - Dune AAX', ...DUNE],
    ['leading bracket tag', '[M4B] Dune - Frank Herbert', ...DUNE],
    ['leading parenthesis tag', '(Audiobook) Dune by Frank Herbert', ...DUNE],
    ['number right before an occurrence', 'Dune Chronicles 01 Dune Frank Herbert M4B', ...DUNE],
    ['series number right before a one-word title', 'Brandon Sanderson - Stormlight Archive 3 Oathbringer [M4B]', 'Oathbringer', 'Brandon Sanderson'],
    ['series number right before a one-word title, two-word series', 'Suzanne Collins - Hunger Games 3 Mockingjay [M4B]', 'Mockingjay', 'Suzanne Collins'],
    ['dotted series number before a one-word title', 'Terry.Pratchett.Discworld.04.Mort.MP3', 'Mort', 'Terry Pratchett'],
    ['dotted series number before a one-word title, one-word series', 'Hugh.Howey.Silo.01.Wool.MP3', 'Wool', 'Hugh Howey'],
    ['numbered pass-only, as on main', 'Dune Book 1 by Frank Herbert [M4B]', ...DUNE],
    ['a bitrate number after the series name', 'Frank Herbert Dune 64 kbps MP3', ...DUNE_1],
    ['a disc count after the series name', 'Frank Herbert Dune 2 CD MP3', ...DUNE_1],
    ['It by', 'It by Stephen King [ENG / M4B]', ...IT],
    ['It - author', 'It - Stephen King [M4B]', ...IT],
    ['author - It', 'Stephen King - It [M4B]', ...IT],
    ['author - It (Unabridged)', 'Stephen King - It (Unabridged) [M4B]', ...IT],
    ['read by', 'Stephen King - It Read by Steven Weber [M4B]', ...IT],
    ['dotted with a year', 'Stephen.King.It.2017.MP3', ...IT],
    ['possessive author', 'Stephen.Kings.It.MP3', ...IT],
    ['part of a split release', 'Stephen King - It Part 1 of 2 [M4B]', ...IT],
    ['year glued to the author', 'Stephen King2017 - It [M4B]', ...IT],
    ['glued author name', 'leechild-getaway-mp3', 'Getaway', 'Lee Child'],
    ['possessive brand', "Brandon Sanderson's Mistborn [M4B]", 'Mistborn', 'Brandon Sanderson'],
    ['possessive brand, longer title', "Robert Ludlum's The Bourne Evolution [M4B]", 'The Bourne Evolution', 'Robert Ludlum'],
    ['series word after the title', 'Brandon Sanderson - Mistborn Trilogy 01 - The Final Empire [M4B]', 'Mistborn: The Final Empire', 'Brandon Sanderson'],
    ['subtitle word after the title', 'Yuval Noah Harari - Sapiens A Brief History [M4B]', 'Sapiens: A Brief History of Humankind', 'Yuval Noah Harari'],
    ['subtitle with the author last', 'Sapiens.Brief.History.of.Humankind.Yuval.Noah.Harari.MP3', 'Sapiens: A Brief History of Humankind', 'Yuval Noah Harari'],
    ['colon subtitle, pass-only as on main', 'Mistborn: The Final Empire by Brandon Sanderson [M4B]', 'Mistborn', 'Brandon Sanderson'],
    ['series prefix', 'Brandon Sanderson - Mistborn - 01 - The Final Empire [M4B]', 'Mistborn: The Final Empire', 'Brandon Sanderson'],
    ['e2e shape', 'Andy Weir - Artemis (Unabridged) [MP3 64kbps]', 'Artemis', 'Andy Weir'],
    ['spelled-out number', 'The Seven Habits of Highly Effective People by Stephen R. Covey [M4B]', 'The 7 Habits of Highly Effective People', 'Stephen R. Covey'],
    ['Op-Center #12', "Tom Clancy's Op-Center #12: War of Eagles [ENG / M4B]", ...OP_CENTER],
    ['Op-Center 12, dashes', 'Tom Clancy - Op-Center 12 - War of Eagles [M4B]', ...OP_CENTER],
    ['Op-Center 12, dots', 'Tom.Clancys.Op-Center.12.War.of.Eagles.MP3', ...OP_CENTER],
    ['a box set holding the requested volume', 'J.K. Rowling - Harry Potter Book 1-7 - Philosophers Stone, Chamber of Secrets, Prisoner of Azkaban', 'Chamber of Secrets (Harry Potter, Book 2)', 'J.K. Rowling'],
    ['a box set, Vol range', 'Harry Potter Vol 1-3 Chamber of Secrets J.K. Rowling', 'Chamber of Secrets (Harry Potter, Book 2)', 'J.K. Rowling'],
    ['sub-series marker is not the volume', 'Terry Pratchett - Discworld 08 - City Watch Book 1 - Guards! Guards! [MP3]', 'Guards! Guards! (Discworld, Book 8)', 'Terry Pratchett'],
    ['a number before a colon split is not required', 'Shirtaloon - He Who Fights with Monsters [M4B]', 'He Who Fights with Monsters 1: A LitRPG Adventure', 'Shirtaloon'],
    ['Bk1 names the number', 'Shirtaloon - He Who Fights with Monsters Bk1 [M4B]', 'He Who Fights with Monsters 1', 'Shirtaloon'],
    ['de: a number before ". " is not required', 'Suzanne Collins - Die Tribute von Panem - Tödliche Spiele (ungekürzt) [MP3]', 'Die Tribute von Panem 1. Tödliche Spiele', 'Suzanne Collins', 'de'],
    ['de: a number before " - " is not required', 'Sarah J. Maas - Throne of Glass - Die Erwählte [MP3]', 'Throne of Glass 1 - Die Erwählte', 'Sarah J. Maas', 'de'],
    ['de: ungekuerzt', 'Sebastian Fitzek - Das Paket ungekuerzt [MP3]', 'Das Paket', 'Sebastian Fitzek', 'de'],
    ['de: inflected edition word', 'Sebastian Fitzek - Das Paket ungekürzte Lesung [MP3]', 'Das Paket', 'Sebastian Fitzek', 'de'],
    ['de: dotted with German', 'Sebastian.Fitzek.Das.Paket.2016.German.MP3', 'Das Paket', 'Sebastian Fitzek', 'de'],
    ['de: Teil', 'Stephen King Es Teil 1 MP3', 'Es', 'Stephen King', 'de'],
    ['fr: FR tag', 'Joel Dicker - Le Tigre FR [MP3]', 'Le Tigre', 'Joël Dicker', 'fr'],
    ['fr: livre audio', 'Albert.Camus.La.Peste.Livre.Audio.FR.MP3', 'La Peste', 'Albert Camus', 'fr'],
    ['fr: texte integral', 'Albert.Camus.La.Peste.Texte.Integral.MP3', 'La Peste', 'Albert Camus', 'fr'],
    ['fr: matching volume T1', 'Le.Probleme.a.Trois.Corps.T1.Liu.Cixin.VFF.[M4B.128kbs]-NOTAG', 'Le problème à trois corps (book 1)', 'Liu Cixin', 'fr'],
    ['fr: matching volume T01', 'Matt Dinniman - Dungeon Crawler Carl, T01 - 2024 [M4B] - SGFx', 'Dungeon Crawler Carl (book 1)', 'Matt Dinniman', 'fr'],
    ['fr: Book N as a bare number', 'Primal.Hunter.1.Zogarth.2024.FR.[MP3.128.KBPS]-NOTAG', 'Primal Hunter 1', 'Zogarth', 'fr'],
    ['es: audiolibro completo', 'Isabel Allende Paula Audiolibro Completo MP3', 'Paula', 'Isabel Allende', 'es'],
    ['es: language word', 'Isabel.Allende.Paula.Espanol.MP3', 'Paula', 'Isabel Allende', 'es'],
    ['it: letto da', 'Italo.Calvino.Palomar.Letto.Da.Pietro.Biondi.MP3', 'Palomar', 'Italo Calvino', 'it'],
    ['it: language word', 'Italo Calvino Palomar Italiano MP3', 'Palomar', 'Italo Calvino', 'it'],
    ['Korean audiobook word', '한강 채식주의자 오디오북', '채식주의자', '한강'],
    ['Greek audiobook word', 'Νίκος Καζαντζάκης Ζορμπάς ηχοβιβλίο MP3', 'Ζορμπάς', 'Νίκος Καζαντζάκης'],
  ])('%s', (_name, release, title, author, lang) => {
    const { match, total } = rank(release, title, author, { lang });
    expect(match).toBeGreaterThan(0);
    expect(total).toBeGreaterThanOrEqual(50);
  });

  it.each([
    ['Andy Weir - The Martian.epub', ...MARTIAN],
    ['Andy Weir - The Martian.ePub', ...MARTIAN],
    ['Frank Herbert - Dune retail epub', ...DUNE],
    ['Frank Herbert - Dune.ePub', ...DUNE],
    ['Frank Herbert - Dune eBook EPUB', ...DUNE],
    ['Frank Herbert - Dune Ebook', ...DUNE],
    ['Frank Herbert Dune True PDF', ...DUNE],
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

describe('automatic search: the right book wins against its sibling', () => {
  /** What automatic search downloads: the first result at or over both thresholds */
  function pick(title: string, author: string, releases: [string, number, string][]): string | undefined {
    const torrents = releases.map(([name, seeders, date], i) => ({
      indexer: 'X', indexerId: 1, title: name, size: 900 * MB, seeders, publishDate: new Date(date), downloadUrl: `x${i}`, guid: `g${i}`,
    }));
    return rankTorrents(torrents, { title, author, durationMinutes: 900 }, { requireAuthor: true })
      .find((r) => r.score >= 50 && r.finalScore >= 50)?.title;
  }

  it.each<[string, string, string, [string, number, string][]]>([
    [...DIVERGENT, 'Veronica Roth - Divergent (Unabridged) [M4B]', [['Veronica Roth - Divergent (Unabridged) [M4B]', 20, '2024-01-01'], ['Veronica Roth - Divergent Trilogy 2 - Insurgent [M4B]', 20, '2025-01-01']]],
    [...DIVERGENT, 'Veronica.Roth.Divergent.Unabridged.M4B', [['Veronica.Roth.Divergent.Unabridged.M4B', 8, '2024-01-01'], ['Veronica Roth - Divergent Trilogy 2 - Insurgent [M4B]', 40, '2023-01-01']]],
    [...DUNE_1, 'Frank Herbert - Dune [M4B]', [['Frank Herbert - Dune [M4B]', 20, '2024-01-01'], ['Frank Herbert - Dune Chronicles 2 - Dune Messiah [M4B]', 20, '2025-01-01']]],
    [...DUNE_1, 'Frank Herbert - Dune [M4B]', [['Frank Herbert - Dune [M4B]', 5, '2024-01-01'], ['Dune Chronicles 2 - Dune Messiah - Frank Herbert', 80, '2025-01-01']]],
    ['Wool (Silo, Book 1)', 'Hugh Howey', 'Hugh Howey - Wool [M4B]', [['Hugh Howey - Wool [M4B]', 5, '2024-01-01'], ['Hugh Howey - Wool Silo 3', 80, '2025-01-01']]],
    ['Wool (Silo, Book 1)', 'Hugh Howey', 'Hugh Howey - Silo 1 Wool [M4B]', [['Hugh Howey - Silo 1 Wool [M4B]', 20, '2024-01-01'], ['Hugh Howey - Wool 2 - Proper Gauge [M4B]', 20, '2023-01-01']]],
    [...DUNE, 'Frank.Herbert.Dune.Unabridged.M4B', [['Frank.Herbert.Dune.Unabridged.M4B', 15, '2024-01-01'], ['Frank Herbert - Children of Dune [M4B]', 15, '2023-01-01']]],
    [...DUNE, 'Frank.Herbert.Dune.64kbps.MP3', [['Frank.Herbert.Dune.64kbps.MP3', 40, '2024-01-01'], ['Frank Herbert - Children of Dune [M4B]', 10, '2025-01-01'], ['Frank Herbert - God Emperor of Dune [M4B]', 10, '2025-01-01']]],
    [...FOUNDATION, 'Isaac.Asimov.Foundation.Unabridged.MP3', [['Isaac.Asimov.Foundation.Unabridged.MP3', 40, '2024-01-01'], ['Isaac Asimov - Second Foundation [M4B]', 10, '2025-01-01']]],
    ['Hyperion', 'Dan Simmons', 'Dan Simmons - Hyperion (Unabridged) [M4B]', [['Dan Simmons - Hyperion (Unabridged) [M4B]', 40, '2024-01-01'], ['Dan Simmons - The Fall of Hyperion [M4B]', 10, '2025-01-01']]],
  ])('%s: %s', (title, author, expected, releases) => {
    expect(pick(title, author, releases)).toBe(expected);
  });
});

describe('automatic search: words that do not name a position score as on main', () => {
  // [case, release, title, author, main matchScore]: a glued v2 can be a re-release tag; a number before a unit word is a length
  it.each<[string, string, string, string, number]>([
    ['a glued v2', 'Matt Dinniman - Dungeon Crawler Carl v2 [M4B]', 'Dungeon Crawler Carl (book 1)', 'Matt Dinniman', 45],
    ['a number before Hours', 'Robert Jordan - The Eye of the World - Wheel of Time 29 Hours [M4B]', 'The Eye of the World (The Wheel of Time, Book 1)', 'Robert Jordan', 60],
    ['a number before Discs', 'Veronica Roth - Divergent 2 Discs [MP3]', ...DIVERGENT, 34.459],
  ])('%s', (_name, release, title, author, mainMatch) => {
    expect(rank(release, title, author).match).toBeCloseTo(mainMatch, 2);
  });
});

describe('automatic search: right books that scored low on main', () => {
  it.each<[string, string, string, string, number, SupportedLanguage?]>([
    ['N1 a colon subtitle that agrees with the request', 'Deep Down: A Reacher Story by Lee Child [ENG / MP3]', 'Deep Down (A Jack Reacher short story)', 'Lee Child', 60],
    ['N2 initials earn author credit', 'Naked in Death by JD Robb [ENG / M4B]', 'Naked in Death', 'J D Robb', 60],
  ])('%s', (_name, release, title, author, expected, lang) => {
    expect(rank(release, title, author, { lang }).match).toBeCloseTo(expected, 5);
  });

  it.each<[string, string, string, string, SupportedLanguage?]>([
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
    ['Dune: Book 2', ...DUNE_1],
  ])('a colon subtitle that differs from the request earns no complete-title credit: %s', (release, title, author) => {
    expect(rank(release, title, author, { requireAuthor: false }).match).toBeLessThan(45);
  });
});

describe('apostrophes: a release name that drops or splits the apostrophe is the same title (#316, #466)', () => {
  // [case, release, title, author, lang]: main scores every row 0 (word coverage)
  const rows: [string, string, string, string, SupportedLanguage?][] = [
    ['#466 elision as a dot', 'L.Intruse.Freida.McFadden.2026.FR.[Mp3.128.Kbps]-NOTAG', "L'intruse", 'Freida McFadden', 'fr'],
    ['#466 elision inside the title', 'Changer.L.Eau.Des.Fleurs.Valerie.Perrin.2022.FR.[M4B.128.kbps]-AG404', "Changer l'eau des fleurs", 'Valérie Perrin', 'fr'],
    ['#466 possessive without the apostrophe', 'Enders.Game.Orson.Scott.Card.MP3', "Ender's Game", 'Orson Scott Card'],
    ['#316 possessive without the apostrophe', 'Matt Dinniman - The Dungeon Anarchists Cookbook [M4B]', "The Dungeon Anarchist's Cookbook", 'Matt Dinniman'],
    ['#316 possessive, scene name', 'Matt.Dinniman.The.Butchers.Masquerade.2022.M4B', "The Butcher's Masquerade", 'Matt Dinniman'],
    ['curly apostrophe in the request, straight in the release', "Orson Scott Card - Ender's Game [M4B]", 'Ender’s Game', 'Orson Scott Card'],
  ];

  it.each(rows)('automatic: %s', (_name, release, title, author, lang) => {
    const { match, total } = rank(release, title, author, { lang });
    expect(match).toBeGreaterThan(0);
    expect(total).toBeGreaterThanOrEqual(50);
  });

  it.each(rows)('interactive: %s', (_name, release, title, author, lang) => {
    expect(rank(release, title, author, { lang, requireAuthor: false }).match).toBeGreaterThan(0);
  });

  it('a longer title that adds a possessive is still not the requested title', () => {
    expect(rank('The Housemaids Secret - Freida McFadden [M4B]', 'The Housemaid', 'Freida McFadden').total).toBeLessThan(50);
  });

  // A request word without the apostrophe is a different word: a possessive release of the same author
  // scores match 0 (total 40 here) and is never picked automatically, as on main for a straight apostrophe
  it.each([
    ["David Levithan - The Lover's Dictionary [M4B]", 'The Lovers', 'David Levithan'],
    ["Rick Riordan - The Titan's Curse [M4B]", 'The Titans', 'Rick Riordan'],
    ["Margaret Atwood - The Handmaid's Tale [M4B]", 'The Handmaids', 'Margaret Atwood'],
    ["Liane Moriarty - The Husband's Secret [M4B]", 'The Husbands', 'Liane Moriarty'],
    ["Orson Scott Card - Ender's Game [M4B]", 'Enders', 'Orson Scott Card'],
    ['Orson Scott Card - Ender’s Game [M4B]', 'Enders Game', 'Orson Scott Card'],
    // main split a curly apostrophe into two words and picked these (70.4 and 76.5)
    ['David Levithan - The Lover’s Dictionary [M4B]', 'The Lover', 'David Levithan'],
    ['Freida McFadden - The Housemaid’s Secret [M4B]', 'The Housemaid', 'Freida McFadden'],
  ])('a possessive release for a request without the apostrophe: %s for "%s"', (release, title, author) => {
    expect(rank(release, title, author)).toEqual({ match: 0, total: 40 });
    expect(rank(release, title, author, { requireAuthor: false }).match).toBe(0);
  });

  it('a possessive release still matches the request that has the apostrophe', () => {
    expect(rank("Margaret Atwood - The Handmaid's Tale [M4B]", "The Handmaid's Tale", 'Margaret Atwood').total).toBeGreaterThanOrEqual(50);
    expect(rank('Liane Moriarty - The Husband’s Secret [M4B]', "The Husband's Secret", 'Liane Moriarty').total).toBeGreaterThanOrEqual(50);
  });

  it("a kept possessive on the author's name still counts as the author", () => {
    const withPossessive = rank("Stephen King's The Stand [M4B]", 'The Stand', 'Stephen King');
    expect(withPossessive.total).toBeGreaterThanOrEqual(50);
  });
});
