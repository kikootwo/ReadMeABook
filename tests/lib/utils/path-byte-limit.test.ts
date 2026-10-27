/**
 * Component: Path Template Byte Limit Tests (#264)
 * Documentation: documentation/phase3/file-organization.md
 */

import { describe, it, expect } from 'vitest';
import { substituteTemplate, buildRenamedFilename, type TemplateVariables } from '@/lib/utils/path-template.util';

const MAX = 255;
const bytes = (value: string) => Buffer.byteLength(value, 'utf8');

/** At most 255 bytes, valid UTF-8 (a split surrogate pair would not survive the round trip), no trailing space or dot */
function expectFits(component: string) {
  expect(component.length).toBeGreaterThan(0);
  expect(bytes(component)).toBeLessThanOrEqual(MAX);
  expect(Buffer.from(component, 'utf8').toString('utf8')).toBe(component);
  expect(component).not.toMatch(/[ .]$/);
}

// Each is longer than 200 characters, so the per-variable cap leaves 200 of them
const CYRILLIC = 'Преступление и наказание '.repeat(10).trim(); // 2 bytes per letter
const CJK = '吾輩は猫である'.repeat(40); // 3 bytes per character
const EMOJI = `a${'📚'.repeat(120)}`; // 4 bytes each, two UTF-16 code units: the cut must not split one

describe('path template: every component fits in 255 bytes (#264)', () => {
  it.each([
    ['Cyrillic', CYRILLIC],
    ['CJK', CJK],
    ['emoji', EMOJI],
  ])('a long %s title: the folder is cut to fit, between characters', (_label, title) => {
    const result = substituteTemplate('{author}/{title}', { author: 'Автор', title });
    const [author, folder, ...rest] = result.split('/');

    expect(rest).toEqual([]);
    expect(author).toBe('Автор');
    expectFits(folder);
    // A prefix of what the per-variable cap leaves, as long as fits less one character
    expect(title.startsWith(folder)).toBe(true);
    expect(bytes(folder)).toBeGreaterThan(MAX - 4 - 1);
  });

  it('two long ASCII variables joined in one folder name', () => {
    const vars: TemplateVariables = { author: 'Author', title: 'T'.repeat(200), series: 'S'.repeat(200) };
    const result = substituteTemplate('{author}/{title} - {series}', vars);
    const [author, folder] = result.split('/');

    expect(author).toBe('Author');
    expectFits(folder);
    expect(folder).toBe(`${'T'.repeat(200)} - ${'S'.repeat(52)}`);
  });

  it('caps each folder of a multi-level template on its own', () => {
    const result = substituteTemplate('{author}/{series}/{title}', { author: CJK, series: CYRILLIC, title: 'Book' });
    const parts = result.split('/');

    expect(parts).toHaveLength(3);
    parts.forEach(expectFits);
    expect(parts[2]).toBe('Book');
  });

  it('an escaped brace is counted as the one byte it becomes', () => {
    // 253 bytes as written; its brace placeholders take 3 bytes each until the last step
    const result = substituteTemplate('{title} {asin} \\{x\\}', { author: 'A', title: 'T'.repeat(200), asin: 'B'.repeat(48) });
    expect(result).toBe(`${'T'.repeat(200)} ${'B'.repeat(48)} {x}`);
  });
});

describe('path template: names that already fit are unchanged (#264)', () => {
  it.each([
    ['{author}/{title} {asin}', { author: 'Brandon Sanderson', title: 'Mistborn: The Final Empire', asin: 'B002UZMLXM' }, 'Brandon Sanderson/Mistborn The Final Empire B002UZMLXM'],
    ['{author}/{series}/{seriesPart} - {title}', { author: 'Brandon Sanderson', title: 'Mistborn', series: 'The Mistborn Saga', seriesPart: '1' }, 'Brandon Sanderson/The Mistborn Saga/1 - Mistborn'],
    // 127 Cyrillic letters: 254 bytes
    ['{author}/{title}', { author: 'Лев Толстой', title: 'Ж'.repeat(127) }, `Лев Толстой/${'Ж'.repeat(127)}`],
    // Exactly 255 bytes: 200 + ' ' + 54
    ['{title} {asin}', { author: 'A', title: 'T'.repeat(200), asin: 'B'.repeat(54) }, `${'T'.repeat(200)} ${'B'.repeat(54)}`],
    // 200-character ASCII cap, as today
    ['{author}/{title}', { author: 'A', title: 'x'.repeat(300) }, `A/${'x'.repeat(200)}`],
  ] as Array<[string, TemplateVariables, string]>)('%s', (template, vars, expected) => {
    expect(substituteTemplate(template, vars)).toBe(expected);
  });
});

describe('renamed file names fit in 255 bytes with " - N" and the extension intact (#264)', () => {
  it.each([
    ['Cyrillic', CYRILLIC, 12, '.mp3', ' - 12.mp3'],
    ['CJK', CJK, undefined, '.m4b', '.m4b'],
    ['emoji', EMOJI, 3, 'm4a', ' - 3.m4a'],
  ])('a long %s title', (_label, title, index, ext, ending) => {
    const name = buildRenamedFilename('{title}', { author: 'A', title }, ext, index);

    expectFits(name);
    expect(name.endsWith(ending)).toBe(true);
    const stem = name.slice(0, -ending.length);
    expect(title.startsWith(stem)).toBe(true);
    expect(bytes(name)).toBeGreaterThan(MAX - 4);
  });

  it('two long ASCII variables in one file name: the 200-character name cap applies first, as today', () => {
    const vars: TemplateVariables = { author: 'A'.repeat(200), title: 'T'.repeat(200) };
    const name = buildRenamedFilename('{author} - {title}', vars, '.mp3', 7);

    expectFits(name);
    expect(name).toBe(`${'A'.repeat(200)} - 7.mp3`);
  });

  it.each([
    ['{title}', { author: 'A', title: 'A'.repeat(300) }, '.m4b', undefined, `${'A'.repeat(200)}.m4b`],
    ['{title}', { author: 'A', title: 'Mistborn: The Final Empire' }, '.mp3', 1, 'Mistborn The Final Empire - 1.mp3'],
    // 123 Cyrillic letters + ' - 1.mp3': 254 bytes
    ['{title}', { author: 'A', title: 'Ж'.repeat(123) }, '.mp3', 1, `${'Ж'.repeat(123)} - 1.mp3`],
  ] as Array<[string, TemplateVariables, string, number | undefined, string]>)('unchanged when it fits: %s -> %s', (template, vars, ext, index, expected) => {
    expect(buildRenamedFilename(template, vars, ext, index)).toBe(expected);
  });
});
