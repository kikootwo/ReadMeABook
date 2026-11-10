/**
 * Component: ffmpeg stderr tail and failure reason (chapter merge)
 * Documentation: documentation/features/chapter-merging.md
 */

/** Characters of a long ffmpeg run's stderr that are kept (its tail; progress is read per chunk). */
export const FFMPEG_STDERR_TAIL_CHARS = 64 * 1024;
/** A failed run's reason: ffmpeg's newest meaningful lines, at most this many and this long in all. */
export const FFMPEG_ERROR_MAX_LINES = 5;
export const FFMPEG_ERROR_MAX_CHARS = 1000;

/** ffmpeg's stats line (frame=/size=/time=), printed about twice a second and ended by `\r`. */
const STATS_LINE = /^(?:frame|fps|size|time)=|\btime=(?:-?\d+:\d{2}:\d{2}|N\/A)/;
const ERROR_WORDS = /error|invalid|fail|no such|denied|unable|cannot|could not/i;

/** Appends a stderr chunk and keeps the last `limit` characters, from a line start when one is near. */
export function appendStderrTail(tail: string, chunk: string, limit = FFMPEG_STDERR_TAIL_CHARS): string {
  const joined = tail + chunk;
  if (joined.length <= limit) return joined;
  const kept = joined.slice(joined.length - limit);
  const lineEnd = kept.slice(0, 1024).search(/[\r\n]/);
  if (lineEnd >= 0) return kept.slice(lineEnd + 1);
  const first = kept.charCodeAt(0);
  return first >= 0xdc00 && first <= 0xdfff ? kept.slice(1) : kept; // never half of a surrogate pair
}

/** A failed run's reason: ffmpeg's newest error lines (else its newest lines), no stats lines, capped. */
export function ffmpegFailureReason(stderr: string, code: number | null): string {
  const lines = stderr.split(/[\r\n]+/).map((line) => line.trim()).filter((line) => line && !STATS_LINE.test(line));
  const errors = lines.filter((line) => ERROR_WORDS.test(line));
  const picked: string[] = [];
  let length = 0;
  for (const line of (errors.length > 0 ? errors : lines).slice(-FFMPEG_ERROR_MAX_LINES).reverse()) {
    length += line.length + (picked.length > 0 ? 2 : 0);
    if (picked.length > 0 && length > FFMPEG_ERROR_MAX_CHARS) break;
    picked.unshift(line);
  }
  if (picked.length === 0) return `FFmpeg exited with code ${code}`;
  const reason = picked.join('; ');
  if (reason.length <= FFMPEG_ERROR_MAX_CHARS) return reason;
  const cut = reason.slice(0, FFMPEG_ERROR_MAX_CHARS - 3);
  const last = cut.charCodeAt(cut.length - 1);
  return `${last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut}...`;
}
