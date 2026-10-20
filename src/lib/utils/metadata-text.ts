/**
 * Component: Metadata Text Helpers (sanitize, bound and cap tag values; ffmpeg failure text)
 * Documentation: documentation/phase3/file-organization.md
 */

/**
 * Longest description written, in UTF-8 bytes. Each `-metadata` value is one argv
 * string and the OS caps those (~128 KiB on Linux, "Argument list too long");
 * MP4 passes the description twice (description + synopsis).
 */
export const MAX_DESCRIPTION_BYTES = 16 * 1024;

/**
 * Sanitize a metadata value before writing.
 * Conservative — only removes characters that are clearly not intent:
 * - Leading BOM, NBSP, zero-width space, zero-width non-joiner, zero-width joiner
 * - Null bytes, CR, LF anywhere (ffmpeg metadata semantics break on these)
 * - Leading/trailing whitespace
 * Does NOT normalize Unicode forms or otherwise transform content.
 */
export function sanitizeMetadataValue(value: string): string {
  return value
    .replace(/^[﻿ ​‌‍]+/, '') // leading BOM / NBSP / ZWSP / ZWNJ / ZWJ
    .replace(/[\x00\r\n]/g, '') // null bytes and line breaks anywhere
    .trim();
}

/**
 * Longest raw description read, in UTF-16 code units (each at least one UTF-8 byte,
 * so 4x the cap): client text is unbounded, and this bounds the work before any
 * sanitizing or HTML stripping.
 */
export const MAX_RAW_DESCRIPTION_LENGTH = 4 * MAX_DESCRIPTION_BYTES;

/** The first `maxLength` UTF-16 code units of `value`, never ending inside a surrogate pair. */
export function truncateRawText(value: string, maxLength: number = MAX_RAW_DESCRIPTION_LENGTH): string {
  if (value.length <= maxLength) return value;
  let end = Math.max(0, maxLength);
  const last = value.charCodeAt(end - 1);
  if (end > 0 && last >= 0xd800 && last <= 0xdbff) end--; // a high surrogate whose pair is cut off
  return value.slice(0, end);
}

/**
 * Sanitize a multi-paragraph value: C0 control characters other than whitespace are
 * dropped, then every run of whitespace (space, tab, CR, LF, VT, FF, U+2028, U+2029)
 * becomes one space, so paragraphs never run together. Linear in the input.
 */
export function sanitizeMultilineValue(value: string): string {
  return sanitizeMetadataValue(
    value
      .replace(/[\x00-\x08\x0e-\x1f]/g, '')
      .replace(/[ \t\r\n\v\f\u2028\u2029]+/g, ' ')
  );
}

/**
 * A genre name as one part of the joined tag: '/' and ';' (Audiobookshelf's
 * separators) inside it become ' & '. Split and trim, no regex backtracking.
 */
export function sanitizeGenreName(name: string): string {
  return name
    .split(/[/;]/)
    .map((part) => sanitizeMetadataValue(part))
    .filter((part) => part.length > 0)
    .join(' & ');
}

/**
 * Cap `value` at `maxBytes` UTF-8 bytes. A longer value is cut at its last word
 * boundary that fits (never inside a code point) and ends with an ellipsis (left
 * out when `maxBytes` is smaller than the ellipsis).
 */
export function capUtf8Bytes(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  const ellipsisBytes = Buffer.byteLength('\u2026', 'utf8');
  const ellipsis = maxBytes >= ellipsisBytes ? '\u2026' : '';
  const bytes = Buffer.from(value, 'utf8');
  let end = Math.max(0, maxBytes - Buffer.byteLength(ellipsis, 'utf8'));
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--; // back to the start of a code point
  let head = bytes.subarray(0, end).toString('utf8');
  const lastSpace = head.lastIndexOf(' ');
  if (lastSpace >= head.length / 2) head = head.slice(0, lastSpace); // a word boundary, unless it drops half
  return `${head.trimEnd()}${ellipsis}`;
}

/**
 * ffmpeg's failure without its argv (execFile's message starts with the whole
 * command line, description included): the last lines of stderr, else the
 * message without its "Command failed:" line, else the exit or kill reason.
 */
export function describeFfmpegFailure(error: unknown): string {
  if (!(error instanceof Error)) return 'Unknown error';
  const e = error as Error & { stderr?: unknown; killed?: boolean; signal?: unknown; code?: unknown };
  if (e.killed) return `ffmpeg was stopped (${String(e.signal ?? 'timeout')})`;
  const stderr = typeof e.stderr === 'string' ? e.stderr.trim() : '';
  if (stderr) return stderr.split(/\r?\n/).slice(-3).join(' | ').slice(-500);
  const rest = e.message.startsWith('Command failed:') ? e.message.split('\n').slice(1).join(' ').trim() : e.message.trim();
  return rest || (e.code !== undefined ? `exit code ${String(e.code)}` : 'Unknown error');
}
