/**
 * Component: Import List Validation Schemas
 * Documentation: documentation/backend/services/list-sync.md
 */

import { z } from 'zod';
import { boundedArray } from '@/lib/utils/zod-validation';
import { firstInvalidPattern } from './filter';

/** Accepts a Goodreads list URL (…/list/show/135.Best_Horror_Novels) or a plain number. */
export function parseListId(input: string): number | null {
  const text = String(input ?? '').trim();
  const fromUrl = text.match(/goodreads\.com\/list\/show\/(\d+)/i)?.[1];
  const plain = /^\d+$/.test(text) ? text : undefined;
  const id = parseInt(fromUrl ?? plain ?? '', 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export const ListSettingsSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  autoRequest: z.boolean().optional(),
  syncIntervalHours: z.number().int().min(1).max(720).optional(),
  topN: z.number().int().min(10).max(2000).optional(),
  maxRequestsPerSync: z.number().int().min(0).max(1000).optional(),
  filterProfileId: z.string().uuid().nullable().optional(),
});

export const CreateListSchema = ListSettingsSchema.extend({
  /** A Goodreads list link or number */
  source: z.string().min(1),
});

export const BulkActionSchema = z.object({
  ids: boundedArray(z.string().uuid(), 500, { min: 1 }),
  action: z.enum(['enable', 'disable', 'delete', 'set_profile', 'set_auto_request']),
  filterProfileId: z.string().uuid().nullable().optional(),
  autoRequest: z.boolean().optional(),
});

const stringList = boundedArray(z.string().trim().min(1).max(200), 200).default([]);

export const FilterProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    skipPartsAndSets: z.boolean().default(true),
    titleExcludePatterns: stringList,
    authorExcludePatterns: stringList,
    requireAudibleAsin: z.boolean().default(true),
    allowAbridged: z.boolean().default(false),
    minRuntimeMinutes: z.number().int().min(0).max(100000).default(0),
    maxRuntimeMinutes: z.number().int().min(0).max(100000).default(0),
    minPublicationYear: z.number().int().min(0).max(3000).default(0),
    maxPublicationYear: z.number().int().min(0).max(3000).default(0),
    allowedLanguages: stringList,
    excludedPublishers: stringList,
    excludedNarrators: stringList,
    excludedGenres: stringList,
    includedGenres: stringList,
    minAudibleRating: z.number().min(0).max(5).default(0),
  })
  .superRefine((value, ctx) => {
    for (const field of ['titleExcludePatterns', 'authorExcludePatterns'] as const) {
      const bad = firstInvalidPattern(value[field]);
      if (bad !== null) ctx.addIssue({ code: 'custom', path: [field], message: `"${bad}" is not a valid regular expression` });
    }
  });

export const GlobalSettingsSchema = z.object({
  minFreeGb: z.number().min(0).max(100000).optional(),
  maxRequestsPerHour: z.number().int().min(0).max(1000).optional(),
});

export type FilterProfileInput = z.output<typeof FilterProfileSchema>;
