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
  console.log('\n🔍 [MATCHER] Starting match for:', {
    title: audiobook.title,
    author: audiobook.author,
    narrator: audiobook.narrator || 'N/A',
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

  // FILTER OUT candidates with wrong ASINs in plexGuid
  // If a plexGuid contains an ASIN pattern but it's NOT our ASIN, it's definitely wrong
  const ASIN_PATTERN = /[A-Z0-9]{10}/g;
  const validCandidates = plexBooks.filter((plexBook) => {
    if (!plexBook.plexGuid) return true; // No GUID, can't rule out

    const asinsInGuid = plexBook.plexGuid.match(ASIN_PATTERN);
    if (!asinsInGuid || asinsInGuid.length === 0) return true; // No ASIN in GUID

    // If GUID has ASINs but none match ours, reject this candidate
    const hasOurAsin = asinsInGuid.some(asin => asin === audiobook.asin);
    const hasOtherAsins = asinsInGuid.some(asin => asin !== audiobook.asin);

    if (hasOtherAsins && !hasOurAsin) {
      console.log(`      ❌ Rejecting candidate - plexGuid contains different ASIN: ${asinsInGuid.join(', ')}`);
      return false;
    }

    return true;
  });

  console.log(`   🔍 After ASIN filtering: ${validCandidates.length} of ${plexBooks.length} candidates remain`);

  if (validCandidates.length === 0) {
    console.log('   ❌ No valid candidates after ASIN filtering');
    return null;
  }

  // Normalize the Audible title once for all comparisons
  const normalizedAudibleTitle = normalizeTitle(audiobook.title);
  console.log(`   🔤 Normalized Audible title: "${audiobook.title}" → "${normalizedAudibleTitle}"`);

  // PRIORITY 2: Perform fuzzy matching on candidates with normalized titles
  const candidates = validCandidates.map((plexBook) => {
    // Normalize Plex title for fair comparison
    const normalizedPlexTitle = normalizeTitle(plexBook.title);

    const titleScore = compareTwoStrings(
      normalizedAudibleTitle,
      normalizedPlexTitle
    );

    // Try matching both author and narrator (if available), take the better score
    // This handles cases where Plex has narrator as author
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

    // Weighted score: 70% title, 30% person (author or narrator, whichever matches better)
    const overallScore = titleScore * 0.7 + personScore * 0.3;

    console.log('      📝 Candidate:', {
      plexTitle: plexBook.title,
      normalizedPlexTitle: normalizedPlexTitle,
      plexAuthor: plexBook.author,
      titleScore: `${(titleScore * 100).toFixed(1)}%`,
      authorScore: `${(authorScore * 100).toFixed(1)}%`,
      narratorScore: audiobook.narrator ? `${(narratorScore * 100).toFixed(1)}%` : 'N/A',
      usedMatch: usedNarratorMatch ? 'narrator' : 'author',
      overallScore: `${(overallScore * 100).toFixed(1)}%`,
      plexGuid: plexBook.plexGuid,
    });

    return { plexBook, titleScore, authorScore, narratorScore, usedNarratorMatch, score: overallScore };
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
      narratorMatch: audiobook.narrator ? `${(bestMatch.narratorScore * 100).toFixed(1)}%` : 'N/A',
      usedMatch: bestMatch.usedNarratorMatch ? 'narrator' : 'author',
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
