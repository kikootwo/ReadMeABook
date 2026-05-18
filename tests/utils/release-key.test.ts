/**
 * Component: Release Key Normalizer Tests
 * Documentation: documentation/backend/database.md
 */

import { describe, expect, it } from 'vitest';
import { normalizeReleaseKey } from '@/lib/utils/release-key';

describe('normalizeReleaseKey', () => {
  it('lowercases ASCII characters', () => {
    expect(normalizeReleaseKey('SomeReleaseName')).toBe('somereleasename');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeReleaseKey('  hello  ')).toBe('hello');
  });

  it('combines trim and lowercase', () => {
    expect(normalizeReleaseKey('  MIXED.Case Release  ')).toBe('mixed.case release');
  });

  it('preserves internal whitespace', () => {
    expect(normalizeReleaseKey('the templar legacy')).toBe('the templar legacy');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeReleaseKey('')).toBe('');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeReleaseKey('   ')).toBe('');
  });

  it('passes through unicode characters (with native lowercasing)', () => {
    expect(normalizeReleaseKey('Éclair')).toBe('éclair');
  });

  it('is idempotent — normalizing a normalized value is a no-op', () => {
    const once = normalizeReleaseKey('  Some Release  ');
    expect(normalizeReleaseKey(once)).toBe(once);
  });

  it('treats different-case variants of the same release as the same key', () => {
    expect(normalizeReleaseKey('THE.TEMPLAR.LEGACY')).toBe(
      normalizeReleaseKey('the.templar.legacy')
    );
    expect(normalizeReleaseKey('  The.Templar.Legacy ')).toBe(
      normalizeReleaseKey('the.templar.legacy')
    );
  });
});
