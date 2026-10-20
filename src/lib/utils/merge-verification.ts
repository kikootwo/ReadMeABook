/**
 * Component: Chapter Merge Source Verification (audio content, not timestamps)
 * Documentation: documentation/features/chapter-merging.md
 *
 * Decides whether a merged M4B holds as much audio as its chapter files did
 * when they were measured just before the merge, which is what allows those
 * chapter files to be cleaned up afterwards. Both sides are measured as audio
 * content (probeAudioContent: packet durations minus discarded samples), not
 * as end timestamps or format.duration: ffmpeg can bridge a chapter that ended
 * early with one stretched packet, so the output still ends at full length.
 * Verified only when the merged file has no timeline gap and its content
 * matches the chapters' total within 1 s + 50 ms per chapter (encoder priming
 * and frame rounding at each boundary). A percentage window would let a merge
 * that lost whole chapters through on long books (2% of 13 h is over 15 min).
 * This checks the amount of audio, not its bytes.
 */

import { type AudioContent, probeAudioContent } from './audio-content';

export const MERGE_BASE_TOLERANCE_MS = 1000;
export const MERGE_PER_CHAPTER_TOLERANCE_MS = 50;
/** Chapters measured in parallel. */
const MEASURE_CONCURRENCY = 4;
/** Upper bound for measuring all chapters; past it the merge is not verified (sources kept). */
export const MEASURE_BUDGET_MS = 30 * 60 * 1000;

export type ContentProbe = (filePath: string) => Promise<AudioContent>;

export function mergeToleranceMs(chapterCount: number): number {
  return MERGE_BASE_TOLERANCE_MS + MERGE_PER_CHAPTER_TOLERANCE_MS * chapterCount;
}

export interface ChapterMeasurement {
  /** Audio content (ms) per chapter, in input order; only set when every chapter was measured. */
  contentMs?: number[];
  error?: string;
}

/** Measure every chapter's audio content. Fails as a whole if any chapter cannot be measured in time. */
export async function measureChapterContent(
  chapterPaths: string[],
  probe: ContentProbe = probeAudioContent,
  budgetMs: number = MEASURE_BUDGET_MS
): Promise<ChapterMeasurement> {
  const deadline = Date.now() + budgetMs;
  const contentMs: number[] = new Array(chapterPaths.length);
  let next = 0;
  let failure: string | undefined;

  const worker = async () => {
    while (!failure && next < chapterPaths.length) {
      const index = next++;
      if (Date.now() > deadline) {
        failure = `chapter measurement took longer than ${Math.round(budgetMs / 60000)} min`;
        return;
      }
      try {
        const content = await probe(chapterPaths[index]);
        if (!(content.contentMs > 0)) throw new Error(`no audio in ${chapterPaths[index]}`);
        contentMs[index] = content.contentMs;
      } catch (error) {
        failure ??= error instanceof Error ? error.message : String(error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MEASURE_CONCURRENCY, chapterPaths.length) }, worker));
  return failure ? { error: failure } : { contentMs };
}

export interface MergeVerification {
  verified: boolean;
  expectedMs?: number;
  actualMs?: number;
  gapMs?: number;
  toleranceMs: number;
  error?: string;
}

/** Compare the merged file's content with the chapters' measured content. */
export function verifyMergedContent(
  chapters: ChapterMeasurement,
  chapterCount: number,
  output: AudioContent | { error: string }
): MergeVerification {
  const toleranceMs = mergeToleranceMs(chapterCount);
  if (!chapters.contentMs) {
    return { verified: false, toleranceMs, error: chapters.error ?? 'chapters were not measured' };
  }
  const expectedMs = chapters.contentMs.reduce((sum, ms) => sum + ms, 0);
  if ('error' in output) return { verified: false, expectedMs, toleranceMs, error: output.error };
  const actualMs = output.contentMs;
  return {
    verified: output.gapMs === 0 && Math.abs(actualMs - expectedMs) <= toleranceMs,
    expectedMs,
    actualMs,
    gapMs: output.gapMs,
    toleranceMs,
  };
}

/** Measure the chapters and the merged file, then compare (for checks outside a merge run). */
export async function verifyMergedFile(
  chapterPaths: string[],
  outputPath: string,
  probe: ContentProbe = probeAudioContent
): Promise<MergeVerification> {
  const chapters = await measureChapterContent(chapterPaths, probe);
  const output = await probe(outputPath).catch((error: Error) => ({ error: error.message }));
  return verifyMergedContent(chapters, chapterPaths.length, output);
}
