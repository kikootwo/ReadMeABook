/**
 * Component: Chapter Merge Source Verification (packet-accurate durations)
 * Documentation: documentation/features/chapter-merging.md
 *
 * Decides whether a merged M4B provably holds all of its chapter files, which
 * is what allows those chapter files to be cleaned up afterwards. Every
 * chapter and the merged file are measured from their audio packets (not
 * format.duration, which is an estimate for e.g. VBR MP3 without a Xing
 * header), and the merged file must match the chapters' total within a small
 * fixed allowance: 1 s plus 50 ms per chapter for encoder priming and frame
 * rounding at each boundary. A percentage window would let a merge that lost
 * whole chapters through on long books (2% of 13 hours is over 15 minutes).
 */

import { probeStreamDurationMs } from './audio-duration';

export const MERGE_BASE_TOLERANCE_MS = 1000;
export const MERGE_PER_CHAPTER_TOLERANCE_MS = 50;

export type DurationProbe = (filePath: string) => Promise<number>;

export function mergeToleranceMs(chapterCount: number): number {
  return MERGE_BASE_TOLERANCE_MS + MERGE_PER_CHAPTER_TOLERANCE_MS * chapterCount;
}

export interface ChapterMeasurement {
  /** Packet-accurate duration (ms) per chapter, in input order; only set when every chapter was measured. */
  durationsMs?: number[];
  error?: string;
}

/** Measure every chapter from its audio packets. Fails as a whole if any chapter has no measurable audio. */
export async function measureChapterDurations(
  chapterPaths: string[],
  probe: DurationProbe = probeStreamDurationMs
): Promise<ChapterMeasurement> {
  try {
    const durationsMs: number[] = [];
    for (const chapter of chapterPaths) {
      const ms = await probe(chapter);
      if (!(ms > 0)) throw new Error(`no audio duration for ${chapter}`);
      durationsMs.push(ms);
    }
    return { durationsMs };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export interface MergeVerification {
  verified: boolean;
  expectedMs?: number;
  actualMs?: number;
  toleranceMs: number;
  error?: string;
}

/**
 * Verify a merged file against its chapters' packet-accurate total.
 * `chapters` is either the paths to measure or an existing measurement of them.
 */
export async function verifyMergedDuration(
  chapters: string[] | ChapterMeasurement & { count: number },
  outputPath: string,
  probe: DurationProbe = probeStreamDurationMs
): Promise<MergeVerification> {
  const measurement = Array.isArray(chapters) ? await measureChapterDurations(chapters, probe) : chapters;
  const count = Array.isArray(chapters) ? chapters.length : chapters.count;
  const toleranceMs = mergeToleranceMs(count);
  if (!measurement.durationsMs) {
    return { verified: false, toleranceMs, error: measurement.error ?? 'chapters were not measured' };
  }
  const expectedMs = measurement.durationsMs.reduce((sum, ms) => sum + ms, 0);
  try {
    const actualMs = await probe(outputPath);
    if (!(actualMs > 0)) throw new Error('no audio duration for the merged file');
    return { verified: Math.abs(actualMs - expectedMs) <= toleranceMs, expectedMs, actualMs, toleranceMs };
  } catch (error) {
    return { verified: false, expectedMs, toleranceMs, error: error instanceof Error ? error.message : String(error) };
  }
}
