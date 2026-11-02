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
  // [script, title, author, right release, its match score, same author other book, same title other author]
  it.each([
    ['Cyrillic', 'Мастер и Маргарита', 'Михаил Булгаков',
      'Михаил Булгаков - Мастер и Маргарита [2015, MP3, 128kbps]', 60,
      'Михаил Булгаков - Собачье сердце [M4B]',
      'Лев Толстой - Мастер и Маргарита [M4B]'],
    ['Greek', 'Ο Καπετάν Μιχάλης', 'Νίκος Καζαντζάκης',
      'ΝΙΚΟΣ ΚΑΖΑΝΤΖΑΚΗΣ - Ο ΚΑΠΕΤΑΝ ΜΙΧΑΛΗΣ [MP3]', 60,
      'Νίκος Καζαντζάκης - Ο Τελευταίος Πειρασμός [M4B]',
      'Γιάννης Ρίτσος - Ο Καπετάν Μιχάλης [M4B]'],
    ['Chinese', '球状闪电', '刘慈欣',
      '刘慈欣 - 球状闪电 [有声书 MP3]', 60,
      '刘慈欣 - 三体 [有声书 M4B]',
      '王晋康 - 球状闪电 [有声书 M4B]'],
    // 「」 are not complete-title markers, so the title scores by similarity
    ['Japanese', 'ノルウェイの森', '村上春樹',
      '村上春樹「ノルウェイの森」[朗読 MP3]', 40.7,
      '村上春樹「海辺のカフカ」[朗読 M4B]',
      '吉本ばなな「ノルウェイの森」[M4B]'],
    ['Korean', '82년생 김지영', '조남주',
      '조남주 - 82년생 김지영 [오디오북 MP3]', 60,
      '조남주 - 사하맨션 [오디오북 M4B]',
      '정유정 - 82년생 김지영 [M4B]'],
    ['Arabic', 'موسم الهجرة إلى الشمال', 'الطيب صالح',
      'الطيب صالح - موسم الهجرة إلى الشمال [MP3]', 60,
      'الطيب صالح - عرس الزين [M4B]',
      'نجيب محفوظ - موسم الهجرة إلى الشمال [M4B]'],
    ['Hebrew', 'מיכאל שלי', 'עמוס עוז',
      'עמוס עוז - מיכאל שלי [MP3]', 60,
      'עמוס עוז - סיפור על אהבה וחושך [M4B]',
      'דוד גרוסמן - מיכאל שלי [M4B]'],
    ['Thai', 'ข้างหลังภาพ', 'ศรีบูรพา',
      'ศรีบูรพา - ข้างหลังภาพ [หนังสือเสียง MP3]', 60,
      'ศรีบูรพา - แลไปข้างหน้า [M4B]',
      'สุนทรภู่ - ข้างหลังภาพ [M4B]'],
  ])('%s: picks the right release and rejects the others', (_script, title, author, right, score, otherBook, otherAuthor) => {
    expect(matchScore(right, title, author)).toBeCloseTo(score as number, 1);
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
    expect(matchScore('刘慈欣三体全集MP3', '三体', '刘慈欣')).toBeCloseTo(24, 1);
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
    expect(matchScore('村上春樹 １Ｑ８４ BOOK1 朗読', '1Q84', '村上春樹')).toBeCloseTo(30.9, 1);
  });

  it('treats a fullwidth or 【】 subtitle in the requested title as optional, like an ASCII one', () => {
    expect(matchScore('刘慈欣 - 三体 [MP3]', '三体（地球往事）', '刘慈欣')).toBe(60);
    expect(matchScore('刘慈欣 - 三体 [MP3]', '三体【地球往事】', '刘慈欣')).toBe(60);
    expect(matchScore('刘慈欣 - 球状闪电 [MP3]', '三体（地球往事）', '刘慈欣')).toBe(0);
    for (const [release, fullwidth, ascii, author] of [
      ['村上春樹 - ノルウェイの森 [朗読 MP3]', 'ノルウェイの森（上）', 'ノルウェイの森(上)', '村上春樹'],
      ['東野圭吾 - 白夜行 [朗読]', '白夜行：新装版', '白夜行:新装版', '東野圭吾'],
    ]) {
      expect(matchScore(release, fullwidth, author)).toBe(60);
      expect(matchScore(release, ascii, author)).toBe(60);
    }
  });

  it.each([
    ['金庸', '射雕英雄传', '金庸 - 射雕英雄传 [有声书 MP3]', '古龙 - 射雕英雄传 [有声书 M4B]', '金庸 - 天龙八部 [有声书 M4B]'],
    ['한강', '채식주의자', '한강 - 채식주의자 [오디오북 MP3]', '정유정 - 채식주의자 [오디오북 M4B]', '한강 - 소년이 온다 [오디오북 M4B]'],
  ])('keeps the two-character author %s and still rejects other releases', (author, title, right, otherAuthor, otherBook) => {
    expect(matchScore(right, title, author)).toBe(60);
    expect(matchScore(otherAuthor, title, author)).toBe(0);
    expect(matchScore(otherBook, title, author)).toBe(0);
  });

  it('splits a katakana word ending in the long-vowel mark from a following digit, both ways', () => {
    expect(matchScore('山田太郎 - ラブストーリー 2', 'ラブストーリー2', '山田太郎')).toBe(60);
    expect(matchScore('山田太郎 - ラブストーリー2', 'ラブストーリー 2', '山田太郎')).toBe(60);
    expect(matchScore('山田太郎 - ラブストーリー 3', 'ラブストーリー2', '山田太郎')).toBe(0);
  });

  it('matches a bilingual release name with the Latin title glued to the CJK one', () => {
    const glued = 'J.K. Rowling 哈利波特Harry Potter [MP3]';
    const spaced = 'J.K. Rowling 哈利波特 Harry Potter [MP3]';

    expect(matchScore(glued, 'Harry Potter', 'J.K. Rowling')).toBe(60);
    expect(matchScore(spaced, 'Harry Potter', 'J.K. Rowling')).toBe(60);
  });

  it('still rejects an unrelated release in interactive mode when only the title is checked', () => {
    expect(matchScore('Лев Толстой - Война и мир', 'Мастер и Маргарита', 'Михаил Булгаков', false)).toBe(0);
  });
});

describe('ranking: Latin letters', () => {
  // Same result as before: accents fold, ASCII spellings match
  it.each([
    ['Café de Flore', 'Hélène Grémillon', 'Helene Gremillon - Cafe de Flore [M4B]'],
    ['Cafe de Flore', 'Helene Gremillon', 'Hélène Grémillon - Café de Flore [M4B]'],
    ['Der Schwarm', 'Frank Schätzing', 'Frank Schatzing - Der Schwarm [MP3]'],
    ['The Snowman', 'Jo Nesbø', 'Jo Nesbo - The Snowman [M4B]'],
  ])('still matches "%s" by %s in "%s"', (title, author, releaseName) => {
    expect(matchScore(releaseName, title, author)).toBe(60);
    expect(matchScore('Someone Else - Another Book [M4B]', title, author)).toBe(0);
  });

  it('folds letters with no accent mark to their usual spelling (ø, ß)', () => {
    expect(matchScore('Jo Nesbø - Snømannen [MP3]', 'Snømannen', 'Jo Nesbø')).toBe(60);
    expect(matchScore('Jo Nesbo - Snomannen [MP3]', 'Snømannen', 'Jo Nesbø')).toBe(60);
    expect(matchScore('Peter Hoeg - Froken Smillas fornemmelse for sne [MP3]', 'Frøken Smillas fornemmelse for sne', 'Peter Høeg')).toBe(60);
    expect(matchScore('Strasse der Toten - Max Muster [MP3]', 'Straße der Toten', 'Max Muster')).toBe(60);
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
    expect(matchScore('David Blatner - The Joy of π [MP3]', 'The Joy of π', 'David Blatner')).toBeCloseTo(38.2, 1);
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

  it('gives an emoji-only author no author points in interactive mode', () => {
    expect(matchScore('Author Name - Great Book [M4B]', 'Great Book', '🔥🔥🔥', false)).toBe(45);
    expect(matchScore('Author Name - Great Book [M4B]', 'Great Book', 'Author Name', false)).toBe(60);
  });

  it('reads a keycap title as its digit, as before', () => {
    expect(matchScore('Jane Doe - Countdown 1\uFE0F\u20E3 [MP3]', '1\uFE0F\u20E3', 'Jane Doe')).toBe(15);
  });

  it('does not let a symbol-only required title skip the coverage check', () => {
    expect(matchScore('Author Name - Unrelated Book [M4B]', '★ (Star Stories)', 'Author Name')).toBe(0);
  });
});
