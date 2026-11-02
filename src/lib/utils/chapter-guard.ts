/**
 * Component: Tagged Copy Chapter Guard (#511)
 * Documentation: documentation/phase3/file-organization.md
 *
 * ffmpeg 9.x's mov muxer can write zero-length chapters when the tagging remux
 * copies an embedded cover next to the chapter track it rebuilds. The tagged
 * copy must hold the source's chapter table: same count, same titles in order,
 * each start and end within CHAPTER_TOLERANCE_S. ffprobe runs via execFile with
 * an argv list (no shell) and a timeout.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileP = promisify(execFile);
const PROBE_TIMEOUT_MS = 60_000;
/** Room for a long chapter list (each chapter is a few hundred bytes of JSON). */
const PROBE_MAX_BUFFER = 16 * 1024 * 1024;
export const CHAPTER_TOLERANCE_S = 0.1;
/** `tagsDropped` (shown on the request) when the guard placed the original. */
export const CHAPTER_TABLE_CHANGED = 'tagging changed the chapter table';

export interface ProbedChapter {
  title: string;
  /** Seconds; NaN when ffprobe gave none. */
  start: number;
  end: number;
}

export type TaggedChapterCheck =
  /** Same table, or the source has no chapters (nothing to compare). */
  | { outcome: 'kept' }
  /** The source's table could not be read: the tagged copy is used unchecked. */
  | { outcome: 'unchecked'; warning: string }
  /** The tagged copy's table differs or cannot be read: it must not be placed. */
  | { outcome: 'changed'; warning: string };

interface FfprobeChapter {
  start_time?: string;
  end_time?: string;
  tags?: Record<string, string>;
}

/** The chapter table ffprobe reads from `filePath`. Throws when ffprobe fails or prints no JSON. */
export async function probeChapters(filePath: string): Promise<ProbedChapter[]> {
  const { stdout } = await execFileP('ffprobe', ['-v', 'error', '-show_chapters', '-of', 'json', filePath], {
    timeout: PROBE_TIMEOUT_MS,
    maxBuffer: PROBE_MAX_BUFFER,
  });
  const chapters = (JSON.parse(stdout) as { chapters?: FfprobeChapter[] }).chapters ?? [];
  return chapters.map((chapter) => {
    const tags = chapter.tags ?? {};
    const titleKey = Object.keys(tags).find((key) => key.toLowerCase() === 'title');
    return {
      title: titleKey ? String(tags[titleKey]) : '',
      start: Number.parseFloat(chapter.start_time ?? ''),
      end: Number.parseFloat(chapter.end_time ?? ''),
    };
  });
}

/** 1-based index of the first chapter that differs (count, title, start or end), or 0 when the tables match. */
export function firstChapterDifference(before: ProbedChapter[], after: ProbedChapter[]): number {
  // 1e-9: ffprobe prints 6 decimals, so a drift of exactly 0.1 s must not fail on float rounding. False for NaN.
  const near = (a: number, b: number) => Math.abs(a - b) <= CHAPTER_TOLERANCE_S + 1e-9;
  for (let i = 0; i < Math.max(before.length, after.length); i++) {
    const a = before[i];
    const b = after[i];
    if (!a || !b || a.title !== b.title || !near(a.start, b.start) || !near(a.end, b.end)) return i + 1;
  }
  return 0;
}

function describeProbeFailure(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error';
  const e = error as Error & { stderr?: unknown; killed?: boolean };
  if (e.killed) return 'ffprobe timed out';
  const stderr = typeof e.stderr === 'string' ? e.stderr.trim() : '';
  return (stderr ? stderr.split(/\r?\n/).slice(-2).join(' | ') : e.message.split('\n')[0]).slice(0, 300);
}

/**
 * Compare the chapter table of `tagged` (the final tagged copy, after every
 * tag step) with its `source`. `name` is the file name used in the warning.
 */
export async function checkTaggedChapters(source: string, tagged: string, name: string): Promise<TaggedChapterCheck> {
  let before: ProbedChapter[];
  try {
    before = await probeChapters(source);
  } catch (error) {
    return {
      outcome: 'unchecked',
      warning: `Could not read the chapter table of ${name} (${describeProbeFailure(error)}); the tagged copy is used without a chapter check`,
    };
  }
  if (before.length === 0) return { outcome: 'kept' };

  let after: ProbedChapter[];
  try {
    after = await probeChapters(tagged);
  } catch (error) {
    return {
      outcome: 'changed',
      warning: `Tagging changed the chapter table of ${name} (${before.length} chapters before, the tagged copy's could not be read: ${describeProbeFailure(error)}), so it was imported without tags`,
    };
  }
  const first = firstChapterDifference(before, after);
  if (first === 0) return { outcome: 'kept' };
  return {
    outcome: 'changed',
    warning: `Tagging changed the chapter table of ${name} (${before.length} chapters before, ${after.length} after, first change at chapter ${first}), so it was imported without tags`,
  };
}
