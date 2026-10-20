/**
 * Component: Chapter Merge Source Verification Tests (rules, no ffmpeg)
 * Documentation: documentation/features/chapter-merging.md
 */

import { describe, expect, it } from 'vitest';
import type { AudioContent } from '@/lib/utils/audio-content';
import {
  checkMergedTimeline,
  measureChapterContent,
  mergeToleranceMs,
  verifyMergedContent,
  type ChapterMeasurement,
} from '@/lib/utils/merge-verification';

/** AAC-LC at 22.05 kHz: 1024 samples per frame. */
const FRAME_MS = (1024 / 22050) * 1000;

/** A copied chapter: `packets` frames, the first a priming frame, the last trimmed (as ffprobe reports them). */
function aacChapter(packets: number): AudioContent {
  const framedMs = packets * FRAME_MS;
  const contentMs = Math.round(framedMs - FRAME_MS - FRAME_MS / 2); // priming + trimmed last frame
  return { contentMs, gapMs: 0, frameMs: 46.4, framedMs, endMs: contentMs, packets };
}

function measurement(chapters: AudioContent[]): ChapterMeasurement {
  return {
    contentMs: chapters.map((c) => c.contentMs),
    packets: chapters.map((c) => c.packets),
    framedMs: chapters.map((c) => c.framedMs),
  };
}

/**
 * A codec-copy output of these chapters: every later chapter's priming packet
 * and trimmed last packet count as full frames there, so its content
 * (as probeAudioContent reports it) is about 69 ms per boundary too long.
 */
function copiedOutput(chapters: AudioContent[], missingPackets = 0): AudioContent {
  const packets = chapters.reduce((s, c) => s + c.packets, 0) - missingPackets;
  const framedMs = packets * FRAME_MS;
  const contentMs = Math.round(framedMs - FRAME_MS / 2);
  return { contentMs, gapMs: 0, frameMs: 46.4, framedMs, endMs: Math.round(framedMs - 1.5 * FRAME_MS * chapters.length), packets };
}

const eighty = Array.from({ length: 80 }, () => aacChapter(196)); // ~9.1 s each

describe('verifyMergedContent: codec copy', () => {
  it('verifies a complete 80-chapter copy although its content reads 5.5 s long (priming at each boundary)', () => {
    const output = copiedOutput(eighty);
    const expected = eighty.reduce((s, c) => s + c.contentMs, 0);
    expect(output.contentMs - expected).toBeGreaterThan(mergeToleranceMs(80)); // the old symmetric check failed this

    const v = verifyMergedContent(measurement(eighty), 80, output, 'copy');

    expect(v.verified).toBe(true);
    expect(v.actualMs).toBe(expected);
    expect(v.packets).toBe(v.expectedPackets);
  });

  it('does not verify when the last chapter read short, though the surplus would have hidden it', () => {
    // 25% of a 196-packet chapter arrived: 147 packets (6.8 s) lost, less than the 5.5 s surplus + window
    const output = copiedOutput(eighty, 147);
    const expected = eighty.reduce((s, c) => s + c.contentMs, 0);
    expect(Math.abs(output.contentMs - expected)).toBeLessThanOrEqual(mergeToleranceMs(80)); // the old check passed this

    const v = verifyMergedContent(measurement(eighty), 80, output, 'copy');

    expect(v.verified).toBe(false);
    expect(v.reason).toContain('15533 audio packets, the chapters 15680');
    expect(v.reason).toContain('missing');
    expect(expected - (v.actualMs ?? 0)).toBe(Math.round(147 * FRAME_MS));
  });

  it('does not verify a copy missing a single packet, nor one with extra packets', () => {
    expect(verifyMergedContent(measurement(eighty), 80, copiedOutput(eighty, 1), 'copy').verified).toBe(false);
    expect(verifyMergedContent(measurement(eighty), 80, copiedOutput(eighty, -1), 'copy').verified).toBe(false);
  });

  it('does not verify when the packets add up but the frame differs (chapters at another sample rate)', () => {
    const output = copiedOutput(eighty);
    const v = verifyMergedContent(measurement(eighty), 80, { ...output, framedMs: output.framedMs / 2 }, 'copy');
    expect(v.verified).toBe(false);
    expect(v.reason).toContain('frames differ');
  });

  it('does not verify a complete copy with a timeline gap', () => {
    const v = verifyMergedContent(measurement(eighty), 80, { ...copiedOutput(eighty), gapMs: 900 }, 'copy');
    expect(v.verified).toBe(false);
    expect(v.reason).toContain('0.9 s of gaps');
  });
});

describe('verifyMergedContent: re-encode', () => {
  const chapters = Array.from({ length: 80 }, (): AudioContent => ({ contentMs: 8500, gapMs: 0, frameMs: 46.4, framedMs: 8600, endMs: 8500, packets: 186 }));
  const output = (contentMs: number): AudioContent => ({ contentMs, gapMs: 0, frameMs: 46.4, framedMs: contentMs + 46, endMs: contentMs, packets: 14640 });

  it('verifies a re-encode within 1 s + 50 ms per chapter over the chapters', () => {
    expect(verifyMergedContent(measurement(chapters), 80, output(680046), 'reencode').verified).toBe(true);
    expect(verifyMergedContent(measurement(chapters), 80, output(680000 + 5000), 'reencode').verified).toBe(true);
    expect(verifyMergedContent(measurement(chapters), 80, output(680000 + 5001), 'reencode').verified).toBe(false);
  });

  it('allows a shortfall of at most 1 s, whatever the chapter count', () => {
    expect(verifyMergedContent(measurement(chapters), 80, output(679000), 'reencode').verified).toBe(true);
    const v = verifyMergedContent(measurement(chapters), 80, output(678999), 'reencode');
    expect(v.verified).toBe(false);
    expect(v.reason).toContain('1.0 s less audio');
  });
});

describe('verifyMergedContent: measurement failures never verify', () => {
  it('chapters not measured', () => {
    const v = verifyMergedContent({ error: 'ffprobe exited 1' }, 3, copiedOutput(eighty), 'copy');
    expect(v).toMatchObject({ verified: false, error: 'ffprobe exited 1' });
  });

  it('output not measured', () => {
    const v = verifyMergedContent(measurement(eighty), 80, { error: 'no audio packets found' }, 'copy');
    expect(v).toMatchObject({ verified: false, error: 'no audio packets found' });
  });

  it('a chapter that fails or holds no audio fails the whole measurement', async () => {
    const probe = async (p: string) => (p === 'b' ? { ...aacChapter(10), contentMs: 0 } : aacChapter(10));
    expect(await measureChapterContent(['a', 'b', 'c'], probe)).toEqual({ error: 'no audio in b' });
  });
});

describe('checkMergedTimeline', () => {
  const content = (over: Partial<AudioContent>): AudioContent => ({ contentMs: 36093, gapMs: 0, frameMs: 26.1, framedMs: 36096, endMs: 36093, packets: 1383, ...over });

  it('accepts a timeline that matches the audio', () => {
    const v = verifyMergedContent(measurement([content({}), content({}), content({})].map((c) => ({ ...c, contentMs: 12031 }))), 3, content({}), 'reencode');
    expect(checkMergedTimeline(v, content({}))).toBeUndefined();
  });

  it('rejects gaps (chapter 2 placed at chapter 1\'s 37.8 s estimate) and an end far from the audio', () => {
    const chapters = measurement([0, 1, 2].map(() => content({ contentMs: 12031 })));
    const gapped = content({ gapMs: 51540, endMs: 87633 });
    expect(checkMergedTimeline(verifyMergedContent(chapters, 3, gapped, 'reencode'), gapped)).toContain('51.5 s of gaps');

    const late = content({ endMs: 36093 + 1200 });
    expect(checkMergedTimeline(verifyMergedContent(chapters, 3, late, 'reencode'), late)).toContain('ends at 37.3 s but holds 36.1 s');
  });

  it('checks only gaps when the audio could not be compared, and nothing when the output was not measured', () => {
    const late = content({ endMs: 99_000 });
    expect(checkMergedTimeline(verifyMergedContent({ error: 'x' }, 3, late, 'copy'), late)).toBeUndefined();
    const gapped = content({ gapMs: 500 });
    expect(checkMergedTimeline(verifyMergedContent({ error: 'x' }, 3, gapped, 'copy'), gapped)).toContain('gaps');
    expect(checkMergedTimeline(verifyMergedContent({ error: 'x' }, 3, { error: 'y' }, 'copy'), { error: 'y' })).toBeUndefined();
  });
});
