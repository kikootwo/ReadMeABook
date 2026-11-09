/**
 * Component: Path Template {primaryAuthor} Tests
 * Documentation: documentation/phase3/file-organization.md
 */

import { describe, it, expect } from 'vitest';
import {
  substituteTemplate,
  validateTemplate,
  validateFilenameTemplate,
  buildRenamedFilename,
  generateMockPreviews,
  getValidVariables,
} from '@/lib/utils/path-template.util';

const VALID_LIST =
  '{author}, {primaryAuthor}, {title}, {narrator}, {asin}, {year}, {series}, {seriesPart}';

const folder = (author: string) => substituteTemplate('{primaryAuthor}/{title}', { author, title: 'T' });

describe('{primaryAuthor} resolves to the first author', () => {
  it.each([
    ['A, B', 'A/T'],
    ['A; B', 'A/T'],
    ['A & B', 'A/T'],
    ['A,B;C&D', 'A/T'],
    [', A', 'A/T'],
    ['  Douglas Preston ,Lincoln Child', 'Douglas Preston/T'],
    ['A', 'A/T'],
    ['Victoria Aveyard, Birgit Schmitz - Übersetzer', 'Victoria Aveyard/T'],
    ['Martin Luther King, Jr.', 'Martin Luther King/T'],
    ['Tolkien, J.R.R.', 'Tolkien/T'],
    ['A and B', 'A and B/T'],
    ['?, Bob', 'Bob/T'],
    ['..., Bob', 'Bob/T'],
    ['村上春樹, 翻訳者', '村上春樹/T'],
  ])('author %j gives %j', (author, expected) => {
    expect(folder(author)).toBe(expected);
  });

  it.each([[''], ['   '], [','], [';'], [', ;'], ['?']])(
    'author %j gives an empty value, so the segment collapses',
    (author) => {
      expect(folder(author)).toBe('T');
    }
  );

  it('treats a missing author as empty', () => {
    const variables = { title: 'T' } as unknown as Parameters<typeof substituteTemplate>[1];
    expect(substituteTemplate('{primaryAuthor}/{title}', variables)).toBe('T');
  });

  it('leaves {author} as the full author string', () => {
    expect(substituteTemplate('{author}/{primaryAuthor}/{title}', { author: 'A, B', title: 'T' })).toBe(
      'A, B/A/T'
    );
  });

  it('renders a conditional block when there is a first author and drops it when there is none', () => {
    const template = '{by primaryAuthor - }{title}';
    expect(substituteTemplate(template, { author: 'A & B', title: 'T' })).toBe('by A - T');
    expect(substituteTemplate(template, { author: ', ;', title: 'T' })).toBe('T');
  });

  it('works next to the other variables', () => {
    expect(
      substituteTemplate('{primaryAuthor}/{series}/{seriesPart} - {title}', {
        author: 'Douglas Preston, Lincoln Child',
        title: 'Relic',
        series: 'Pendergast',
        seriesPart: '1',
      })
    ).toBe('Douglas Preston/Pendergast/1 - Relic');
  });

  it('sanitizes the first author like {author}', () => {
    expect(folder('../x, y')).toBe('x/T');
    expect(folder('a/b & c')).toBe('ab/T');
    expect(folder('Wh<a>t: Q, B')).toBe('What Q/T');
  });

  it('shows the first author in the preview', () => {
    expect(generateMockPreviews('{primaryAuthor}/{title}')).toEqual([
      'Brandon Sanderson/Mistborn The Final Empire',
      "Douglas Adams/The Hitchhiker's Guide to the Galaxy",
      'Andy Weir/Project Hail Mary',
    ]);
  });

  it('builds a renamed file from it', () => {
    expect(
      buildRenamedFilename('{primaryAuthor} - {title}', { author: 'A, B', title: 'T' }, '.m4b')
    ).toBe('A - T.m4b');
    expect(
      buildRenamedFilename('{primaryAuthor} - {title}', { author: 'A, B', title: 'T' }, '.mp3', 2)
    ).toBe('A - T - 2.mp3');
  });
});

describe('{primaryAuthor} validation', () => {
  it('is a valid path variable, plain and in a conditional block', () => {
    expect(validateTemplate('{primaryAuthor}/{title}')).toStrictEqual({ valid: true });
    expect(validateTemplate('{author}/{x primaryAuthor - }{title}')).toStrictEqual({ valid: true });
  });

  it('is a valid filename variable', () => {
    expect(validateFilenameTemplate('{primaryAuthor} - {title}')).toStrictEqual({ valid: true });
    expect(validateFilenameTemplate('{by primaryAuthor - }{title}')).toStrictEqual({ valid: true });
  });

  it('is listed right after author', () => {
    expect(getValidVariables()).toEqual([
      'author',
      'primaryAuthor',
      'title',
      'narrator',
      'asin',
      'year',
      'series',
      'seriesPart',
    ]);
  });

  it('appears in the "Valid variables are:" list of both validators', () => {
    expect(validateTemplate('{invalid}')).toStrictEqual({
      valid: false,
      error: `No valid variable found in conditional block: {invalid}. Valid variables are: ${VALID_LIST}`,
    });
    expect(validateFilenameTemplate('{invalid}')).toStrictEqual({
      valid: false,
      error: `No valid variable found in: {invalid}. Valid variables are: ${VALID_LIST}`,
    });
  });

  it('does not match a longer word', () => {
    expect(validateTemplate('{x primaryAuthors}').valid).toBe(false);
    expect(substituteTemplate('{author}/{primaryAuthors}', { author: 'A, B', title: 'T' })).toBe(
      'A, B/{primaryAuthors}'
    );
  });
});
