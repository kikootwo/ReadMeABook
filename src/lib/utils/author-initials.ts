/**
 * Component: Author Initials Matching (ranking author gate helper)
 * Documentation: documentation/phase3/ranking-algorithm.md
 */

const SINGLE_LETTER = /^[a-z]$/;

/**
 * Join runs of two or more single letters into one token so spaced and
 * compacted initials compare equal. Input must already be normalized
 * (lowercased, punctuation turned into spaces).
 *   "t j klune"         -> "tj klune"
 *   "george r r martin" -> "george rr martin"
 *   "book 1 t j klune"  -> "book 1 tj klune"  (digits never join)
 *   "j smith"           -> "j smith"          (a lone letter stays as it is)
 */
export function collapseInitials(text: string): string {
  const out: string[] = [];
  let run: string[] = [];

  const flush = () => {
    if (run.length >= 2) {
      out.push(run.join(''));
    } else {
      out.push(...run);
    }
    run = [];
  };

  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    if (SINGLE_LETTER.test(word)) {
      run.push(word);
      continue;
    }
    flush();
    out.push(word);
  }
  flush();

  return out.join(' ');
}

/**
 * True when the author appears in the title as whole words once initials are
 * collapsed on both sides: "tj klune" matches "olive juice by t j klune", but
 * "el james" does not match "michael james".
 */
export function matchesByInitials(normalizedTitle: string, normalizedAuthor: string): boolean {
  const author = collapseInitials(normalizedAuthor);
  if (!author) return false;
  return ` ${collapseInitials(normalizedTitle)} `.includes(` ${author} `);
}
