/**
 * Component: Import List Filter Profile helpers
 * Documentation: documentation/backend/services/list-sync.md
 */

import type { ImportListFilterProfile } from '@/generated/prisma/client';
import type { FilterRules } from '@/lib/services/import-lists/filter';
import type { FilterProfileInput as ProfileInput } from '@/lib/services/import-lists/validation';

/** Screen shape: arrays instead of JSON text, plus how many lists use the profile. */
export function serializeProfile(row: ImportListFilterProfile & { _count?: { lists: number } }, rules: FilterRules) {
  return {
    id: row.id,
    name: row.name,
    builtIn: row.seedSlug !== null,
    listCount: row._count?.lists ?? 0,
    ...rules,
    // Keep the language names as typed rather than the normalised forms
    allowedLanguages: JSON.parse(row.allowedLanguages || '[]') as string[],
    updatedAt: row.updatedAt,
  };
}

/** Database columns for a validated profile (arrays stored as JSON text). */
export function profileData(input: ProfileInput) {
  return {
    name: input.name,
    skipPartsAndSets: input.skipPartsAndSets,
    titleExcludePatterns: JSON.stringify(input.titleExcludePatterns),
    authorExcludePatterns: JSON.stringify(input.authorExcludePatterns),
    requireAudibleAsin: input.requireAudibleAsin,
    allowAbridged: input.allowAbridged,
    minRuntimeMinutes: input.minRuntimeMinutes,
    maxRuntimeMinutes: input.maxRuntimeMinutes,
    minPublicationYear: input.minPublicationYear,
    maxPublicationYear: input.maxPublicationYear,
    allowedLanguages: JSON.stringify(input.allowedLanguages),
    excludedPublishers: JSON.stringify(input.excludedPublishers),
    excludedNarrators: JSON.stringify(input.excludedNarrators),
    excludedGenres: JSON.stringify(input.excludedGenres),
    includedGenres: JSON.stringify(input.includedGenres),
    minAudibleRating: input.minAudibleRating,
  };
}
