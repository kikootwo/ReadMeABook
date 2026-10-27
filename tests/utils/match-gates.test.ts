/**
 * Component: Automatic-Search Match Gates Tests (helper units)
 * Documentation: documentation/phase3/match-gates.md
 */

import { describe, expect, it } from 'vitest';
import {
  authorAppears, colonSubtitleAgrees, foldNumberWord, foldReleaseWords, isAuthorPresent, missingRequiredNumber,
  shortTitleStandsAlone, shortTitleWord, splitPositionNumbers, volumeConflict, ShortTitleContext,
} from '@/lib/utils/match-gates';

const EN = ['the', 'a', 'an', 'of', 'on', 'in', 'at', 'by', 'for'];

describe('numbers (G4a)', () => {
  it.each([
    ['01', '1'], ['007', '7'], ['0', '0'], ['12', '12'], ['seven', '7'], ['twenty', '20'],
    ['twentyone', 'twentyone'], ['dune', 'dune'], ['constructor', 'constructor'],
  ])('folds %s to %s', (word, folded) => {
    expect(foldNumberWord(word)).toBe(folded);
  });

  it('reads the number inside volume tokens, never a bare word', () => {
    expect(foldReleaseWords(['primal', 'hunter', 't01', 'tome2', 'vol3', 'v4', 'book05', 'livre6', 'bk7', 'mp3']))
      .toEqual(['primal', 'hunter', 't01', 'tome2', 'vol3', 'v4', 'book05', 'livre6', 'bk7', 'mp3', '1', '2', '3', '4', '5', '6', '7']);
  });

  it('requires every required number, and ignores extra release numbers', () => {
    expect(missingRequiredNumber(['op', 'center', '12'], foldReleaseWords(['op', 'center', '11', '2014']))).toBe(true);
    expect(missingRequiredNumber(['primal', 'hunter', '1'], foldReleaseWords(['primal', 'hunter', '01', '2024', '128']))).toBe(false);
    expect(missingRequiredNumber(['dune'], ['dune', '2021', '64'])).toBe(false);
  });

  it.each<[string, string[]]>([
    ['Die Tribute von Panem 1. Tödliche Spiele', ['1']],
    ['Throne of Glass 01 - Die Erwählte', ['1']],
    ['He Who Fights with Monsters 1: A LitRPG Adventure', ['1']],
    ["Tom Clancy's Op-Center #12: War of Eagles", []],
    ['Primal Hunter 1', []],
    ['Book 2.5 - Interlude', []],
    ['1984', []],
  ])('reads a series position before a subtitle split: %s', (title, positions) => {
    expect([...splitPositionNumbers(title)]).toEqual(positions);
  });
});

describe('author names as whole words (G3)', () => {
  it.each([
    ['lee child getaway', 'lee child', true],
    ['leechild getaway mp3', 'lee child', true],
    ['stephenking it', 'stephen king', true],
    ["brandon sanderson's mistborn", 'brandon sanderson', true],
    ['tom clancys op center', 'tom clancy', true],
    ['stephen king2017 it', 'stephen king', true],
    ['children of the fleet', 'lee child', false],
    ['weird candy hail', 'andy weir', false],
    ['刘慈欣三体全集mp3', '刘慈欣', true],
    ['', 'andy weir', false],
    ['andy weir', '', false],
  ])('%s / %s → %s', (title, author, expected) => {
    expect(authorAppears(title, author)).toBe(expected);
  });

  it('keeps the four presence checks', () => {
    expect(isAuthorPresent('sanderson brandon mistborn', ['brandon sanderson'])).toBe(true); // 3: name order
    expect(isAuthorPresent('naked in death by jd robb', ['j d robb'])).toBe(true);           // 4: initials
    expect(isAuthorPresent('weird candy hail by rando', ['andy weir'])).toBe(false);         // 3 no longer by substring
    expect(isAuthorPresent('dennis taylor we are legion', ['dennis e taylor'])).toBe(true);
    expect(isAuthorPresent('anything', [''])).toBe(false);
  });
});

describe('colon subtitle agreement (G1)', () => {
  const words = (text: string) => text.toLowerCase().split(/\W+/).filter((w) => w && !EN.includes(w));
  it.each([
    [': a reacher story by lee child', ['jack', 'reacher', 'short', 'story'], true],
    [': second son by lee child', ['jack', 'reacher', 'short', 'story'], false],
    [': the well of ascension', [], false],
    [' - a reacher story', ['reacher', 'story'], false],
    [': book two by frank herbert', ['dune', 'chronicles', 'book', '1'], false],
    [': mistborn 2 by brandon sanderson', ['mistborn', 'book', '1'], false],
    [': book 1', ['mistborn', 'book', '1'], false],
    [': mistborn book 1', ['mistborn', 'book', '1'], true],
  ])('%s', (after, subtitle, expected) => {
    expect(colonSubtitleAgrees(after, new Set(subtitle), words)).toBe(expected);
  });
});

describe('one-word titles (G4b)', () => {
  it('applies to one word with no digit in a spaced script', () => {
    expect(shortTitleWord(['it'])).toBe('it');
    expect(shortTitleWord(['1q84'])).toBeNull();
    expect(shortTitleWord(['心'])).toBeNull();
    expect(shortTitleWord(['dune', 'messiah'])).toBeNull();
  });

  const ctx = (word: string, authors: string[], extra: Partial<ShortTitleContext> = {}): ShortTitleContext =>
    ({ word, authors, leadingWords: [], ...extra });

  it.each<[string, boolean]>([
    ['Stephen King - It (Unabridged) [M4B]', true],
    ['Stephen.King.It.2017.MP3', true],
    ['Stephen.Kings.It.MP3', true],
    ['StephenKing-It-AUDIOBOOK', true],
    ['It Read by Steven Weber', true],
    ['It Grows on You by Stephen King', true], // nothing after the word is read
    ['Stephen King - You Like It Darker: It Grows on You', true],
    ['You Like It Darker by Stephen King', false],
    ['Stephen King - Billy Summers, It, The Stand', false],
    ['Stephen King - Book 1 It Grows on You', true], // a number or volume token before the word is a left boundary
    ['The It Crowd by Stephen King', false], // "the" is not part of the request
  ])('It: %s → %s', (release, expected) => {
    expect(shortTitleStandsAlone(release, ctx('it', ['stephen king']))).toBe(expected);
  });

  it('skips only the request stop words before the word', () => {
    const martian = ctx('martian', ['andy weir'], { leadingWords: ['the'] });
    expect(shortTitleStandsAlone('Andy.Weir.The.Martian.Unabridged.M4B', martian)).toBe(true);
    expect(shortTitleStandsAlone('Andy Weir - Not The Martian', martian)).toBe(false);
    expect(shortTitleStandsAlone('The Getaway Car - MatchUp by Lee Child', ctx('getaway', ['lee child']))).toBe(false);
    expect(shortTitleStandsAlone('Frank Herbert - Children of Dune', ctx('dune', ['frank herbert']))).toBe(false);
  });

  it('reads every author form G3 accepts on the left', () => {
    expect(shortTitleStandsAlone('JRR Tolkien The Hobbit 1937 MP3', ctx('hobbit', ['j r r tolkien'], { leadingWords: ['the'] }))).toBe(true);
    expect(shortTitleStandsAlone('Ursula Le Guin Earthsea MP3', ctx('earthsea', ['ursula k le guin']))).toBe(true);
    expect(shortTitleStandsAlone('Herbert Frank Dune MP3', ctx('dune', ['frank herbert']))).toBe(true);
    expect(shortTitleStandsAlone('leechild-getaway-mp3', ctx('getaway', ['lee child']))).toBe(true);
    expect(shortTitleStandsAlone('Andy Weirs Martian', ctx('martian', ['andy weir']))).toBe(true);
  });

  it.each<[string, boolean]>([
    ['[M4B] Dune - Frank Herbert', true],
    ['Frank Herbert: Dune', true],
    ['(Audiobook) Dune by Frank Herbert', true],
    ['Classic - Dune', true],
    ['Classic_-_Dune', true],
    ['Classic. Dune', true],
    ['Classic Dune', false],
    ['Classic.Dune.MP3', false], // dots are this name's word delimiter
    ['Classic-Dune-M4B', false], // so are dashes here
    ['Classic_Dune-M4B', false],
    ['Classic_Edition-Dune_M4B', true], // a dash beside underscores separates
    ['Classic Edition.Dune M4B', true],
  ])('separators: %s → %s', (release, expected) => {
    expect(shortTitleStandsAlone(release, ctx('dune', ['frank herbert']))).toBe(expected);
  });
});

describe('volume conflict (G4c)', () => {
  it.each([
    ['Dungeon Crawler Carl (book 1)', 'Matt Dinniman - Dungeon Crawler Carl, T03 Le Livre', true],
    ['Dungeon Crawler Carl (book 1)', 'Matt Dinniman - Dungeon Crawler Carl, T01 - 2024', false],
    ['Le problème à trois corps (book 1)', 'Le.Probleme.a.Trois.Corps.T2.La.Foret.Sombre', true],
    ["Tom Clancy's Op-Center #12: War of Eagles", "Tom Clancy's Op-Center #11: Call to Treason", true],
    ["Tom Clancy's Op-Center #12: War of Eagles", "Tom Clancy's Op-Center #12: War of Eagles", false],
    ['Guards! Guards! (Discworld, Book 8)', 'Terry Pratchett - Discworld 08 - City Watch Book 1 - Guards! Guards!', false],
    ['Dungeon Crawler Carl (book 1)', 'Dungeon Crawler Carl 3', false],
    ['Dungeon Crawler Carl', 'Dungeon Crawler Carl, T03', false],
    ['Way of Kings (Book 1) (Book 2)', 'Way of Kings Book 3', false],
    ['Azarinth Healer: Book One', 'Azarinth Healer 03', false],
    ['Divergent (Divergent Trilogy, Book 1)', 'Veronica Roth - Divergent Trilogy 2 - Insurgent', true],
    ['Twilight (The Twilight Saga, Book 1)', 'Stephenie Meyer - Twilight Saga 2 - New Moon', true],
    ['Wool (Silo, Book 1)', 'Hugh Howey - Wool Silo 3', true],
    ['Dune (Dune Chronicles, Book 1)', 'Frank Herbert Dune 64 kbps', false],
    ['Dune (Dune Chronicles, Book 1)', 'Frank Herbert Dune 2 CD', false],
    ['Dune (Dune Chronicles, Book 1)', 'Frank Herbert - Dune 1965', false],
    ['Chamber of Secrets (Harry Potter, Book 2)', 'Harry Potter Book 1-7 - Chamber of Secrets', false],
    ['Chamber of Secrets (Harry Potter, Book 2)', 'Harry Potter Vol 1-3 Chamber of Secrets', false],
    ['Chamber of Secrets (Harry Potter, Book 2)', 'Harry Potter T1-T3', false],
    ['Chamber of Secrets (Harry Potter, Book 2)', 'Harry Potter Book 4-7', true],
    ['Die Tribute von Panem 1. Tödliche Spiele', 'Die Tribute von Panem 2 - Gefährliche Liebe', true],
    ['Die Tribute von Panem 1. Tödliche Spiele', 'Die Tribute von Panem - Tödliche Spiele', false],
    ["Tom Clancy's Op-Center 12: War of Eagles", "Tom Clancy's Op-Center 11 - Call to Treason", true],
    ['Dungeon Crawler Carl (book 1)', 'Dungeon Crawler Carl Book 3 of 7', true],
    ['Dungeon Crawler Carl (book 1)', 'Dungeon Crawler Carl Book 1 of 7', false],
    ['The Way of Kings (The Stormlight Archive, Book 1)', 'The Way of Kings (2 of 2)', false],
  ])('%s vs %s → %s', (title, release, expected) => {
    expect(volumeConflict(title, release, EN)).toBe(expected);
  });
});

describe('volume conflict with the catalog series part (G4c, #330)', () => {
  const rr = (seriesPart?: string) => ({ series: 'Red Rising Saga', seriesPart });
  it.each<[string, string, { series?: string; seriesPart?: string }, boolean]>([
    ['Morning Star', 'Red Rising Saga Book 2 - Golden Son', rr('3'), true],
    ['Morning Star', 'Red Rising Saga 03 - Morning Star', rr('3'), false],
    ['Golden Son', 'Red Rising Saga 02 - Golden Son', rr('3'), false], // the title words name this book
    ['Red Rising', 'Red Rising Saga 02', rr('1'), true], // no title words beyond the series name
    ['Red Rising', 'Red Rising Saga Book 3 of 7', rr('1'), true],
    ['Red Rising', 'Red Rising Saga Book 1 of 7', rr('1'), false],
    ['Red Rising', 'Red Rising Saga (1 of 2)', rr('3'), false],
    ['Red Rising', 'Red Rising Saga Books 2-4', rr('1'), true],
    ['Red Rising', 'Red Rising Saga Vols. 1-3', rr('2'), false],
    ['Red Rising', 'Red Rising Saga 2019-05-01', rr('3'), false],
    ['Red Rising', 'Red Rising Saga [02/12]', rr('3'), false],
    ['Red Rising', 'Red Rising Saga 02', rr(), false],
    ['Golden Son', 'Red Rising Saga 2.5', rr('2.5'), false],
    ['Golden Son', 'Red Rising Saga 02.50', rr('2.5'), false],
    ['Golden Son', 'Red Rising Saga 2', rr('2.5'), true],
    ['Dungeon Crawler Carl (book 1)', 'Dungeon Crawler Carl 3', { series: 'Dungeon Crawler Carl', seriesPart: '1' }, true],
    ['Azarinth Healer: Book One', 'Azarinth Healer 03', { series: 'Azarinth Healer', seriesPart: '01' }, true],
    ['Azarinth Healer: Book One', 'Azarinth Healer 03', { seriesPart: '1' }, false], // no series name: title-only
    ["The Magician's Nephew", "The Chronicles of Narnia Book 1 - The Magician's Nephew",{ series: 'The Chronicles of Narnia', seriesPart: '6' }, false],
    ['Way of Kings (Book 1) (Book 2)', 'Way of Kings Book 3', { seriesPart: '1' }, false],
  ])('%s vs %s (%o) → %s', (title, release, book, expected) => {
    expect(volumeConflict(title, release, EN, undefined, book)).toBe(expected);
  });
});
