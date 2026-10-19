/**
 * Component: HTML to Plain Text (book summaries)
 * Documentation: documentation/integrations/audible.md
 *
 * Turns a publisher/Audnexus HTML summary into plain text that keeps its paragraph,
 * line and list structure. The result is shown as text, never rendered as HTML.
 * Every regex here is linear-time on any input (no nested or lazy-to-end scans).
 */

/** Named entities seen in book summaries (accented letters also get capitalised forms below) */
const BASE_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„',
  laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›',
  ndash: '–', mdash: '—', hellip: '…', bull: '•', middot: '·', prime: '′', Prime: '″',
  copy: '©', reg: '®', trade: '™', deg: '°', sect: '§', para: '¶', dagger: '†', Dagger: '‡',
  iexcl: '¡', iquest: '¿', times: '×', divide: '÷', frac12: '½', frac14: '¼', frac34: '¾',
  euro: '€', pound: '£', yen: '¥', cent: '¢', szlig: 'ß',
};

const ACCENTED_LETTERS: Record<string, string> = {
  aacute: 'á', agrave: 'à', acirc: 'â', auml: 'ä', atilde: 'ã', aring: 'å', aelig: 'æ',
  ccedil: 'ç', eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë',
  iacute: 'í', igrave: 'ì', icirc: 'î', iuml: 'ï', ntilde: 'ñ',
  oacute: 'ó', ograve: 'ò', ocirc: 'ô', ouml: 'ö', otilde: 'õ', oslash: 'ø', oelig: 'œ',
  uacute: 'ú', ugrave: 'ù', ucirc: 'û', uuml: 'ü', yacute: 'ý', yuml: 'ÿ',
};

const NAMED_ENTITIES: Record<string, string> = { ...BASE_ENTITIES, ...ACCENTED_LETTERS };
for (const [name, letter] of Object.entries(ACCENTED_LETTERS)) {
  NAMED_ENTITIES[name[0].toUpperCase() + name.slice(1)] = letter.toUpperCase(); // &Eacute; → É
}

const ENTITY = /&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi;

// Internal break markers (control characters, removed from the input first)
const BLOCK = '\u0001';
const PARAGRAPH = '\u0002';
const MARKERS = /[\u0001\u0002]/g;
const MARKER_RUN = /[\u0001\u0002][\u0001\u0002 ]*/g;

function decodeCodePoint(raw: string, radix: 10 | 16): string | null {
  const codePoint = parseInt(raw, radix);
  if (!Number.isFinite(codePoint) || codePoint > 0x10ffff) return null;
  if (codePoint < 0x20 && codePoint !== 0x09 && codePoint !== 0x0a) return null; // control characters
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) return null; // lone surrogate
  return String.fromCodePoint(codePoint);
}

/** Decode entities in ONE pass, so a decoded "&" never starts another entity (&amp;lt; → "&lt;"). */
function decodeEntities(text: string): string {
  return text.replace(ENTITY, (match, body: string) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X';
      return decodeCodePoint(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10) ?? match;
    }
    return NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()] ?? match; // exact case first (É vs é)
  });
}

/** Remove <tag ...>...</tag> blocks (script/style). An unclosed block drops the rest. Linear scan. */
function removeBlocks(html: string, tag: string): string {
  const open = new RegExp(`<${tag}\\b[^<>]*>`, 'gi');
  const close = new RegExp(`</${tag}\\s*>`, 'gi');
  let result = '';
  let position = 0;
  for (;;) {
    open.lastIndex = position;
    const start = open.exec(html);
    if (!start) return result + html.slice(position);
    result += html.slice(position, start.index);
    close.lastIndex = open.lastIndex;
    const end = close.exec(html);
    if (!end) return result;
    position = close.lastIndex;
  }
}

/**
 * HTML → plain text:
 * 1. drop <script>/<style> blocks; collapse source whitespace (HTML newlines carry no meaning)
 * 2. structure → text: `<br>` line break, `</p>` blank line; `<p>`, `<hr>`, block tags
 *    (div, h1-h6, ul, ol, blockquote, and their closers, `</li>`) line breaks; `<li>` "• "
 * 3. strip remaining tags
 * 4. decode entities in one pass (numeric, common named; case-insensitive names)
 * 5. per line: collapse spaces/tabs/nbsp, trim; at most one blank line between paragraphs
 */
export function stripHtml(html: string): string {
  // Block tags emit BLOCK, </p> emits PARAGRAPH; a run of markers becomes one line break,
  // or one blank line if it holds a paragraph end ("</li><li>" is not a blank line)
  const structured = removeBlocks(removeBlocks(html.replace(MARKERS, ''), 'script'), 'style')
    .replace(/\s+/g, ' ')
    .replace(/<br\b[^<>]*>/gi, '\n')
    .replace(/<\/p\s*>/gi, PARAGRAPH)
    .replace(/<(?:p|hr)\b[^<>]*>/gi, BLOCK)
    .replace(/<\/?(?:div|h[1-6]|ul|ol|blockquote)\b[^<>]*>/gi, BLOCK)
    .replace(/<\/li\s*>/gi, BLOCK)
    .replace(/<li\b[^<>]*>/gi, `${BLOCK}• `)
    .replace(/<[^<>]*>/g, '')
    .replace(MARKER_RUN, (run) => (run.includes(PARAGRAPH) ? '\n\n' : '\n'));

  return decodeEntities(structured)
    .split('\n')
    .map((line) => line.replace(/[ \t\r\f\v ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
