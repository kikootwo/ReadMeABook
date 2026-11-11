/**
 * Component: Import List Filter Profiles
 * Documentation: documentation/backend/services/list-sync.md
 *
 * Reusable rules that decide which list books are requested. Evaluated in two stages:
 * before matching (title/author only) and after matching (Audible data).
 */

import type { ImportListFilterProfile } from '@/generated/prisma/client';

/** The Audible fields the rules read (a subset of the Audible search result). */
export interface AudibleMeta {
  asin: string;
  title: string;
  author: string;
  narrator?: string;
  coverArtUrl?: string;
  description?: string;
  durationMinutes?: number;
  releaseDate?: string;
  rating?: number;
  language?: string;
  formatType?: string;
  publisherName?: string;
  genres?: string[];
}

export interface FilterRules {
  skipPartsAndSets: boolean;
  titleExcludePatterns: string[];
  authorExcludePatterns: string[];
  requireAudibleAsin: boolean;
  allowAbridged: boolean;
  minRuntimeMinutes: number;
  maxRuntimeMinutes: number;
  minPublicationYear: number;
  maxPublicationYear: number;
  allowedLanguages: string[];
  excludedPublishers: string[];
  excludedNarrators: string[];
  excludedGenres: string[];
  includedGenres: string[];
  minAudibleRating: number;
}

/** Box sets, omnibus editions and multi-book ranges are skipped when "skip parts and sets" is on. */
const PARTS_AND_SETS =
  /\b(box(?:ed)?\s*set|omnibus|complete\s+(?:series|collection|saga)|books?\s+\d+\s*[-–—]\s*\d+|volumes?\s+\d+\s*[-–—]\s*\d+|bundle)\b/i;

const LANGUAGE_ALIASES: Record<string, string> = { eng: 'english', en: 'english', english: 'english' };

function parseList(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
  } catch {
    return [];
  }
}

export function toRules(row: ImportListFilterProfile): FilterRules {
  return {
    skipPartsAndSets: row.skipPartsAndSets,
    titleExcludePatterns: parseList(row.titleExcludePatterns),
    authorExcludePatterns: parseList(row.authorExcludePatterns),
    requireAudibleAsin: row.requireAudibleAsin,
    allowAbridged: row.allowAbridged,
    minRuntimeMinutes: row.minRuntimeMinutes,
    maxRuntimeMinutes: row.maxRuntimeMinutes,
    minPublicationYear: row.minPublicationYear,
    maxPublicationYear: row.maxPublicationYear,
    allowedLanguages: parseList(row.allowedLanguages).map((l) => LANGUAGE_ALIASES[l.toLowerCase()] ?? l.toLowerCase()),
    excludedPublishers: parseList(row.excludedPublishers).map((v) => v.toLowerCase()),
    excludedNarrators: parseList(row.excludedNarrators).map((v) => v.toLowerCase()),
    excludedGenres: parseList(row.excludedGenres).map((v) => v.toLowerCase()),
    includedGenres: parseList(row.includedGenres).map((v) => v.toLowerCase()),
    minAudibleRating: row.minAudibleRating,
  };
}

/** Check that every pattern compiles; returns the first bad one, or null. */
export function firstInvalidPattern(patterns: string[]): string | null {
  for (const p of patterns) {
    try {
      new RegExp(p, 'i');
    } catch {
      return p;
    }
  }
  return null;
}

function matchesAny(patterns: string[], text: string): boolean {
  return patterns.some((p) => {
    try {
      return new RegExp(p, 'i').test(text);
    } catch {
      return false;
    }
  });
}

/** Stage 1: title/author only. Returns the reason a book is dropped, or null to keep it. */
export function preFilter(title: string, author: string, rules: FilterRules): string | null {
  if (rules.skipPartsAndSets && PARTS_AND_SETS.test(title)) return 'box set / omnibus';
  if (matchesAny(rules.titleExcludePatterns, title)) return 'title excluded';
  if (matchesAny(rules.authorExcludePatterns, author)) return 'author excluded';
  return null;
}

/** True when any rule needs Audible data (otherwise a missing match can still be requested by ASIN only). */
export function needsMetadata(rules: FilterRules): boolean {
  return (
    !rules.allowAbridged ||
    rules.minRuntimeMinutes > 0 ||
    rules.maxRuntimeMinutes > 0 ||
    rules.minPublicationYear > 0 ||
    rules.maxPublicationYear > 0 ||
    rules.allowedLanguages.length > 0 ||
    rules.excludedPublishers.length > 0 ||
    rules.excludedNarrators.length > 0 ||
    rules.excludedGenres.length > 0 ||
    rules.includedGenres.length > 0 ||
    rules.minAudibleRating > 0
  );
}

/** Stage 2: Audible data. Returns the reason a book is dropped, or null to keep it. */
export function deepFilter(meta: AudibleMeta, rules: FilterRules): string | null {
  if (!rules.allowAbridged && (meta.formatType || '').toLowerCase() === 'abridged') return 'abridged';

  const minutes = meta.durationMinutes ?? 0;
  if (rules.minRuntimeMinutes > 0 && minutes < rules.minRuntimeMinutes) return 'too short';
  if (rules.maxRuntimeMinutes > 0 && minutes > rules.maxRuntimeMinutes) return 'too long';

  const year = meta.releaseDate ? parseInt(meta.releaseDate.slice(0, 4), 10) : 0;
  if (year) {
    if (rules.minPublicationYear > 0 && year < rules.minPublicationYear) return 'published too early';
    if (rules.maxPublicationYear > 0 && year > rules.maxPublicationYear) return 'published too late';
  }

  if (rules.allowedLanguages.length > 0) {
    const language = LANGUAGE_ALIASES[(meta.language || '').toLowerCase()] ?? (meta.language || '').toLowerCase();
    if (!rules.allowedLanguages.includes(language)) return 'language';
  }

  if (rules.excludedPublishers.length > 0 && rules.excludedPublishers.includes((meta.publisherName || '').toLowerCase())) {
    return 'publisher excluded';
  }
  if (rules.excludedNarrators.length > 0) {
    const narrators = (meta.narrator || '').toLowerCase();
    if (rules.excludedNarrators.some((n) => narrators.includes(n))) return 'narrator excluded';
  }

  const genres = (meta.genres || []).map((g) => g.toLowerCase());
  if (rules.excludedGenres.length > 0 && genres.some((g) => rules.excludedGenres.includes(g))) return 'genre excluded';
  if (rules.includedGenres.length > 0 && !genres.some((g) => rules.includedGenres.includes(g))) return 'genre not included';

  if (rules.minAudibleRating > 0 && (meta.rating ?? 0) < rules.minAudibleRating) return 'rating too low';

  return null;
}

/** Built-in profiles created on first use. Each has a stable seedSlug so renaming does not re-seed. */
export const SEED_PROFILES = [
  {
    seedSlug: 'standard',
    name: 'Standard',
    data: { skipPartsAndSets: true, requireAudibleAsin: true, allowAbridged: true },
  },
  {
    seedSlug: 'strict',
    name: 'Strict (English, unabridged, 1h+, rated 3.5+)',
    data: {
      skipPartsAndSets: true,
      requireAudibleAsin: true,
      allowAbridged: false,
      minRuntimeMinutes: 60,
      allowedLanguages: JSON.stringify(['english']),
      minAudibleRating: 3.5,
    },
  },
] as const;
