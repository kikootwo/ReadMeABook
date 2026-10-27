/**
 * Component: Match Text Normalizer Tests
 * Documentation: documentation/phase3/ranking-algorithm.md
 */

import { describe, expect, it } from 'vitest';
import {
  apostropheEndingWords,
  foldForMatching,
  hasNonLatinLetter,
  hasUnspacedScript,
  isWordInTitle,
  keepUnrequestedApostrophes,
  normalizeForMatching,
  splitSubtitle,
} from '@/lib/utils/match-normalize';

// The normalizer as it was before non-Latin support, frozen as the parity oracle for ASCII and accented Latin
const legacyNormalize = (text: string) => text
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/_/g, ' ')
  .replace(/[^\w\s']/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

describe('normalizeForMatching', () => {
  it.each([
    'VirginaEvans TheCorrespondent',
    'Twelve.Months-Jim.Butcher',
    'Author_Name-Book.Title.2024',
    'William.L.Shirer-Berlin.Diary-AUDIOBOOK-96kbs',
    'Author Name — Book Title [M4B] (Unabridged) {2020}',
    'Great\u00A0Book - Author\u00A0Name',
    'Café Señor Über Crème Brûlée Ångström',
    'Hélène Grémillon - Le confident',
    'I ❤\uFE0F Paris ⭐\uFE0F 1\uFE0F\u20E3',
  ])('matches the previous output for Latin text: %s', (text) => {
    expect(normalizeForMatching(text)).toBe(legacyNormalize(text));
  });

  // Accepted change (#316, #466): apostrophes fold, so a name with one matches a name without
  it.each([
    ["Ender's Game", 'enders game'],
    ['Enders.Game', 'enders game'],
    ['Ender’s Game', 'enders game'],
    ["The Dungeon Anarchist's Cookbook", 'the dungeon anarchists cookbook'],
    ["Don't Look Back, We'll Go, They're Here, I've, I'd, I'm", 'dont look back well go theyre here ive id im'],
    ["L'intruse", 'l intruse'],
    ['L.Intruse', 'l intruse'],
    ['L’Héritage', 'l heritage'],
    ["Changer l'eau des fleurs", 'changer l eau des fleurs'],
    ["C'était ça ou mourir", 'c etait ca ou mourir'],
    ["O'Brien - The Things They Carried", 'o brien the things they carried'],
    ["Rock 'n' Roll", 'rock n roll'],
    ["The Anarchists' Cookbook", 'the anarchists cookbook'],
    ['‘Salem’s Lot', 'salems lot'],
    ['The Housemaid’s Secret', 'the housemaids secret'],
  ])('folds apostrophes: %s', (text, expected) => {
    expect(normalizeForMatching(text)).toBe(expected);
  });

  // Accepted changes for Latin text: these letters used to be deleted
  it.each([
    ['Jo Nesbø · Snømannen', 'jo nesbo snomannen'],
    ['Æsop Œuvres Straße Łódź', 'aesop oeuvres strasse lodz'],
    ['The Joy of π', 'the joy of π'],
    ['µ World ² º', 'µ world ² º'],
    ['Hawaiʻi', 'hawaiʻi'],
  ])('keeps or folds Latin-adjacent letters: %s', (text, expected) => {
    expect(normalizeForMatching(text)).toBe(expected);
  });

  it.each([
    ['Ёлка. Война и мир', 'елка воина и мир'], // й/ё fold like Latin accents, on both sides
    ['ΝΙΚΟΣ ΚΑΖΑΝΤΖΑΚΗΣ', 'νικοσ καζαντζακησ'],
    ['Νίκος Καζαντζάκης', 'νικοσ καζαντζακησ'],
    ['村上春樹「ノルウェイの森」', '村上春樹 ノルウェイの森'],
    ['がぎぐげご', 'がぎぐげご'],
    ['82년생 김지영', '82년생 김지영'],
    ['موسم الهجرة إلى الشمال', 'موسم الهجرة إلى الشمال'],
    ['מיכאל שלי', 'מיכאל שלי'],
    ['प्रेमचंद - गोदान', 'प्रेमचंद गोदान'],
    ['１Ｑ８４\u3000ＢＯＯＫ１', '1q84 book1'],
  ])('keeps letters and digits of every script: %s', (text, expected) => {
    expect(normalizeForMatching(text)).toBe(expected);
  });

  it.each([
    ['哈利波特与魔法石Harry Potter', '哈利波特与魔法石 harry potter'],
    ['三体2黑暗森林', '三体 2 黑暗森林'],
    ['村上春樹1Q84', '村上春樹 1q84'],
    ['82년생', '82년생'],
    ['ラブストーリー2', 'ラブストーリー 2'],
    ['データ2', 'データ 2'],
  ])('splits a CJK or Thai letter from an adjacent ASCII letter or digit: %s', (text, expected) => {
    expect(normalizeForMatching(text)).toBe(expected);
  });

  it.each(['🔥🔥🔥', '?!...', '---', '★☆', '❤\uFE0F❤\uFE0F', '👍🏽'])(
    'normalizes symbol-only text to nothing: %s',
    (text) => {
      expect(normalizeForMatching(text)).toBe('');
    },
  );

  it('applies language replacements before the generic folds', () => {
    expect(normalizeForMatching('Straße', { 'ß': 'sz' })).toBe('strasze');
  });
});

describe('isWordInTitle', () => {
  const title = '刘慈欣三体全集 mp3 the wild robot 心理学講義';
  const words = title.split(' ');

  it('matches words of two or more characters in unspaced scripts as substrings', () => {
    expect(isWordInTitle('三体', words, title)).toBe(true);
    expect(isWordInTitle('球状闪电', words, title)).toBe(false);
  });

  it('matches a one-character word of an unspaced script as a whole word only', () => {
    expect(isWordInTitle('心', words, title)).toBe(false);
    expect(isWordInTitle('心', ['夏目漱石', '心', '朗読'], '夏目漱石 心 朗読')).toBe(true);
  });

  it('matches other words as whole words only', () => {
    expect(isWordInTitle('robot', words, title)).toBe(true);
    expect(isWordInTitle('rob', words, title)).toBe(false);
  });

  it('detects scripts written without spaces', () => {
    expect(hasUnspacedScript('三体')).toBe(true);
    expect(hasUnspacedScript('ノルウェイ')).toBe(true);
    expect(hasUnspacedScript('ข้างหลังภาพ')).toBe(true);
    expect(hasUnspacedScript('김지영')).toBe(false);
    expect(hasUnspacedScript('война')).toBe(false);
  });

  it('counts the katakana long-vowel mark as part of an unspaced script', () => {
    expect(hasUnspacedScript('ー')).toBe(true);
  });
});

describe('foldForMatching', () => {
  it.each([
    ['Jo Nesbø - Snømannen [MP3]', 'jo nesbo - snomannen [mp3]'],
    ['ΝΙΚΟΣ - Ο ΚΑΠΕΤΑΝ ΜΙΧΑΛΗΣ [MP3]', 'νικοσ - ο καπεταν μιχαλησ [mp3]'],
    ['刘慈欣 － 三体２ ［MP3］', '刘慈欣 - 三体 2 [mp3]'],
  ])('folds like the normalizer but keeps punctuation: %s', (text, expected) => {
    expect(foldForMatching(text)).toBe(expected);
  });

  it('only lowercases ASCII text and collapses its whitespace', () => {
    const text = '  The  Way of Kings (Book 1) - Brandon Sanderson [MP3]: Unabridged, 2010 ';
    expect(foldForMatching(text)).toBe(text.toLowerCase().replace(/\s+/g, ' ').trim());
  });

  it.each([
    'Frøken Smilla – Kapitel 1 «Αθήνα» ノルウェイの森１Ｑ８４',
    "Ender's Game - L'intruse [MP3] ‘Salem’s Lot",
  ])('agrees with the normalizer on every word: %s', (text) => {
    expect(normalizeForMatching(foldForMatching(text))).toBe(normalizeForMatching(text));
  });

  it('folds apostrophes the way the normalizer does, keeping other punctuation', () => {
    expect(foldForMatching("Orson Scott Card - Ender's Game [MP3]")).toBe('orson scott card - enders game [mp3]');
    expect(foldForMatching("Freida McFadden - L'intruse (2026)")).toBe('freida mcfadden - l intruse (2026)');
  });
});

describe('release apostrophes fold only where the request has one (#316)', () => {
  it.each([
    ["Ender's Game", ['enders']],
    ['Ender’s Game', ['enders']],
    ["Tom Clancy's Op-Center", ['clancys']],
    ["Don't Look Back, We'll Go", ['dont', 'well']],
    ["L'intruse", []],
    ['Enders Game', []],
  ])('apostropheEndingWords(%s)', (title, words) => {
    expect([...apostropheEndingWords(title)]).toEqual(words);
  });

  it.each([
    // [release, request, normalized release]
    ["Orson Scott Card - Ender's Game", "Ender's Game", 'orson scott card enders game'],
    ['Orson Scott Card - Ender’s Game', "Ender's Game", 'orson scott card enders game'],
    ["Orson Scott Card - Ender's Game", 'Enders', 'orson scott card ender\uA78Cs game'],
    ["David Levithan - The Lover's Dictionary", 'The Lovers', 'david levithan the lover\uA78Cs dictionary'],
    ['Rick Riordan - The Titan’s Curse', 'The Titans', 'rick riordan the titan\uA78Cs curse'],
    ["Stephen King's It", 'It', 'stephen king\uA78Cs it'],
    ['Enders.Game', "Ender's Game", 'enders game'],
    ["L'Intruse - 2026", 'Intruse', 'l intruse 2026'],
  ])('%s for "%s" -> %s', (release, request, expected) => {
    const kept = keepUnrequestedApostrophes(release, apostropheEndingWords(request));
    expect(normalizeForMatching(kept)).toBe(expected);
    // A kept apostrophe survives every later normalization
    expect(normalizeForMatching(normalizeForMatching(kept))).toBe(expected);
    expect(normalizeForMatching(foldForMatching(kept))).toBe(expected);
  });
});

describe('hasNonLatinLetter', () => {
  it.each([['金庸', true], ['한강', true], ['Лев', true], ['Al', false], ['Søren', false], ['---', false]])(
    '%s -> %s',
    (text, expected) => {
      expect(hasNonLatinLetter(text)).toBe(expected);
    },
  );
});

describe('splitSubtitle (#466)', () => {
  it.each<[string, [string, string, boolean] | null]>([
    ['primal hunter 1. une aventure de litrpg', ['primal hunter 1', 'une aventure de litrpg', false]],
    ['der herr der ringe. die gefährten', ['der herr der ringe', 'die gefährten', false]],
    ["c'était ça ou mourir - prix du roman fnac 2026", ["c'était ça ou mourir", 'prix du roman fnac 2026', false]],
    ['spider-man — forever young', ['spider-man', 'forever young', false]],
    ['the finest edge of twilight: dungeons & dragons', ['the finest edge of twilight', 'dungeons & dragons', true]],
    ['mr. mercedes - bill hodges', ['mr. mercedes', 'bill hodges', false]],
    ['spider-man', null],
    ['mr. mercedes', null],
    ['a. j. fikry', null],
    ['prof. moriarty', null],
    ['wait... what', null],
    ['title:', null],
    ['- title', null],
  ])('%s', (title, expected) => {
    const split = splitSubtitle(title);
    expect(split && [split.main, split.subtitle, split.colon]).toEqual(expected);
  });
});
