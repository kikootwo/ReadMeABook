/**
 * Component: Audiobook Matching Utility
 * Documentation: documentation/integrations/audible.md
 *
 * Real-time matching between Audible books and Plex library.
 * Queries plex_library table to determine availability.
 */

import { prisma } from '@/lib/db';
import { compareTwoStrings } from 'string-similarity';

export interface AudiobookMatchInput {
  asin: string;
  title: string;
  author: string;
}

export interface AudiobookMatchResult {
  plexGuid: string;
  title: string;
  author: string;
}

/**
 * Find a matching audiobook in the Plex library for a given Audible audiobook.
 *
 * Matching logic (in order of priority):
 * 1. **ASIN in plexGuid** - Check if any Plex book's GUID contains the Audible ASIN (100% match)
 * 2. **Fuzzy matching** - Title/author string similarity with 70% threshold
 *
 * @param audiobook - Audible audiobook to match
 * @returns Matched Plex library item or null
 */
export async function findPlexMatch(
  audiobook: AudiobookMatchInput
): Promise<AudiobookMatchResult | null> {
  console.log('\n🔍 [MATCHER] Starting match for:', {
    title: audiobook.title,
    author: audiobook.author,
    asin: audiobook.asin,
  });

  // Query plex_library for potential matches using fuzzy substring search
  const plexBooks = await prisma.plexLibrary.findMany({
    where: {
      OR: [
        // Fuzzy match by title/author substring (narrows down candidates)
        {
          AND: [
            { title: { contains: audiobook.title.substring(0, Math.min(20, audiobook.title.length)), mode: 'insensitive' } },
            { author: { contains: audiobook.author.substring(0, Math.min(20, audiobook.author.length)), mode: 'insensitive' } },
          ],
        },
      ],
    },
    select: {
      plexGuid: true,
      title: true,
      author: true,
    },
    take: 10, // Increased from 5 to 10 to catch more potential ASIN matches
  });

  console.log(`   📊 Found ${plexBooks.length} candidate(s) in Plex library`);

  // If no candidates found, return null
  if (plexBooks.length === 0) {
    console.log('   ❌ No candidates found - not in Plex library');
    return null;
  }

  // PRIORITY 1: Check for EXACT ASIN match in plexGuid
  // Many Plex agents (especially Audnexus) embed the ASIN in the GUID
  // Example: com.plexapp.agents.audnexus://B08V8B2CGV_us?lang=en
  console.log('   🎯 Checking for ASIN in plexGuid...');
  for (const plexBook of plexBooks) {
    if (plexBook.plexGuid && plexBook.plexGuid.includes(audiobook.asin)) {
      console.log('   ✅ EXACT ASIN MATCH IN PLEX GUID:', {
        plexTitle: plexBook.title,
        plexAuthor: plexBook.author,
        plexGuid: plexBook.plexGuid,
        asin: audiobook.asin,
        confidence: '100%',
      });
      return plexBook;
    }
  }

  console.log('   📝 No ASIN found in plexGuids, falling back to fuzzy matching...');

  // PRIORITY 2: Perform fuzzy matching on candidates
  const candidates = plexBooks.map((plexBook) => {
    const titleScore = compareTwoStrings(
      audiobook.title.toLowerCase(),
      plexBook.title.toLowerCase()
    );
    const authorScore = compareTwoStrings(
      audiobook.author.toLowerCase(),
      plexBook.author.toLowerCase()
    );

    // Weighted score: 70% title, 30% author
    const overallScore = titleScore * 0.7 + authorScore * 0.3;

    console.log('      📝 Candidate:', {
      plexTitle: plexBook.title,
      plexAuthor: plexBook.author,
      titleScore: `${(titleScore * 100).toFixed(1)}%`,
      authorScore: `${(authorScore * 100).toFixed(1)}%`,
      overallScore: `${(overallScore * 100).toFixed(1)}%`,
      plexGuid: plexBook.plexGuid,
    });

    return { plexBook, titleScore, authorScore, score: overallScore };
  });

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);
  const bestMatch = candidates[0];

  console.log(`   🏆 Best match score: ${(bestMatch.score * 100).toFixed(1)}% (threshold: 70%)`);

  // Accept match if score >= 70%
  if (bestMatch && bestMatch.score >= 0.7) {
    console.log('   ✅ FUZZY MATCH ACCEPTED:', {
      plexTitle: bestMatch.plexBook.title,
      plexAuthor: bestMatch.plexBook.author,
      titleMatch: `${(bestMatch.titleScore * 100).toFixed(1)}%`,
      authorMatch: `${(bestMatch.authorScore * 100).toFixed(1)}%`,
      overallScore: `${(bestMatch.score * 100).toFixed(1)}%`,
      plexGuid: bestMatch.plexBook.plexGuid,
    });
    return bestMatch.plexBook;
  }

  // No match found
  console.log(`   ❌ MATCH REJECTED - Best score ${(bestMatch.score * 100).toFixed(1)}% below 70% threshold`);
  return null;
}

/**
 * Enrich an Audible audiobook with Plex library match information.
 * Used by API routes to add availability status to responses.
 */
export async function enrichAudiobookWithMatch(audiobook: AudiobookMatchInput & Record<string, any>) {
  const match = await findPlexMatch(audiobook);

  const enriched = {
    ...audiobook,
    isAvailable: match !== null,
    plexGuid: match?.plexGuid || null,
  };

  console.log(`   📦 Enriched result: isAvailable=${enriched.isAvailable}, plexGuid=${enriched.plexGuid ? 'YES' : 'NO'}\n`);

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
    notAvailable: results.filter(r => !r.isAvailable).length,
  };

  console.log('📊 [MATCHER BATCH] Summary:', summary);
  console.log('─'.repeat(80) + '\n');

  return results;
}
