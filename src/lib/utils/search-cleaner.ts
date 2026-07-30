/**
 * Component: Search Cleaner and Metadata Normalizer Utility
 * 
 * Cleans titles (stripping parenthetical/bracketed edition tags like "(Dramatized Adaptation)", "[Unabridged]")
 * and extracts primary authors for indexer queries.
 */

/**
 * Strips edition tags, parenthetical suffixes, and graphic audio tags from titles
 */
export function cleanTitle(title: string): string {
  if (!title) return '';

  return title
    .replace(/\s*\([^)]*(?:dramatized|unabridged|abridged|edition|full-cast|graphic|audiobook|anniversary|dramatised)[^)]*\)/gi, '')
    .replace(/\s*\[[^\]]*(?:dramatized|unabridged|abridged|edition|full-cast|graphic|audiobook|anniversary|dramatised)[^\]]*\]/gi, '')
    .replace(/\s*-\s*(?:dramatized|unabridged|abridged|graphic audio|full-cast).*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts primary author string before commas, "and", or "&"
 */
export function extractPrimaryAuthor(author: string): string {
  if (!author) return '';

  const first = author.split(/,| and | & /i)[0];
  return first ? first.trim() : author.trim();
}
