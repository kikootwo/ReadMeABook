/**
 * Component: Automatic-Search Match Gates Tests (helper units)
 * Documentation: documentation/phase3/match-gates.md
 */

import { describe, expect, it } from 'vitest';
import {
  authorAppears, colonSubtitleAgrees, foldNumberWord, foldReleaseWords, isAuthorPresent, missingRequiredNumber,
  shortTitleBoundary, shortTitleWord, volumeConflict, ShortTitleContext,
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
    expect(foldReleaseWords(['primal', 'hunter', 't01', 'tome2', 'vol3', 'v4', 'book05', 'livre6', 'mp3']))
      .toEqual(['primal', 'hunter', 't01', 'tome2', 'vol3', 'v4', 'book05', 'livre6', 'mp3', '1', '2', '3', '4', '5', '6']);
  });

  it('requires every required number, and ignores extra release numbers', () => {
    expect(missingRequiredNumber(['op', 'center', '12'], foldReleaseWords(['op', 'center', '11', '2014']))).toBe(true);
    expect(missingRequiredNumber(['primal', 'hunter', '1'], foldReleaseWords(['primal', 'hunter', '01', '2024', '128']))).toBe(false);
    expect(missingRequiredNumber(['dune'], ['dune', '2021', '64'])).toBe(false);
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
    ({ word, authors, stopWords: EN, subtitleWords: new Set(), ...extra });

  it.each([
    ['Stephen King - It (Unabridged) [M4B]', 'clean'],
    ['Stephen.King.It.2017.MP3', 'clean'],
    ['Stephen.Kings.It.MP3', 'clean'],
    ['It Read by Steven Weber', 'clean'],
    ['Stephen King - It, Book One', 'loose'],
    ['It 2 by Stephen King', 'loose'],
    ['It Grows on You by Stephen King', null],
    ['You Like It Darker by Stephen King', null],
    ['Stephen King - Billy Summers, It, The Stand', null],
    ['Stephen King - It Grows on You and Other It - Stories', null],
  ])('It: %s → %s', (release, expected) => {
    expect(shortTitleBoundary(release, ctx('it', ['stephen king']))).toBe(expected);
  });

  it('skips stop words on both sides and reads collapsed initials and closing brackets', () => {
    expect(shortTitleBoundary('Andy.Weir.The.Martian.Unabridged.M4B', ctx('martian', ['andy weir']))).toBe('clean');
    expect(shortTitleBoundary('JRR Tolkien The Hobbit 1937 MP3', ctx('hobbit', ['j r r tolkien']))).toBe('clean');
    expect(shortTitleBoundary('[M4B] Dune - Frank Herbert', ctx('dune', ['frank herbert']))).toBe('clean');
    expect(shortTitleBoundary('Yuval Noah Harari - Sapiens A Brief History', ctx('sapiens', ['yuval noah harari'], { subtitleWords: new Set(['brief', 'history']) }))).toBe('clean');
    expect(shortTitleBoundary('Andy Weir The Martian Chronicles', ctx('martian', ['andy weir']))).toBeNull();
  });

  it('judges each occurrence on its own: a number before one occurrence is a left boundary', () => {
    expect(shortTitleBoundary('Dune Chronicles 01 Dune Frank Herbert M4B', ctx('dune', ['frank herbert']))).toBe('clean');
  });

  it('reads the languages it is given', () => {
    const fr = ['le', 'la', 'les', 'un', 'une', 'de', 'des', 'sur', 'dans', 'à', 'et', 'par', 'pour'];
    expect(shortTitleBoundary('Albert.Camus.La.Peste.Livre.Audio.FR.MP3', ctx('peste', ['albert camus'], { stopWords: fr }))).toBe('clean');
    expect(shortTitleBoundary('Joel Dicker - Le Tigre lu par Jean Martin', ctx('tigre', ['joel dicker'], { stopWords: fr }))).toBe('clean');
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
  ])('%s vs %s → %s', (title, release, expected) => {
    expect(volumeConflict(title, release, EN)).toBe(expected);
  });
});
