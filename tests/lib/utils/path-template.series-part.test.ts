/**
 * Component: Path Template {seriesPart:00} Tests (#250)
 * Documentation: documentation/phase3/file-organization.md
 */

import { describe, it, expect } from 'vitest';
import {
  substituteTemplate,
  validateTemplate,
  validateFilenameTemplate,
  buildRenamedFilename,
  generateMockPreviews,
  generateMockFilenamePreviews,
  type TemplateVariables,
} from '@/lib/utils/path-template.util';

const base: TemplateVariables = { author: 'A', title: 'T', series: 'S' };
const part = (seriesPart: string | undefined, template = '{seriesPart:00}') =>
  substituteTemplate(template, { ...base, seriesPart });

const unsupported = (spec: string) =>
  `Unsupported format: {${spec}}. Only {seriesPart} takes a format: {seriesPart:00}, {seriesPart:000} or {seriesPart:0000}.`;

describe('{seriesPart:00} pads the number', () => {
  it.each([
    ['1', '01'],
    ['0', '00'],
    ['1.5', '01.5'],
    ['10', '10'],
    ['100', '100'],
    ['001', '001'],
    [' 7 ', '07'],
    ['1-3', '01-03'],
    ['1.5-2', '01.5-02'],
    ['1 - 3', '01 - 03'],
    ['10-12', '10-12'],
  ])('%j gives %j', (value, expected) => {
    expect(part(value)).toBe(expected);
  });

  it.each([['Book 1'], ['1a'], ['1, 2'], ['-1'], ['1\u20133'], ['1-'], ['1.'], ['.5']])(
    'leaves %j as {seriesPart} does',
    (value) => {
      expect(part(value)).toBe(part(value, '{seriesPart}'));
      expect(part(value)).not.toMatch(/^0/);
    }
  );

  it('pads to 3 and 4 digits', () => {
    expect(part('1', '{seriesPart:000}')).toBe('001');
    expect(part('12', '{seriesPart:000}')).toBe('012');
    expect(part('1-3', '{seriesPart:000}')).toBe('001-003');
    expect(part('1', '{seriesPart:0000}')).toBe('0001');
    expect(part('12345', '{seriesPart:0000}')).toBe('12345');
  });

  it('removes an empty part exactly like {seriesPart}', () => {
    const template = '{author}/{series}/{seriesPart:00} - {title}';
    for (const value of [undefined, '', '   ']) {
      expect(part(value, template)).toBe(part(value, template.replace(':00', '')));
    }
    expect(part('', template)).toBe('A/S/- T');
  });

  it('renders a conditional block with a value and drops it without one', () => {
    expect(part('1', '{author}/{Book seriesPart:00 - }{title}')).toBe('A/Book 01 - T');
    expect(part('', '{author}/{Book seriesPart:00 - }{title}')).toBe('A/T');
    expect(part('2', '{series - }{seriesPart:000 - }{title}')).toBe('S - 002 - T');
    expect(substituteTemplate('{series seriesPart:00}/{title}', { author: 'A', title: 'T', seriesPart: '3' })).toBe('T');
  });

  it('pads in a folder template next to {primaryAuthor}', () => {
    expect(
      substituteTemplate('{primaryAuthor}/{series}/{seriesPart:00} - {title}', {
        author: 'Douglas Preston, Lincoln Child',
        title: 'Relic',
        series: 'Pendergast',
        seriesPart: '1',
      })
    ).toBe('Douglas Preston/Pendergast/01 - Relic');
  });

  it('pads in a renamed file', () => {
    expect(buildRenamedFilename('{seriesPart:00} - {title}', { ...base, seriesPart: '3' }, '.m4b')).toBe('03 - T.m4b');
    expect(buildRenamedFilename('{seriesPart:00} - {title}', { ...base, seriesPart: '3' }, '.mp3', 2)).toBe('03 - T - 2.mp3');
  });

  it('shows padded parts in the previews', () => {
    expect(generateMockPreviews('{series}/{seriesPart:00} - {title}')).toEqual([
      'The Mistborn Saga/01 - Mistborn The Final Empire',
      "Hitchhiker's Guide/01 - The Hitchhiker's Guide to the Galaxy",
      '- Project Hail Mary',
    ]);
    expect(generateMockFilenamePreviews('{seriesPart:00} - {title}').single).toEqual([
      '01 - Mistborn The Final Empire.m4b',
      "01 - The Hitchhiker's Guide to the Galaxy.m4b",
    ]);
  });
});

describe('{seriesPart:00} keeps paths safe', () => {
  it.each([['../1'], ['1/2'], ['1\\2'], ['.5'], ['1:2'], ['1?']])(
    'part %j gives the same safe segment as {seriesPart}',
    (value) => {
      const template = '{author}/{seriesPart:00}/{title}';
      const result = part(value, template);
      expect(result).toBe(part(value, '{author}/{seriesPart}/{title}'));
      expect(result.split('/')).toHaveLength(3);
      expect(result).not.toMatch(/(^|\/)\.\./);
      expect(result).not.toMatch(/[<>:"\\|?*]/);
    }
  );

  it('keeps a first author with path characters to one safe segment', () => {
    const result = substituteTemplate('{primaryAuthor}/{seriesPart:00}', { author: '../x, y', title: 'T', seriesPart: '1' });
    expect(result).toBe('x/01');
  });
});

describe('an unsupported format resolves as it did before', () => {
  const full: TemplateVariables = { author: 'B', title: 'M', year: 2006, seriesPart: '1' };
  it.each([
    ['{seriesPart:year}', '1:2006'],
    ['{author:title}', 'B:M'],
    ['{seriesPart:x}', '1:x'],
    ['{seriesPart:}', '1:'],
    ['{seriesPart:0}', '1:0'],
    ['{seriesPart:00x}', '1:00x'],
    ['{year:00}', '2006:00'],
  ])('%s gives %j', (template, expected) => {
    expect(substituteTemplate(template, full)).toBe(expected);
  });
});

describe('validation of formats', () => {
  it.each([
    '{seriesPart:00}',
    '{seriesPart:000}',
    '{seriesPart:0000}',
    '{author}/{series}/{seriesPart:00} - {title}',
    '{author}/{Book seriesPart:00 - }{title}',
    '{series seriesPart:000}',
  ])('accepts %s in both validators', (template) => {
    expect(validateTemplate(template)).toStrictEqual({ valid: true });
    expect(validateFilenameTemplate(template.replace(/\//g, ' '))).toStrictEqual({ valid: true });
  });

  it.each([
    ['{seriesPart:0}', 'seriesPart:0'],
    ['{seriesPart:5}', 'seriesPart:5'],
    ['{seriesPart:x}', 'seriesPart:x'],
    ['{seriesPart:00x}', 'seriesPart:00x'],
    ['{seriesPart:00000}', 'seriesPart:00000'],
    ['{seriesPart:year}', 'seriesPart:year'],
    ['{year:00}', 'year:00'],
    ['{author:00}', 'author:00'],
    ['{Book seriesPart:x - }{title}', 'seriesPart:x'],
  ])('rejects %s in both validators', (template, spec) => {
    const expected = { valid: false, error: unsupported(spec) };
    expect(validateTemplate(template)).toStrictEqual(expected);
    expect(validateFilenameTemplate(template)).toStrictEqual(expected);
  });

  it('keeps the old message for a colon that is not a format', () => {
    for (const template of ['{seriesPart:}', '{Part: seriesPart}', '{seriesPart :00}', '{seriesPart:00:00}']) {
      expect(validateTemplate(template)).toStrictEqual({
        valid: false,
        error: 'Invalid characters found: :. These characters are not allowed in path templates.',
      });
      expect(validateFilenameTemplate(template)).toStrictEqual({
        valid: false,
        error: 'Invalid characters found: :. These characters are not allowed in filenames.',
      });
    }
  });

  it('still rejects other characters in a block that uses a format', () => {
    expect(validateTemplate('{seriesPart:00 | }{title}')).toStrictEqual({
      valid: false,
      error: 'Invalid characters found: |. These characters are not allowed in path templates.',
    });
  });
});
