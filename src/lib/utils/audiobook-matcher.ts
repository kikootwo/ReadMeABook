/**
 * Component: Audiobook Matching Utility
 * Documentation: documentation/integrations/audible.md
 *
 * Real-time matching between Audible books and library backends (Plex or Audiobookshelf).
 * Supports ASIN, ISBN, and fuzzy title/author matching.
 */

import { prisma } from '@/lib/db';
import { compareTwoStrings } from 'string-similarity';
import { LibraryItem } from '@/lib/services/library';

// Debug logging controlled by LOG_LEVEL environment variable
const DEBUG_ENABLED = process.env.LOG_LEVEL === 'debug';

export interface AudiobookMatchInput {
  asin: string;
  title: string;
  author: string;
  narrator?: string;
}

export interface AudiobookMatchResult {
  plexGuid: string;
  title: string;
  author: string;
}

/**
 * Normalize audiobook title for matching by removing common suffixes/prefixes
 * that don't affect the core title identity.
 */
function normalizeTitle(title: string): string {
  let normalized = title.toLowerCase().trim();

  // Remove common parenthetical additions (case-insensitive)
  normalized = normalized.replace(/\s*\(unabridged\)\s*/gi, ' ');
  normalized = normalized.replace(/\s*\(abridged\)\s*/gi, ' ');
  normalized = normalized.replace(/\s*\(full cast\)\s*/gi, ' ');
  normalized = normalized.replace(/\s*\(full-cast edition\)\s*/gi, ' ');
  normalized = normalized.replace(/\s*\(dramatized\)\s*/gi, ' ');
  normalized = normalized.replace(/\s*\(narrated by[^)]*\)\s*/gi, ' ');

  // Remove common subtitle patterns
  normalized = normalized.replace(/:\s*a novel\s*$/gi, '');
  normalized = normalized.replace(/:\s*a thriller\s*$/gi, '');
  normalized = normalized.replace(/:\s*a memoir\s*$/gi, '');

  // Remove book number suffixes (but keep them in main title if they're significant)
  // Only remove if they're clearly series indicators at the end
  normalized = normalized.replace(/,?\s*book\s+\d+\s*$/gi, '');
  normalized = normalized.replace(/:\s*book\s+\d+\s*$/gi, '');

  // Clean up extra whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

/**
 * Find a matching audiobook in the Plex library for a given Audible audiobook.
 *
 * Matching logic (in order of priority):
 * 1. **ASIN in plexGuid** - Check if any Plex book's GUID contains the Audible ASIN (100% match)
 * 2. **Fuzzy matching** - Normalized title/author string similarity with 70% threshold
 *
 * @param audiobook - Audible audiobook to match
 * @returns Matched Plex library item or null
 */
export async function findPlexMatch(
  audiobook: AudiobookMatchInput
): Promise<AudiobookMatchResult | null> {
  // Query plex_library for potential matches
  // IMPORTANT: Search by TITLE ONLY (not author) because Plex often has narrator as author
  const titleSearchLength = Math.min(20, audiobook.title.length);
  const plexBooks = await prisma.plexLibrary.findMany({
    where: {
      title: {
        contains: audiobook.title.substring(0, titleSearchLength),
        mode: 'insensitive',
      },
    },
    select: {
      plexGuid: true,
      title: true,
      author: true,
    },
    take: 20,
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

  // If no candidates found, log and return null
  if (plexBooks.length === 0) {
    matchResult.matchType = 'no_candidates';
    if (DEBUG_ENABLED) console.log(JSON.stringify({ MATCHER: matchResult }));
    return null;
  }

  // PRIORITY 1: Check for EXACT ASIN match in plexGuid
  for (const plexBook of plexBooks) {
    if (plexBook.plexGuid && plexBook.plexGuid.includes(audiobook.asin)) {
      matchResult.matchType = 'asin_exact';
      matchResult.matched = true;
      matchResult.result = {
        plexGuid: plexBook.plexGuid,
        plexTitle: plexBook.title,
        plexAuthor: plexBook.author,
        confidence: 100,
      };
      if (DEBUG_ENABLED) console.log(JSON.stringify({ MATCHER: matchResult }));
      return plexBook;
    }
  }

  // FILTER OUT candidates with wrong ASINs in plexGuid
  const ASIN_PATTERN = /[A-Z0-9]{10}/g;
  const rejectedAsins: string[] = [];
  const validCandidates = plexBooks.filter((plexBook) => {
    if (!plexBook.plexGuid) return true;
    const asinsInGuid = plexBook.plexGuid.match(ASIN_PATTERN);
    if (!asinsInGuid || asinsInGuid.length === 0) return true;

    const hasOurAsin = asinsInGuid.some(asin => asin === audiobook.asin);
    const hasOtherAsins = asinsInGuid.some(asin => asin !== audiobook.asin);

    if (hasOtherAsins && !hasOurAsin) {
      rejectedAsins.push(...asinsInGuid);
      return false;
    }
    return true;
  });

  matchResult.asinFiltering = {
    beforeCount: plexBooks.length,
    afterCount: validCandidates.length,
    rejectedAsins: rejectedAsins.length > 0 ? rejectedAsins : undefined,
  };

  if (validCandidates.length === 0) {
    matchResult.matchType = 'asin_filtered_all';
    if (DEBUG_ENABLED) console.log(JSON.stringify({ MATCHER: matchResult }));
    return null;
  }

  // Normalize the Audible title
  const normalizedAudibleTitle = normalizeTitle(audiobook.title);

  // PRIORITY 2: Perform fuzzy matching
  const candidates = validCandidates.map((plexBook) => {
    const normalizedPlexTitle = normalizeTitle(plexBook.title);
    const titleScore = compareTwoStrings(normalizedAudibleTitle, normalizedPlexTitle);
    const authorScore = compareTwoStrings(
      audiobook.author.toLowerCase(),
      plexBook.author.toLowerCase()
    );

    let narratorScore = 0;
    let usedNarratorMatch = false;
    if (audiobook.narrator) {
      narratorScore = compareTwoStrings(
        audiobook.narrator.toLowerCase(),
        plexBook.author.toLowerCase()
      );
      usedNarratorMatch = narratorScore > authorScore;
    }

    const personScore = usedNarratorMatch ? narratorScore : authorScore;
    const overallScore = titleScore * 0.7 + personScore * 0.3;

    return {
      plexBook,
      titleScore,
      authorScore,
      narratorScore,
      usedNarratorMatch,
      score: overallScore
    };
  });

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);
  const bestMatch = candidates[0];

  // Add best match details to result
  matchResult.bestCandidate = {
    plexTitle: bestMatch.plexBook.title,
    plexAuthor: bestMatch.plexBook.author,
    plexGuid: bestMatch.plexBook.plexGuid,
    scores: {
      title: Math.round(bestMatch.titleScore * 100),
      author: Math.round(bestMatch.authorScore * 100),
      narrator: audiobook.narrator ? Math.round(bestMatch.narratorScore * 100) : null,
      usedMatch: bestMatch.usedNarratorMatch ? 'narrator' : 'author',
      overall: Math.round(bestMatch.score * 100),
    },
    threshold: 70,
  };

  // Accept match if score >= 70%
  if (bestMatch && bestMatch.score >= 0.7) {
    matchResult.matchType = 'fuzzy';
    matchResult.matched = true;
    matchResult.result = {
      plexGuid: bestMatch.plexBook.plexGuid,
      plexTitle: bestMatch.plexBook.title,
      plexAuthor: bestMatch.plexBook.author,
      confidence: Math.round(bestMatch.score * 100),
    };
    if (DEBUG_ENABLED) console.log(JSON.stringify({ MATCHER: matchResult }));
    return bestMatch.plexBook;
  }

  // No match found
  matchResult.matchType = 'fuzzy_below_threshold';
  if (DEBUG_ENABLED) console.log(JSON.stringify({ MATCHER: matchResult }));
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
  const results = await Promise.all(audiobooks.map((book) => enrichAudiobookWithMatch(book)));

  // Always enrich with request status (check ANY user's requests)
  const asins = audiobooks.map(book => book.asin);

  // Get all audiobook records for these ASINs with ALL requests
  const audiobookRecords = await prisma.audiobook.findMany({
    where: {
      audibleAsin: { in: asins },
    },
    select: {
      id: true,
      audibleAsin: true,
      requests: {
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

  if (DEBUG_ENABLED) {
    const summary = {
      total: results.length,
      available: results.filter(r => r.isAvailable).length,
      notAvailable: results.filter(r => !r.isAvailable).length,
      requested: userId ? results.filter(r => (r as any).isRequested).length : 'N/A',
    };
    console.log(JSON.stringify({ MATCHER_BATCH_SUMMARY: summary }));
  }

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
 * Matching priority:
 * 1. Exact ASIN match (100% confidence)
 * 2. Exact ISBN match (95% confidence)
 * 3. Fuzzy title/author match (70%+ threshold)
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
      if (DEBUG_ENABLED) {
        console.log(JSON.stringify({
          GENERIC_MATCHER: {
            matchType: 'asin_exact',
            input: { title: request.title, asin: request.asin },
            matched: { title: asinMatch.title, asin: asinMatch.asin },
            confidence: 100
          }
        }));
      }
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
      if (DEBUG_ENABLED) {
        console.log(JSON.stringify({
          GENERIC_MATCHER: {
            matchType: 'isbn_exact',
            input: { title: request.title, isbn: request.isbn },
            matched: { title: isbnMatch.title, isbn: isbnMatch.isbn },
            confidence: 95
          }
        }));
      }
      return isbnMatch;
    }
  }

  // 3. Fuzzy title/author match
  const normalizedRequestTitle = normalizeTitle(request.title);
  const normalizedRequestAuthor = request.author.toLowerCase();

  const candidates = libraryItems.map(item => {
    const normalizedItemTitle = normalizeTitle(item.title);
    const normalizedItemAuthor = item.author.toLowerCase();

    const titleScore = compareTwoStrings(normalizedRequestTitle, normalizedItemTitle);
    const authorScore = compareTwoStrings(normalizedRequestAuthor, normalizedItemAuthor);

    // Weighted average: title is more important
    const overallScore = titleScore * 0.7 + authorScore * 0.3;

    return { item, titleScore, authorScore, score: overallScore };
  });

  // Sort by score and get best match
  candidates.sort((a, b) => b.score - a.score);
  const bestMatch = candidates[0];

  // Accept if score >= 70%
  if (bestMatch && bestMatch.score >= 0.7) {
    if (DEBUG_ENABLED) {
      console.log(JSON.stringify({
        GENERIC_MATCHER: {
          matchType: 'fuzzy',
          input: { title: request.title, author: request.author },
          matched: { title: bestMatch.item.title, author: bestMatch.item.author },
          scores: {
            title: Math.round(bestMatch.titleScore * 100),
            author: Math.round(bestMatch.authorScore * 100),
            overall: Math.round(bestMatch.score * 100)
          },
          confidence: Math.round(bestMatch.score * 100)
        }
      }));
    }
    return bestMatch.item;
  }

  // No match found
  if (DEBUG_ENABLED) {
    console.log(JSON.stringify({
      GENERIC_MATCHER: {
        matchType: 'no_match',
        input: { title: request.title, author: request.author },
        bestScore: bestMatch ? Math.round(bestMatch.score * 100) : 0,
        threshold: 70
      }
    }));
  }

  return null;
}
