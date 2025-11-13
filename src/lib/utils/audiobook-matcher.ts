/**
 * Component: Audiobook Matching Utility
 * Documentation: documentation/integrations/audible.md
 *
 * Shared utility for matching Audible audiobooks to database records.
 * Used by: search API, popular API, new-releases API, and scheduler service.
 */

import { prisma } from '@/lib/db';
import { compareTwoStrings } from 'string-similarity';

export interface AudiobookMatchInput {
  asin: string;
  title: string;
  author: string;
}

export interface AudiobookMatchResult {
  id: string;
  audibleId: string | null;
  title: string;
  author: string;
  availabilityStatus: string;
  plexGuid: string | null;
}

/**
 * Find a matching audiobook in the database for a given Audible audiobook.
 *
 * Matching logic:
 * 1. Try exact ASIN match first
 * 2. Query database for fuzzy candidates (substring match on title/author)
 * 3. Perform fuzzy matching with 70% threshold
 * 4. Return best match or null
 *
 * @param audiobook - Audible audiobook to match
 * @returns Matched database audiobook or null
 */
export async function findAudiobookMatch(
  audiobook: AudiobookMatchInput
): Promise<AudiobookMatchResult | null> {
  console.log('\n🔍 [MATCHER] Starting match for:', {
    title: audiobook.title,
    author: audiobook.author,
    asin: audiobook.asin,
  });

  // Query database for potential matches
  // This matches ANY audiobook (not just ones with availabilityStatus='available')
  const dbAudiobooks = await prisma.audiobook.findMany({
    where: {
      OR: [
        // Exact ASIN match
        { audibleId: audiobook.asin },
        // Fuzzy match by title/author substring (narrows down candidates)
        {
          AND: [
            { title: { contains: audiobook.title.substring(0, 20), mode: 'insensitive' } },
            { author: { contains: audiobook.author.substring(0, 20), mode: 'insensitive' } },
          ],
        },
      ],
    },
    select: {
      id: true,
      audibleId: true,
      title: true,
      author: true,
      availabilityStatus: true,
      plexGuid: true,
    },
    take: 5, // Limit to top 5 candidates for performance
  });

  console.log(`   📊 Found ${dbAudiobooks.length} candidate(s) in database`);

  // If no candidates found, return null
  if (dbAudiobooks.length === 0) {
    console.log('   ❌ No candidates found - no match');
    return null;
  }

  // If exact match by ASIN, use it immediately
  const exactMatch = dbAudiobooks.find((db) => db.audibleId === audiobook.asin);
  if (exactMatch) {
    console.log('   ✅ EXACT ASIN MATCH found:', {
      dbTitle: exactMatch.title,
      dbAuthor: exactMatch.author,
      plexGuid: exactMatch.plexGuid,
      availabilityStatus: exactMatch.availabilityStatus,
    });
    return exactMatch;
  }

  console.log('   🔢 No exact ASIN match, performing fuzzy matching...');

  // Otherwise, perform fuzzy matching on candidates
  const candidates = dbAudiobooks.map((dbBook) => {
    const titleScore = compareTwoStrings(
      audiobook.title.toLowerCase(),
      dbBook.title.toLowerCase()
    );
    const authorScore = compareTwoStrings(
      audiobook.author.toLowerCase(),
      dbBook.author.toLowerCase()
    );

    // Weighted score: 70% title, 30% author
    const overallScore = titleScore * 0.7 + authorScore * 0.3;

    console.log('      📝 Candidate:', {
      dbTitle: dbBook.title,
      dbAuthor: dbBook.author,
      titleScore: `${(titleScore * 100).toFixed(1)}%`,
      authorScore: `${(authorScore * 100).toFixed(1)}%`,
      overallScore: `${(overallScore * 100).toFixed(1)}%`,
      plexGuid: dbBook.plexGuid,
      availabilityStatus: dbBook.availabilityStatus,
    });

    return { dbBook, titleScore, authorScore, score: overallScore };
  });

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);
  const bestMatch = candidates[0];

  console.log(`   🏆 Best match score: ${(bestMatch.score * 100).toFixed(1)}% (threshold: 70%)`);

  // Accept match if score >= 70%
  if (bestMatch && bestMatch.score >= 0.7) {
    console.log('   ✅ MATCH ACCEPTED:', {
      dbTitle: bestMatch.dbBook.title,
      dbAuthor: bestMatch.dbBook.author,
      titleMatch: `${(bestMatch.titleScore * 100).toFixed(1)}%`,
      authorMatch: `${(bestMatch.authorScore * 100).toFixed(1)}%`,
      overallScore: `${(bestMatch.score * 100).toFixed(1)}%`,
      plexGuid: bestMatch.dbBook.plexGuid,
      availabilityStatus: bestMatch.dbBook.availabilityStatus,
    });
    return bestMatch.dbBook;
  }

  // No match found
  console.log(`   ❌ MATCH REJECTED - Best score ${(bestMatch.score * 100).toFixed(1)}% below 70% threshold`);
  return null;
}

/**
 * Enrich an Audible audiobook with database match information.
 * Used by API routes to add availability status to responses.
 */
export async function enrichAudiobookWithMatch(audiobook: AudiobookMatchInput & Record<string, any>) {
  const match = await findAudiobookMatch(audiobook);

  const enriched = {
    ...audiobook,
    availabilityStatus: match?.availabilityStatus || 'unknown',
    isAvailable: match?.availabilityStatus === 'available',
    plexGuid: match?.plexGuid || null,
    dbId: match?.id || null,
  };

  console.log(`   📦 Enriched result: availabilityStatus="${enriched.availabilityStatus}", isAvailable=${enriched.isAvailable}, plexGuid=${enriched.plexGuid ? 'YES' : 'NO'}\n`);

  return enriched;
}

/**
 * Batch enrich multiple audiobooks with match information.
 * Processes in parallel for better performance.
 */
export async function enrichAudiobooksWithMatches(
  audiobooks: Array<AudiobookMatchInput & Record<string, any>>
) {
  console.log(`\n🔄 [MATCHER BATCH] Starting batch enrichment for ${audiobooks.length} audiobook(s)...`);

  const results = await Promise.all(audiobooks.map((book) => enrichAudiobookWithMatch(book)));

  const summary = {
    total: results.length,
    available: results.filter(r => r.isAvailable).length,
    unknown: results.filter(r => r.availabilityStatus === 'unknown').length,
    requested: results.filter(r => r.availabilityStatus === 'requested').length,
  };

  console.log('📊 [MATCHER BATCH] Summary:', summary);
  console.log('─'.repeat(80) + '\n');

  return results;
}
