/**
 * Component: Chapter Merge Source Verification (audio content, not timestamps)
 * Documentation: documentation/features/chapter-merging.md
 *
 * Decides whether a merged M4B holds all the audio its chapter files did when
 * they were measured just before the merge, which is what allows those chapter
 * files to be cleaned up afterwards. Both sides are measured from packets
 * (probeAudioContent), not from end timestamps or format.duration: ffmpeg can
 * bridge a chapter that ended early with one stretched packet, so the output
 * still ends at full length.
 * - Codec copy: every source packet must arrive. The output's packet count must
 *   equal the chapters' total exactly, and its packets x frame must equal theirs
 *   (same frame). No window: in a copied merge each later chapter's priming
 *   packet and trimmed last packet count as full frames, a surplus that grows
 *   with the chapter count and would cancel real loss inside any window.
 * - Re-encode: the output's content may exceed the chapters' by up to
 *   1 s + 50 ms per chapter but fall short by at most 1 s (a shortfall is lost
 *   audio; measured re-encodes come out 0-50 ms long whatever the chapter count).
 * Either way the output must have no timeline gap. checkMergedTimeline also
 * fails the merge itself when the output's timeline does not match its audio
 * (gaps, or an end far from the content), since its chapter markers and seeking
 * would then be wrong. This checks the amount of audio, not its bytes.
 */

import { type AudioContent, probeAudioContent } from './audio-content';

export const MERGE_BASE_TOLERANCE_MS = 1000;
export const MERGE_PER_CHAPTER_TOLERANCE_MS = 50;
/** Chapters measured in parallel. */
const MEASURE_CONCURRENCY = 4;
/** Upper bound for measuring all chapters; past it the merge is not verified (sources kept). */
export const MEASURE_BUDGET_MS = 30 * 60 * 1000;

export type ContentProbe = (filePath: string) => Promise<AudioContent>;
/** How the merge produced its audio: packets copied from the chapters, or re-encoded. */
export type MergeMode = 'copy' | 'reencode';

/** Largest surplus (and timeline/content difference) accepted for a merge of this many chapters. */
export function mergeToleranceMs(chapterCount: number): number {
  return MERGE_BASE_TOLERANCE_MS + MERGE_PER_CHAPTER_TOLERANCE_MS * chapterCount;
}

export interface ChapterMeasurement {
  /** Audio content (ms) per chapter, in input order; only set when every chapter was measured. */
  contentMs?: number[];
  /** Packets per chapter (set with contentMs). */
  packets?: number[];
  /** Packets x frame (ms) per chapter (set with contentMs). */
  framedMs?: number[];
  error?: string;
}

/** Measure every chapter's audio content. Fails as a whole if any chapter cannot be measured in time. */
export async function measureChapterContent(
  chapterPaths: string[],
  probe: ContentProbe = probeAudioContent,
  budgetMs: number = MEASURE_BUDGET_MS
): Promise<ChapterMeasurement> {
  const deadline = Date.now() + budgetMs;
  const measured: AudioContent[] = new Array(chapterPaths.length);
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
        measured[index] = content;
      } catch (error) {
        failure ??= error instanceof Error ? error.message : String(error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MEASURE_CONCURRENCY, chapterPaths.length) }, worker));
  if (failure) return { error: failure };
  return {
    contentMs: measured.map((c) => c.contentMs),
    packets: measured.map((c) => c.packets),
    framedMs: measured.map((c) => c.framedMs),
  };
}

export interface MergeVerification {
  verified: boolean;
  /** Why it is not verified (for the log). */
  reason?: string;
  expectedMs?: number;
  /**
   * The merged file's audio in the chapters' terms (ms). Codec copy: the
   * chapters' content minus whatever packets did not arrive; re-encode: its content.
   */
  actualMs?: number;
  gapMs?: number;
  /** Where the merged file's timeline ends (ms). */
  endMs?: number;
  /** Codec copy: packets expected (the chapters' total) and found. */
  expectedPackets?: number;
  packets?: number;
  toleranceMs: number;
  /** Set when a measurement failed: nothing was compared. */
  error?: string;
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** Compare the merged file's audio with the chapters' measured audio. */
export function verifyMergedContent(
  chapters: ChapterMeasurement,
  chapterCount: number,
  output: AudioContent | { error: string },
  mode: MergeMode
): MergeVerification {
  const toleranceMs = mergeToleranceMs(chapterCount);
  if (!chapters.contentMs || !chapters.packets || !chapters.framedMs) {
    const error = chapters.error ?? 'chapters were not measured';
    return { verified: false, reason: `could not measure the chapters (${error})`, toleranceMs, error };
  }
  const expectedMs = sum(chapters.contentMs);
  if ('error' in output) {
    return { verified: false, reason: `could not measure the merged file (${output.error})`, expectedMs, toleranceMs, error: output.error };
  }
  const base = { expectedMs, gapMs: output.gapMs, endMs: output.endMs, toleranceMs };
  const gapReason = output.gapMs > 0 ? `its timeline has ${seconds(output.gapMs)} of gaps` : undefined;

  if (mode === 'copy') {
    const expectedPackets = sum(chapters.packets);
    // Missing packets (or a different frame) show as a framed difference, exact for a complete copy
    const framedDiffMs = output.framedMs - sum(chapters.framedMs);
    const actualMs = Math.round(expectedMs + framedDiffMs);
    const reason =
      output.packets !== expectedPackets
        ? `it has ${output.packets} audio packets, the chapters ${expectedPackets} (${seconds(Math.abs(framedDiffMs))} ${output.packets < expectedPackets ? 'missing' : 'extra'})`
        : Math.abs(framedDiffMs) >= 1
          ? `its audio frames differ from the chapters' (${seconds(Math.abs(framedDiffMs))} difference)`
          : gapReason;
    return { ...base, verified: !reason, reason, actualMs, expectedPackets, packets: output.packets };
  }

  const actualMs = output.contentMs;
  const deficitMs = expectedMs - actualMs;
  const reason =
    deficitMs > MERGE_BASE_TOLERANCE_MS
      ? `it holds ${seconds(deficitMs)} less audio than the chapters (at most ${MERGE_BASE_TOLERANCE_MS} ms allowed)`
      : -deficitMs > toleranceMs
        ? `it holds ${seconds(-deficitMs)} more audio than the chapters (at most ${toleranceMs} ms allowed)`
        : gapReason;
  return { ...base, verified: !reason, reason, actualMs };
}

/**
 * Whether the merged file's timeline matches its audio: a gap (a chapter that
 * ended early, or timestamps offset by a chapter's estimated duration) or an
 * end far from the audio means its chapter markers and seeking are wrong, so
 * the merge itself fails. Returns the problem, or undefined. Without a
 * comparable content (chapters or output unmeasured) only gaps are checked.
 */
export function checkMergedTimeline(verification: MergeVerification, output: AudioContent | { error: string }): string | undefined {
  if ('error' in output) return undefined;
  if (output.gapMs > 0) {
    return `the merged timeline has ${seconds(output.gapMs)} of gaps (ends at ${seconds(output.endMs)})`;
  }
  const { actualMs, toleranceMs } = verification;
  if (actualMs !== undefined && Math.abs(output.endMs - actualMs) > toleranceMs) {
    return `the merged timeline ends at ${seconds(output.endMs)} but holds ${seconds(actualMs)} of audio`;
  }
  return undefined;
}

/** Measure the chapters and the merged file, then compare (for checks outside a merge run). */
export async function verifyMergedFile(
  chapterPaths: string[],
  outputPath: string,
  mode: MergeMode,
  probe: ContentProbe = probeAudioContent
): Promise<MergeVerification> {
  const chapters = await measureChapterContent(chapterPaths, probe);
  const output = await probe(outputPath).catch((error: Error) => ({ error: error.message }));
  return verifyMergedContent(chapters, chapterPaths.length, output, mode);
}
