/**
 * Component: Ranking Algorithm Tests (non-Latin scripts, empty normalization)
 * Documentation: documentation/phase3/ranking-algorithm.md
 */

import { describe, expect, it } from 'vitest';
import { RankingAlgorithm, rankTorrents } from '@/lib/utils/ranking-algorithm';

const MB = 1024 * 1024;
const OLDER = '2024-01-01T00:00:00Z';
const NEWER = '2025-06-01T00:00:00Z';

const torrent = (guid: string, title: string, seeders = 20, publishDate = OLDER) => ({
  indexer: 'IndexerA',
  guid,
  title,
  size: 600 * MB,
  seeders,
  publishDate: new Date(publishDate),
  downloadUrl: `magnet:?xt=urn:btih:${guid}`,
});

const algorithm = new RankingAlgorithm();
const matchScore = (torrentTitle: string, title: string, author: string, requireAuthor = true) =>
  algorithm.getScoreBreakdown(torrent('t', torrentTitle), { title, author }, requireAuthor).matchScore;

describe('ranking: titles and authors in non-Latin scripts', () => {
  // [script, title, author, right release, same author other book, same title other author]
  it.each([
    ['Cyrillic', 'Мастер и Маргарита', 'Михаил Булгаков',
      'Михаил Булгаков - Мастер и Маргарита [2015, MP3, 128kbps]',
      'Михаил Булгаков - Собачье сердце [M4B]',
      'Лев Толстой - Мастер и Маргарита [M4B]'],
    ['Greek', 'Ο Καπετάν Μιχάλης', 'Νίκος Καζαντζάκης',
      'ΝΙΚΟΣ ΚΑΖΑΝΤΖΑΚΗΣ - Ο ΚΑΠΕΤΑΝ ΜΙΧΑΛΗΣ [MP3]',
      'Νίκος Καζαντζάκης - Ο Τελευταίος Πειρασμός [M4B]',
      'Γιάννης Ρίτσος - Ο Καπετάν Μιχάλης [M4B]'],
    ['Chinese', '球状闪电', '刘慈欣',
      '刘慈欣 - 球状闪电 [有声书 MP3]',
      '刘慈欣 - 三体 [有声书 M4B]',
      '王晋康 - 球状闪电 [有声书 M4B]'],
    ['Japanese', 'ノルウェイの森', '村上春樹',
      '村上春樹「ノルウェイの森」[朗読 MP3]',
      '村上春樹「海辺のカフカ」[朗読 M4B]',
      '吉本ばなな「ノルウェイの森」[M4B]'],
    ['Korean', '82년생 김지영', '조남주',
      '조남주 - 82년생 김지영 [오디오북 MP3]',
      '조남주 - 사하맨션 [오디오북 M4B]',
      '정유정 - 82년생 김지영 [M4B]'],
    ['Arabic', 'موسم الهجرة إلى الشمال', 'الطيب صالح',
      'الطيب صالح - موسم الهجرة إلى الشمال [MP3]',
      'الطيب صالح - عرس الزين [M4B]',
      'نجيب محفوظ - موسم الهجرة إلى الشمال [M4B]'],
    ['Hebrew', 'מיכאל שלי', 'עמוס עוז',
      'עמוס עוז - מיכאל שלי [MP3]',
      'עמוס עוז - סיפור על אהבה וחושך [M4B]',
      'דוד גרוסמן - מיכאל שלי [M4B]'],
    ['Thai', 'ข้างหลังภาพ', 'ศรีบูรพา',
      'ศรีบูรพา - ข้างหลังภาพ [หนังสือเสียง MP3]',
      'ศรีบูรพา - แลไปข้างหน้า [M4B]',
      'สุนทรภู่ - ข้างหลังภาพ [M4B]'],
  ])('%s: picks the right release and rejects the others', (_script, title, author, right, otherBook, otherAuthor) => {
    expect(matchScore(right, title, author)).toBeGreaterThan(0);
    expect(matchScore(otherBook, title, author)).toBe(0);
    expect(matchScore(otherAuthor, title, author)).toBe(0);

    // The wrong releases are newer, better seeded and tagged M4B: only the match gate can rank the right one first
    const ranked = rankTorrents(
      [torrent('book', otherBook, 300, NEWER), torrent('author', otherAuthor, 300, NEWER), torrent('right', right)],
      { title, author },
    );
    expect(ranked[0].guid).toBe('right');
  });

  it('matches a CJK title inside a release name written without spaces', () => {
    expect(matchScore('刘慈欣三体全集MP3', '三体', '刘慈欣')).toBeGreaterThan(0);
    expect(matchScore('刘慈欣球状闪电全集MP3', '三体', '刘慈欣')).toBe(0);
  });

  it('ranks a one-character CJK title above a better-seeded release that only contains the character', () => {
    const right = torrent('right', '夏目漱石 - 心 朗読 [M4B]');
    const wrong = torrent('wrong', '夏目漱石 - 心理学講義 朗読 [M4B]', 300, NEWER);
    const ranked = rankTorrents([wrong, right], { title: '心', author: '夏目漱石', durationMinutes: 300 });

    expect(ranked.find((r) => r.guid === 'wrong')!.breakdown.matchScore).toBe(0);
    expect(ranked[0].guid).toBe('right');
  });

  it('ranks a two-character CJK title above a better-seeded sequel', () => {
    const right = torrent('right', '刘慈欣 - 三体 [有声书 M4B]');
    const sequel = torrent('sequel', '刘慈欣 - 三体2 黑暗森林 [有声书 M4B]', 300, NEWER);
    const ranked = rankTorrents([sequel, right], { title: '三体', author: '刘慈欣', durationMinutes: 300 });

    expect(ranked[0].guid).toBe('right');
    expect(ranked[0].breakdown.matchScore).toBe(60);
  });

  it('folds fullwidth letters and digits in release names', () => {
    expect(matchScore('村上春樹 １Ｑ８４ BOOK1 朗読', '1Q84', '村上春樹')).toBeGreaterThan(0);
  });

  it('matches a bilingual release name with the Latin title glued to the CJK one', () => {
    const glued = 'J.K. Rowling 哈利波特与魔法石Harry Potter and the Sorcerers Stone';
    const spaced = 'J.K. Rowling 哈利波特与魔法石 Harry Potter and the Sorcerers Stone';
    const score = matchScore(glued, 'Harry Potter and the Sorcerers Stone', 'J.K. Rowling');

    expect(score).toBeGreaterThan(50);
    expect(score).toBe(matchScore(spaced, 'Harry Potter and the Sorcerers Stone', 'J.K. Rowling'));
  });

  it('still rejects an unrelated release in interactive mode when only the title is checked', () => {
    expect(matchScore('Лев Толстой - Война и мир', 'Мастер и Маргарита', 'Михаил Булгаков', false)).toBe(0);
  });
});

describe('ranking: Latin letters', () => {
  // Same result on main: accents fold, ASCII spellings match
  it.each([
    ['Café de Flore', 'Hélène Grémillon', 'Helene Gremillon - Cafe de Flore [M4B]'],
    ['Cafe de Flore', 'Helene Gremillon', 'Hélène Grémillon - Café de Flore [M4B]'],
    ['Der Schwarm', 'Frank Schätzing', 'Frank Schatzing - Der Schwarm [MP3]'],
    ['The Snowman', 'Jo Nesbø', 'Jo Nesbo - The Snowman [M4B]'],
  ])('still matches "%s" by %s in "%s"', (title, author, releaseName) => {
    expect(matchScore(releaseName, title, author)).toBeGreaterThan(50);
    expect(matchScore('Someone Else - Another Book [M4B]', title, author)).toBe(0);
  });

  it('folds letters with no accent mark to their usual spelling (ø, ß)', () => {
    expect(matchScore('Jo Nesbo - Snomannen [MP3]', 'Snømannen', 'Jo Nesbø')).toBeGreaterThan(50);
    expect(matchScore('Peter Hoeg - Froken Smillas fornemmelse for sne [MP3]', 'Frøken Smillas fornemmelse for sne', 'Peter Høeg')).toBeGreaterThan(0);
    expect(matchScore('Strasse der Toten - Max Muster [MP3]', 'Straße der Toten', 'Max Muster')).toBeGreaterThan(50);
  });

  // Accepted change: ø folds to o like ö does, so the "oe" spelling no longer matches (Björn/Bjoern never did)
  it('no longer matches ø written as "oe", the same as ö', () => {
    expect(matchScore('Bjoern Larsson - Long John Silver [MP3]', 'Long John Silver', 'Bjørn Larsson')).toBe(0);
    expect(matchScore('Bjoern Larsson - Long John Silver [MP3]', 'Long John Silver', 'Björn Larsson')).toBe(0);
    expect(matchScore('Bjorn Larsson - Long John Silver [MP3]', 'Long John Silver', 'Bjørn Larsson')).toBe(60);
  });

  // Accepted change: a non-ASCII letter or digit inside a Latin title is part of the title
  it('requires a non-ASCII letter in a Latin title (π) to be in the release name', () => {
    expect(matchScore('David Blatner - The Joy of Pi [MP3]', 'The Joy of π', 'David Blatner')).toBe(0);
    expect(matchScore('David Blatner - The Joy of π [MP3]', 'The Joy of π', 'David Blatner')).toBeGreaterThan(0);
  });

  it('ignores emoji presentation selectors in a Latin title', () => {
    const heart = 'I ❤\uFE0F Paris';
    expect(matchScore('Jane Doe - I ❤ Paris [MP3]', heart, 'Jane Doe')).toBe(60);
    expect(matchScore('Jane Doe - I Love Paris [MP3]', heart, 'Jane Doe')).toBe(matchScore('Jane Doe - I Love Paris [MP3]', 'I Paris', 'Jane Doe'));
  });
});

describe('ranking: titles and authors that normalize to nothing fail closed', () => {
  it.each([
    ['emoji-only title', '🔥🔥🔥', 'Author Name'],
    ['emoji-with-selector title', '❤\uFE0F❤\uFE0F', 'Author Name'],
    ['punctuation-only title', '?!...', 'Author Name'],
    ['emoji-only author', 'Great Book', '🔥🔥🔥'],
    ['punctuation-only author', 'Great Book', '---'],
  ])('%s matches nothing', (_case, title, author) => {
    expect(matchScore(`Author Name - Great Book ${title} [M4B]`, title, author)).toBe(0);
    expect(matchScore('Totally Different - Someone Else', title, author)).toBe(0);
  });

  it('reads a keycap title as its digit, as before', () => {
    expect(matchScore('Jane Doe - Countdown 1\uFE0F\u20E3 [MP3]', '1\uFE0F\u20E3', 'Jane Doe')).toBe(15);
  });

  it('does not let a symbol-only required title skip the coverage check', () => {
    expect(matchScore('Author Name - Unrelated Book [M4B]', '★ (Star Stories)', 'Author Name')).toBe(0);
  });
});
