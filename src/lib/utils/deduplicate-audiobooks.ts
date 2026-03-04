/**
 * Component: Audiobook Deduplication Utility
 * Documentation: documentation/integrations/audible.md
 *
 * Deduplicates audiobook listings that represent the same recording
 * under different ASINs (publisher re-listings, rights transfers, etc.).
 *
 * Dedup key: normalized title + normalized narrator
 * Duration tolerance: max(longerDuration * 0.01, 5) minutes
 * Missing duration treated as compatible (graceful degradation).
 */

import type { AudibleAudiobook } from '../integrations/audible.service';

// ---------------------------------------------------------------------------
// Title / narrator normalization
// ---------------------------------------------------------------------------

/** Patterns in parentheses or brackets to strip (edition markers, format labels) */
const EDITION_PAREN_RE = /[([][^)\]]*?(?:unabridged|abridged|edition|remaster(?:ed)?|anniversary|complete|original|version|narrat(?:ed|or)?|audio(?:book)?|full cast|dramatiz(?:ed|ation))[^)\]]*[)\]]/gi;

/** Trailing subtitle after colon or long dash */
const SUBTITLE_RE = /\s*[:]\s+.+$/;
const LONG_DASH_SUBTITLE_RE = /\s+[-\u2013\u2014]\s+.+$/;

/** Trailing descriptors like "A Novel", "A Memoir" */
const TRAILING_DESCRIPTOR_RE = /\s*[-:,]?\s+a\s+(novel|memoir|thriller|mystery|romance|story|tale|novella)\s*$/i;

/**
 * Normalize a title for dedup comparison.
 * Strips subtitles, edition markers, and trailing descriptors.
 */
export function normalizeTitle(title: string): string {
  let t = title.toLowerCase();
  // Remove parenthesized/bracketed edition markers
  t = t.replace(EDITION_PAREN_RE, '');
  // Remove trailing descriptors before subtitle stripping
  t = t.replace(TRAILING_DESCRIPTOR_RE, '');
  // Remove subtitle after colon
  t = t.replace(SUBTITLE_RE, '');
  // Remove subtitle after long dash (but not short hyphenated words)
  t = t.replace(LONG_DASH_SUBTITLE_RE, '');
  // Collapse whitespace and trim
  return t.replace(/\s+/g, ' ').trim();
}

/** Normalize narrator for comparison. Sorts individual names so order doesn't matter. */
function normalizeNarrator(narrator?: string): string {
  const raw = (narrator || '').toLowerCase().trim();
  if (!raw) return raw;
  return raw.split(',').map(n => n.trim()).filter(Boolean).sort().join(', ');
}

// ---------------------------------------------------------------------------
// Duration compatibility
// ---------------------------------------------------------------------------

/**
 * Check if two durations are compatible (represent the same recording).
 * Tolerance: max(longerDuration * 0.01, 5) minutes.
 * Missing duration on either side is treated as compatible.
 */
export function areDurationsCompatible(a?: number, b?: number): boolean {
  if (a == null || b == null) return true;
  const longer = Math.max(a, b);
  const tolerance = Math.max(longer * 0.01, 5);
  return Math.abs(a - b) <= tolerance;
}

// ---------------------------------------------------------------------------
// Metadata scoring (for picking best representative)
// ---------------------------------------------------------------------------

function metadataScore(book: AudibleAudiobook): number {
  let score = 0;
  if (book.coverArtUrl) score++;
  if (book.rating != null) score++;
  if (book.durationMinutes != null) score++;
  if (book.description) score++;
  if (book.narrator) score++;
  if (book.releaseDate) score++;
  if (book.genres && book.genres.length > 0) score++;
  return score;
}

// ---------------------------------------------------------------------------
// Dedup group types (for works-table persistence)
// ---------------------------------------------------------------------------

/** Metadata about a group of ASINs that were collapsed during dedup. */
export interface DedupGroup {
  canonicalAsin: string;     // ASIN of the "winner" (best metadata score)
  allAsins: string[];        // All ASINs in this group (including canonical)
  title: string;             // Author from the canonical entry
  author: string;            // Author from the canonical entry
  narrator?: string;         // Narrator from the canonical entry
  durationMinutes?: number;  // Duration from the canonical entry
}

/** Result of deduplication with group collection. */
export interface DeduplicateResult {
  books: AudibleAudiobook[];  // The deduped list (same as deduplicateAudiobooks returns)
  groups: DedupGroup[];       // Groups where 2+ ASINs were collapsed
}

// ---------------------------------------------------------------------------
// Main dedup functions
// ---------------------------------------------------------------------------

/**
 * Deduplicate audiobook listings by normalized title + narrator + duration.
 *
 * Same narrator + compatible duration + similar title = same recording -> collapse.
 * Different narrator = different production -> keep both.
 * Duration outside tolerance = different content (abridged vs unabridged) -> keep both.
 *
 * Preserves original ordering (position of first appearance).
 */
export function deduplicateAudiobooks(books: AudibleAudiobook[]): AudibleAudiobook[] {
  return deduplicateAndCollectGroups(books).books;
}

/**
 * Deduplicate audiobooks AND return grouping metadata for works-table persistence.
 * Returns both the deduped list and the groups where 2+ ASINs were collapsed.
 */
export function deduplicateAndCollectGroups(books: AudibleAudiobook[]): DeduplicateResult {
  if (books.length <= 1) return { books: [...books], groups: [] };

  // Group by normalized title + narrator
  const titleNarratorGroups = new Map<string, AudibleAudiobook[]>();
  const insertionOrder: string[] = [];

  for (const book of books) {
    const key = `${normalizeTitle(book.title)}|||${normalizeNarrator(book.narrator)}`;
    const group = titleNarratorGroups.get(key);
    if (group) {
      group.push(book);
    } else {
      titleNarratorGroups.set(key, [book]);
      insertionOrder.push(key);
    }
  }

  const result: AudibleAudiobook[] = [];
  const dedupGroups: DedupGroup[] = [];

  for (const key of insertionOrder) {
    const group = titleNarratorGroups.get(key)!;
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }

    // Within a title+narrator group, further split by duration compatibility.
    // Build sub-groups where all members are duration-compatible with the
    // representative (first member). A book joins the first compatible sub-group.
    const subGroups: AudibleAudiobook[][] = [];

    for (const book of group) {
      let placed = false;
      for (const sg of subGroups) {
        // Check compatibility against the representative (first member)
        if (areDurationsCompatible(sg[0].durationMinutes, book.durationMinutes)) {
          sg.push(book);
          placed = true;
          break;
        }
      }
      if (!placed) {
        subGroups.push([book]);
      }
    }

    // From each sub-group, pick the best representative and collect group metadata
    for (const sg of subGroups) {
      let best = sg[0];
      let bestScore = metadataScore(best);
      for (let i = 1; i < sg.length; i++) {
        const score = metadataScore(sg[i]);
        if (score > bestScore) {
          best = sg[i];
          bestScore = score;
        }
      }
      result.push(best);

      // Collect group metadata for works-table persistence (only multi-ASIN groups)
      if (sg.length >= 2) {
        dedupGroups.push({
          canonicalAsin: best.asin,
          allAsins: sg.map(b => b.asin),
          title: best.title,
          author: best.author,
          narrator: best.narrator,
          durationMinutes: best.durationMinutes,
        });
      }
    }
  }

  return { books: result, groups: dedupGroups };
}
