/**
 * Component: Shelf Helpers
 * Documentation: documentation/frontend/components.md
 */

/**
 * Parse a JSON string of cover/book data into a typed array.
 * Returns an empty array on parse failure (graceful degradation).
 */
export function processBooks(
  coverUrls: string | null,
): { coverUrl: string; asin: string | null; title: string; author: string }[] {
  if (!coverUrls) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(coverUrls);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  return parsed.map((item: unknown) => {
    if (typeof item === 'string') {
      return { coverUrl: item, asin: null, title: '', author: '' };
    }
    const obj = item as Record<string, unknown>;
    return {
      coverUrl: (obj.coverUrl as string) || '',
      asin: (obj.asin as string) || null,
      title: (obj.title as string) || '',
      author: (obj.author as string) || '',
    };
  });
}
