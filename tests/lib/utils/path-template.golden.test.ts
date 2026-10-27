/**
 * Component: Path Template Golden Corpus
 * Documentation: documentation/phase3/file-organization.md
 *
 * Every row was captured from main (ba411d3) before {primaryAuthor} and
 * {seriesPart:00} landed: resolver output, renamed filenames, mock previews and
 * both validators' result with the exact error text. Changes to the template
 * engine must keep every row byte for byte. Rows are literal; never regenerate
 * this file from the code under test.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  substituteTemplate,
  validateTemplate,
  validateFilenameTemplate,
  buildRenamedFilename,
  generateMockPreviews,
  generateMockFilenamePreviews,
  type TemplateVariables,
  type ValidationResult,
} from '@/lib/utils/path-template.util';

interface Golden {
  variableSets: Record<string, TemplateVariables>;
  substitute: [string, string, string][];
  rename: [string, string, number | null, string][];
  validate: [string, ValidationResult][];
  validateFilename: [string, ValidationResult][];
  mockPreviews: [string, string[]][];
  mockFilenamePreviews: [string, { single: string[]; multi: string[] }][];
}

const golden: Golden = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'path-template-golden.json'), 'utf8'),
);
const vars = (name: string) => golden.variableSets[name];

describe('path template golden corpus', () => {
  it('covers every section', () => {
    expect(golden.substitute.length).toBeGreaterThan(1000);
    expect(golden.rename.length).toBeGreaterThan(300);
    expect(golden.validate.length).toBeGreaterThan(80);
    expect(golden.validateFilename.length).toBe(golden.validate.length);
  });

  it.each(golden.substitute)('substituteTemplate(%j) with %s', (template, set, expected) => {
    expect(substituteTemplate(template, vars(set))).toBe(expected);
  });

  it.each(golden.rename)('buildRenamedFilename(%j) with %s, index %s', (template, set, index, expected) => {
    const ext = index === null ? '.m4b' : '.mp3';
    expect(buildRenamedFilename(template, vars(set), ext, index ?? undefined)).toBe(expected);
  });

  it.each(golden.validate)('validateTemplate(%j)', (template, expected) => {
    expect(validateTemplate(template)).toStrictEqual(expected);
  });

  it.each(golden.validateFilename)('validateFilenameTemplate(%j)', (template, expected) => {
    expect(validateFilenameTemplate(template)).toStrictEqual(expected);
  });

  it.each(golden.mockPreviews)('generateMockPreviews(%j)', (template, expected) => {
    expect(generateMockPreviews(template)).toEqual(expected);
  });

  it.each(golden.mockFilenamePreviews)('generateMockFilenamePreviews(%j)', (template, expected) => {
    expect(generateMockFilenamePreviews(template)).toEqual(expected);
  });
});
