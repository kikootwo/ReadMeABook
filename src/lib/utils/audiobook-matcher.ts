/**
 * Component: Audiobook Matching Utility
 * Documentation: documentation/integrations/audible.md
 *
 * Real-time matching between Audible books and library backends (Plex or Audiobookshelf).
 * ASIN-only matching for library availability checks (exact matches only).
 */

import { prisma } from '@/lib/db';
import { LibraryItem } from '@/lib/services/library';
import { RMABLogger } from './logger';

// Module-level logger
const logger = RMABLogger.create('AudiobookMatcher');

export interface AudiobookMatchInput {
  asin: string;
  title: string;
  author: string;
  narrator?: string;
}

export interface AudiobookMatchResult {
  plexGuid: string;
  plexRatingKey: string | null;
  title: string;
  author: string;
}

/**
 * Find a matching audiobook in the Plex library for a given Audible audiobook.
 *
 * Matching logic (ASIN-only, exact matches):
 * 1. **ASIN in dedicated field** - Check if plexLibrary.asin matches (100% confidence)
 * 2. **ASIN in plexGuid** - Check if Plex GUID contains the Audible ASIN (backward compatibility)
 * 3. **No match** - Return null (no fuzzy fallback)
 *
 * @param audiobook - Audible audiobook to match
 * @returns Matched Plex library item or null
 */
export async function findPlexMatch(
  audiobook: AudiobookMatchInput
): Promise<AudiobookMatchResult | null> {
  // Early return if no ASIN provided (prevents empty string matching all records)
  if (!audiobook.asin || audiobook.asin.trim() === '') {
    logger.debug('Matcher result', {
      MATCHER: {
        input: {
          title: audiobook.title,
          author: audiobook.author,
          narrator: audiobook.narrator || null,
          asin: audiobook.asin,
        },
        candidatesFound: 0,
        matchType: 'no_asin_provided',
        matched: false,
        result: null,
      }
    });
    return null;
  }

  // Query plex_library directly by ASIN (indexed O(1) lookup)
  // Check both dedicated asin field and plexGuid for backward compatibility
  const plexBooks = await prisma.plexLibrary.findMany({
    where: {
      OR: [
        { asin: audiobook.asin },
        { plexGuid: { contains: audiobook.asin } },
      ],
    },
    select: {
      plexGuid: true,
      plexRatingKey: true,
      title: true,
      author: true,
      asin: true,
    },
  });

  // Build match result for logging
  const matchResult: any = {
    input: {
      title: audiobook.title,
      author: audiobook.author,
      narrator: audiobook.narrator || null,
      asin: audiobook.asin,
    },
    candidatesFound: plexBooks.length,
    matchType: null,
    matched: false,
    result: null,
  };

  // If no ASIN matches found, log and return null
  if (plexBooks.length === 0) {
    matchResult.matchType = 'no_asin_match';
    logger.debug('Matcher result', { MATCHER: matchResult });
    return null;
  }

  // PRIORITY 1a: Check for EXACT ASIN match in dedicated field (works for all backends)
  for (const plexBook of plexBooks) {
    if (plexBook.asin && plexBook.asin.toLowerCase() === audiobook.asin.toLowerCase()) {
      matchResult.matchType = 'asin_exact_field';
      matchResult.matched = true;
      matchResult.result = {
        plexGuid: plexBook.plexGuid,
        plexTitle: plexBook.title,
        plexAuthor: plexBook.author,
        asin: plexBook.asin,
        confidence: 100,
      };
      logger.debug('Matcher result', { MATCHER: matchResult });
      return plexBook;
    }
  }

  // PRIORITY 1b: Check for ASIN in plexGuid (backward compatibility for Plex)
  for (const plexBook of plexBooks) {
    if (plexBook.plexGuid && plexBook.plexGuid.includes(audiobook.asin)) {
      matchResult.matchType = 'asin_exact_guid';
      matchResult.matched = true;
      matchResult.result = {
        plexGuid: plexBook.plexGuid,
        plexTitle: plexBook.title,
        plexAuthor: plexBook.author,
        confidence: 100,
      };
      logger.debug('Matcher result', { MATCHER: matchResult });
      return plexBook;
    }
  }

  // No exact match found (shouldn't happen given the query, but defensive)
  matchResult.matchType = 'no_exact_match';
  logger.debug('Matcher result', { MATCHER: matchResult });
  return null;
}

/**
 * Enrich an Audible audiobook with Plex library match information.
 * Used by API routes to add availability status to responses.
 */
export async function enrichAudiobookWithMatch(audiobook: AudiobookMatchInput & Record<string, any>) {
  const match = await findPlexMatch(audiobook);

  return {
    ...audiobook,
    isAvailable: match !== null,
    plexGuid: match?.plexGuid || null,
  };
}

/**
 * Batch enrich multiple audiobooks with match information.
 * Processes in parallel for better performance.
 *
 * @param audiobooks - Audiobooks to enrich
 * @param userId - Optional user ID to check request status
 */
export async function enrichAudiobooksWithMatches(
  audiobooks: Array<AudiobookMatchInput & Record<string, any>>,
  userId?: string
) {
  // Batch parallel DB queries to avoid connection pool exhaustion
  const BATCH_SIZE = 5;
  const results: Awaited<ReturnType<typeof enrichAudiobookWithMatch>>[] = [];
  for (let i = 0; i < audiobooks.length; i += BATCH_SIZE) {
    const batch = audiobooks.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(batch.map((book) => enrichAudiobookWithMatch(book)));
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        logger.error('Failed to enrich audiobook', { error: result.reason instanceof Error ? result.reason.message : String(result.reason) });
      }
    }
  }

  // Always enrich with request status (check ANY user's requests)
  const asins = audiobooks.map(book => book.asin);

  // Get all audiobook records for these ASINs with ALL audiobook requests (not ebook requests)
  const audiobookRecords = await prisma.audiobook.findMany({
    where: {
      audibleAsin: { in: asins },
    },
    select: {
      id: true,
      audibleAsin: true,
      requests: {
        where: {
          deletedAt: null, // Only include active (non-deleted) requests
          type: 'audiobook', // Only check audiobook requests, not ebook requests
        },
        select: {
          id: true,
          status: true,
          userId: true,
          user: {
            select: {
              plexUsername: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 1,
      },
    },
  });

  // Create a map of ASIN -> request info
  const requestMap = new Map<string, {
    requestId: string;
    requestStatus: string;
    requestedByUserId: string;
    requestedByUsername: string;
  }>();

  for (const record of audiobookRecords) {
    if (record.requests.length > 0 && record.audibleAsin) {
      const request = record.requests[0];
      requestMap.set(record.audibleAsin, {
        requestId: request.id,
        requestStatus: request.status,
        requestedByUserId: request.userId,
        requestedByUsername: request.user.plexUsername,
      });
    }
  }

  // Add request status to results
  for (const result of results) {
    const requestInfo = requestMap.get(result.asin);
    const enrichedResult = result as any;
    if (requestInfo) {
      enrichedResult.isRequested = true;
      enrichedResult.requestStatus = requestInfo.requestStatus;
      enrichedResult.requestId = requestInfo.requestId;
      enrichedResult.requestedByUserId = requestInfo.requestedByUserId;
      // Only include username if it's not the current user
      if (userId && requestInfo.requestedByUserId !== userId) {
        enrichedResult.requestedByUsername = requestInfo.requestedByUsername;
      }
    } else {
      enrichedResult.isRequested = false;
      enrichedResult.requestStatus = null;
      enrichedResult.requestId = null;
      enrichedResult.requestedByUserId = null;
      enrichedResult.requestedByUsername = null;
    }
  }

  // Enrich with reported issue status
  const { getOpenIssuesByAsins } = await import('@/lib/services/reported-issue.service');
  const asinsWithIssues = await getOpenIssuesByAsins(asins);
  for (const result of results) {
    (result as any).hasReportedIssue = asinsWithIssues.has(result.asin);
  }

  logger.debug('Batch summary', {
    total: results.length,
    available: results.filter(r => r.isAvailable).length,
    notAvailable: results.filter(r => !r.isAvailable).length,
    requested: userId ? results.filter(r => (r as any).isRequested).length : 'N/A',
    reportedIssues: asinsWithIssues.size,
  });

  return results;
}

/**
 * Normalize ISBN for comparison (remove dashes and spaces)
 */
function normalizeISBN(isbn: string): string {
  return isbn.replace(/[-\s]/g, '').toUpperCase();
}

/**
 * Generic audiobook matching function that works with LibraryItem interface.
 * Works with any library backend (Plex, Audiobookshelf, etc.)
 *
 * Matching priority (ASIN-only, exact matches):
 * 1. Exact ASIN match (100% confidence)
 * 2. Exact ISBN match (95% confidence)
 * 3. No match - Return null (no fuzzy fallback)
 *
 * @param request - Audiobook request details
 * @param libraryItems - Items from library backend
 * @returns Matched LibraryItem or null
 */
export function matchAudiobook(
  request: { title: string; author: string; asin?: string; isbn?: string },
  libraryItems: LibraryItem[]
): LibraryItem | null {
  // 1. Exact ASIN match (highest confidence)
  if (request.asin) {
    const asinMatch = libraryItems.find(item =>
      item.asin?.toLowerCase() === request.asin?.toLowerCase()
    );
    if (asinMatch) {
      logger.debug('Generic matcher result', {
        matchType: 'asin_exact',
        input: { title: request.title, asin: request.asin },
        matched: { title: asinMatch.title, asin: asinMatch.asin },
        confidence: 100
      });
      return asinMatch;
    }
  }

  // 2. Exact ISBN match (normalize ISBNs by removing dashes)
  if (request.isbn) {
    const normalizedRequestISBN = normalizeISBN(request.isbn);
    const isbnMatch = libraryItems.find(item =>
      item.isbn && normalizeISBN(item.isbn) === normalizedRequestISBN
    );
    if (isbnMatch) {
      logger.debug('Generic matcher result', {
        matchType: 'isbn_exact',
        input: { title: request.title, isbn: request.isbn },
        matched: { title: isbnMatch.title, isbn: isbnMatch.isbn },
        confidence: 95
      });
      return isbnMatch;
    }
  }

  // No match found (no ASIN/ISBN match, no fuzzy fallback)
  logger.debug('Generic matcher result', {
    matchType: 'no_asin_isbn_match',
    input: {
      title: request.title,
      author: request.author,
      asin: request.asin || 'none',
      isbn: request.isbn || 'none'
    },
  });

  return null;
}
