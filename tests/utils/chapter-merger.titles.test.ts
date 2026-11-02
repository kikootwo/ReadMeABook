/**
 * Component: Chapter Merger embedded "Chapter N" titles (#509)
 * Documentation: documentation/features/chapter-merging.md
 */

import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tagsOf = vi.hoisted(() => new Map<string, { track?: string; title?: string }>());
vi.mock('child_process', () => {
  const execFile = vi.fn();
  (execFile as unknown as Record<symbol, unknown>)[Symbol.for('nodejs.util.promisify.custom')] = async (
    _file: string,
    args: string[]
  ) => ({
    stdout: JSON.stringify({ format: { duration: '60', tags: tagsOf.get(args[args.length - 1]) ?? {} } }),
    stderr: '',
  });
  return { execFile, spawn: vi.fn() };
});

import { analyzeChapterFiles } from '@/lib/utils/chapter-merger';

/** Tag each file with track `i+1/N` (or `tracks[i]`) and `titles[i]`. */
function tag(files: string[], titles: (string | undefined)[], tracks?: number[]) {
  tagsOf.clear();
  files.forEach((f, i) => tagsOf.set(f, { track: `${tracks ? tracks[i] : i + 1}/${files.length}`, title: titles[i] }));
}

function captureLog() {
  const messages: string[] = [];
  const log = async (message: string) => {
    messages.push(message);
  };
  const logger = { info: log, warn: log, error: log, debug: log } as unknown as Parameters<typeof analyzeChapterFiles>[1];
  return { logger, titleLines: () => messages.filter((m) => m.startsWith('Chapter titles:')) };
}

const titlesOf = (chapters: { chapterTitle: string }[]) => chapters.map((c) => c.chapterTitle);

describe('analyzeChapterFiles with embedded "Chapter N" titles', () => {
  beforeEach(() => tagsOf.clear());

  it('keeps "Chapter 1..N" tags after an intro when the file names hold no titles (#509)', async () => {
    const files = [1, 2, 3, 4, 5].map((n) => `/src/Project Hail Mary (0${n}).mp3`);
    const titles = ['Intro & Dedication', 'Chapter 1', 'Chapter 2', 'Chapter 3', 'Chapter 4'];
    tag(files, titles);
    const { logger, titleLines } = captureLog();

    expect(titlesOf(await analyzeChapterFiles(files, logger))).toEqual(titles);
    expect(titleLines()).toEqual([
      'Chapter titles: keeping 4 embedded "Chapter N" title(s) (every title in the set is distinct)',
    ]);
  });

  it('keeps filename priority and generic fallbacks beside embedded numbered chapters', async () => {
    const files = ['/src/01 - Opening.mp3', '/src/02.mp3', '/src/03.mp3', '/src/04.mp3', '/src/05.mp3', '/src/Chapter 99.mp3'];
    tag(files, ['Chapter 10', undefined, 'Track 10', '10', 'Part 10', 'Chapter 11']);

    expect(titlesOf(await analyzeChapterFiles(files))).toEqual([
      'Opening', 'Chapter 2', 'Chapter 3', 'Chapter 4', 'Chapter 5', 'Chapter 11',
    ]);
  });

  describe('per-disc tags that restart at "Chapter 1"', () => {
    const files = ['CD1/01.mp3', 'CD1/02.mp3', 'CD2/01.mp3', 'CD2/02.mp3'].map((f) => path.join('/src', f));
    beforeEach(() => tag(files, ['Chapter 1', 'Chapter 2', 'Chapter 1', 'Chapter 2'], [1, 2, 1, 2]));

    it('with the multi-disc order, numbers chapters by position', async () => {
      const { logger, titleLines } = captureLog();
      const chapters = await analyzeChapterFiles(files, logger, true);

      expect(chapters.map((c) => c.path)).toEqual(files);
      expect(titlesOf(chapters)).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 3', 'Chapter 4']);
      expect(titleLines()).toEqual([
        'Chapter titles: "Chapter 1" repeats across the set - dropping embedded "Chapter N" titles, numbering chapters by position',
      ]);
    });

    it('without a given order, numbers chapters by position', async () => {
      expect(titlesOf(await analyzeChapterFiles(files))).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 3', 'Chapter 4']);
    });
  });

  it('an untagged intro beside "Chapter 1..N" tags gives no repeated names', async () => {
    const files = [1, 2, 3, 4].map((n) => `/src/Book (0${n}).mp3`);
    tag(files, [undefined, 'Chapter 1', 'Chapter 2', 'Chapter 3']);

    const titles = titlesOf(await analyzeChapterFiles(files));
    expect(titles).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 3', 'Chapter 4']);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('compares numbers, case and spacing: "chapter  01" repeats "Chapter 1"', async () => {
    const files = [1, 2, 3].map((n) => `/src/Book (0${n}).mp3`);
    tag(files, ['Chapter 1', 'chapter  01', 'Chapter 2']);

    expect(titlesOf(await analyzeChapterFiles(files))).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 3']);
  });

  it('logs nothing about numbered titles when no file has one', async () => {
    const files = [1, 2, 3].map((n) => `/src/Book (0${n}).mp3`);
    tag(files, ['Intro', 'Middle', 'End']);
    const { logger, titleLines } = captureLog();

    expect(titlesOf(await analyzeChapterFiles(files, logger))).toEqual(['Intro', 'Middle', 'End']);
    expect(titleLines()).toEqual([]);
  });
});
