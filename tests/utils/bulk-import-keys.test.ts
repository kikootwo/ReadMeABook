/**
 * Component: Bulk Import Grouping Keys Tests
 * Documentation: documentation/features/bulk-import.md
 */

import { describe, expect, it } from 'vitest';
import { buildGroupingKey, NO_TITLE_PREFIX, UNGROUPED_PREFIX } from '@/lib/utils/bulk-import-keys';

/** The ASCII-only key part used before scripts other than Latin were kept. */
const asciiPart = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

describe('buildGroupingKey: Latin keys', () => {
  it.each([
    [{ title: 'The Gunslinger', author: 'Stephen King', narrator: 'George Guidall' }, 'thegunslinger|stephenking|georgeguidall'],
    [{ title: 'Harry_Potter: Book 1!', author: 'J.K. Rowling' }, 'harrypotterbook1|jkrowling|'],
    [{ title: 'TheCorrespondent', author: "Patrick O'Brian" }, 'thecorrespondent|patrickobrian|'],
    [{ title: 'Some Book' }, 'somebook||'],
  ])('%o -> %s', (metadata, key) => {
    expect(buildGroupingKey(metadata)).toBe(key);
  });

  it('gives every ASCII string the same key as the ASCII-only rule', () => {
    const chars = Array.from({ length: 128 }, (_, c) => String.fromCharCode(c));
    const samples = [...chars, ...chars.flatMap((a) => chars.map((b) => a + b))];
    const mismatches = samples.filter((s) => {
      const expected = [`x${asciiPart(s)}x`, asciiPart(s), asciiPart(s)].join('|');
      return buildGroupingKey({ title: `x${s}x`, author: s, narrator: s }) !== expected;
    });
    expect(mismatches).toEqual([]);
  });

  // Ranking folds apostrophes (#466); keys already dropped them and must not change
  it.each([
    ["L'intruse", 'lintruse||'],
    ['L’intruse', 'lintruse||'],
    ["Ender's Game", 'endersgame||'],
    ['‘Salem’s Lot', 'salemslot||'],
    ["Rock 'n' Roll", 'rocknroll||'],
  ])('keys apostrophe titles as before: %s', (title, key) => {
    expect(buildGroupingKey({ title })).toBe(key);
  });

  it('returns null without a title tag', () => {
    expect(buildGroupingKey({ author: 'Stephen King' })).toBeNull();
    expect(buildGroupingKey({ title: '', author: 'Stephen King' })).toBeNull();
  });
});

describe('buildGroupingKey: every script', () => {
  it.each([
    [{ title: 'Война и мир', author: 'Лев Толстой' }, 'воинаимир|левтолстои|'],
    [{ title: 'Анна Каренина', author: 'Лев Толстой' }, 'аннакаренина|левтолстои|'],
    [{ title: '三体', author: '刘慈欣' }, '三体|刘慈欣|'],
    [{ title: '黑暗森林', author: '刘慈欣' }, '黑暗森林|刘慈欣|'],
    [{ title: 'Οδύσσεια', author: 'Όμηρος' }, 'οδυσσεια|ομηροσ|'],
    [{ title: 'ハリー・ポッターと賢者の石' }, 'ハリーポッターと賢者の石||'],
    [{ title: 'הנסיך הקטן' }, 'הנסיךהקטן||'],
    [{ title: 'किताब' }, 'किताब||'],
    [{ title: 'ＡＢＣ１２３' }, 'abc123||'],
  ])('%o -> %s', (metadata, key) => {
    expect(buildGroupingKey(metadata)).toBe(key);
  });

  it('keeps titles apart that share only their Latin letters and digits', () => {
    const rowling = 'J.K. Rowling';
    expect(buildGroupingKey({ title: 'Harry Potter и философский камень', author: rowling }))
      .not.toBe(buildGroupingKey({ title: 'Harry Potter и Тайная комната', author: rowling }));
    expect(buildGroupingKey({ title: '三体 Book 1' })).not.toBe(buildGroupingKey({ title: '黑暗森林 Book 1' }));
  });

  it('gives a composed and a decomposed accent the same key', () => {
    expect(buildGroupingKey({ title: 'Caf\u00e9' })).toBe('cafe||');
    expect(buildGroupingKey({ title: 'Cafe\u0301' })).toBe('cafe||');
  });
});

describe('buildGroupingKey: a title with no letter or digit', () => {
  it.each([' ', '!!!', '\u{1F4DA}', '\u2026'])('%j keys per folder and keeps author and narrator', (title) => {
    const key = buildGroupingKey({ title, author: 'Author A', narrator: 'Лев Толстой' });
    expect(key).toBe(`${NO_TITLE_PREFIX}authora|левтолстои`);
    expect(key!.startsWith(UNGROUPED_PREFIX)).toBe(true);
  });

  it('different authors keep different keys', () => {
    expect(buildGroupingKey({ title: ' ', author: 'Author A' })).not.toBe(buildGroupingKey({ title: ' ', author: 'Author B' }));
  });
});
