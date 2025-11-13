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
  console.log('\n🔍 [MATCHER] Starting match for:', {
    title: audiobook.title,
    author: audiobook.author,
    asin: audiobook.asin,
  });

  // Query plex_library for potential matches
  // IMPORTANT: Search by TITLE ONLY (not author) because Plex often has narrator as author
  // We'll validate the author match during fuzzy matching or rely on ASIN matching
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
    take: 20, // Increased to 20 to handle more candidates (since we removed author filter)
  });

  console.log(`   📊 Found ${plexBooks.length} candidate(s) in Plex library (title-based search)`);

  // If no candidates found, return null
  if (plexBooks.length === 0) {
    console.log('   ❌ No candidates found - not in Plex library');
    return null;
  }

  // PRIORITY 1: Check for EXACT ASIN match in plexGuid
  // Many Plex agents (especially Audnexus) embed the ASIN in the GUID
  // Example: com.plexapp.agents.audnexus://B08G9PRS1K_us?lang=en
  console.log('   🎯 Checking for ASIN in plexGuid...');
  for (const plexBook of plexBooks) {
    if (plexBook.plexGuid && plexBook.plexGuid.includes(audiobook.asin)) {
      console.log('   ✅ EXACT ASIN MATCH IN PLEX GUID:', {
        plexTitle: plexBook.title,
        plexAuthor: plexBook.author,
        plexGuid: plexBook.plexGuid,
        asin: audiobook.asin,
        confidence: '100%',
        note: plexBook.author !== audiobook.author
          ? `Author mismatch (Plex: "${plexBook.author}" vs Audible: "${audiobook.author}") but ASIN is definitive`
          : undefined,
      });
      return plexBook;
    }
  }

  console.log('   📝 No ASIN found in plexGuids, falling back to fuzzy matching...');

  // Normalize the Audible title once for all comparisons
  const normalizedAudibleTitle = normalizeTitle(audiobook.title);
  console.log(`   🔤 Normalized Audible title: "${audiobook.title}" → "${normalizedAudibleTitle}"`);

  // PRIORITY 2: Perform fuzzy matching on candidates with normalized titles
  const candidates = plexBooks.map((plexBook) => {
    // Normalize Plex title for fair comparison
    const normalizedPlexTitle = normalizeTitle(plexBook.title);

    const titleScore = compareTwoStrings(
      normalizedAudibleTitle,
      normalizedPlexTitle
    );
    const authorScore = compareTwoStrings(
      audiobook.author.toLowerCase(),
      plexBook.author.toLowerCase()
    );

    // Weighted score: 70% title, 30% author
    const overallScore = titleScore * 0.7 + authorScore * 0.3;

    console.log('      📝 Candidate:', {
      plexTitle: plexBook.title,
      normalizedPlexTitle: normalizedPlexTitle,
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

  // Adaptive threshold based on author match quality
  // If author match is poor (< 30%), require higher overall score to avoid false positives
  // This handles cases like different editions (Full-Cast vs single narrator)
  const requiresHigherThreshold = bestMatch.authorScore < 0.3;
  const threshold = requiresHigherThreshold ? 0.8 : 0.7;
  const thresholdReason = requiresHigherThreshold
    ? 'poor author match (<30%), requiring 80%'
    : 'standard 70%';

  console.log(`   🏆 Best match score: ${(bestMatch.score * 100).toFixed(1)}% (threshold: ${thresholdReason})`);

  // Accept match if score >= threshold
  if (bestMatch && bestMatch.score >= threshold) {
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
  console.log(`   ❌ MATCH REJECTED - Best score ${(bestMatch.score * 100).toFixed(1)}% below ${(threshold * 100).toFixed(0)}% threshold (${thresholdReason})`);
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
