/**
 * Component: HTML to Plain Text (book summaries)
 * Documentation: documentation/integrations/audible.md
 *
 * Turns a publisher/Audnexus HTML summary into plain text that keeps its paragraph
 * and line breaks. The result is shown as text, never rendered as HTML.
 */

const NAMED_ENTITIES: Record<string, string> = {
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
};

function decodeCodePoint(raw: string, radix: 10 | 16): string | null {
  const codePoint = parseInt(raw, radix);
  if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return null;
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) return null; // lone surrogate
  return String.fromCodePoint(codePoint);
}

/** Decode named and numeric entities. &amp; is decoded last so "&amp;lt;" becomes "&lt;", not "<". */
function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (match, digits: string) => decodeCodePoint(digits, 10) ?? match)
    .replace(/&#x([0-9a-f]+);/gi, (match, hex: string) => decodeCodePoint(hex, 16) ?? match)
    .replace(/&(quot|apos|lt|gt|nbsp);/g, (_match, name: string) => NAMED_ENTITIES[name])
    .replace(/&amp;/g, '&');
}

/**
 * HTML → plain text:
 * 1. collapse source whitespace (newlines in the HTML carry no meaning)
 * 2. `<br>` → line break, `</p>` → blank line (case-insensitive)
 * 3. strip all remaining tags
 * 4. decode entities (`&amp;` last)
 * 5. trim each line; at most one blank line between paragraphs
 */
export function stripHtml(html: string): string {
  const withBreaks = html
    .replace(/\s+/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n\n')
    .replace(/<[^>]*>/g, '');

  return decodeEntities(withBreaks)
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
