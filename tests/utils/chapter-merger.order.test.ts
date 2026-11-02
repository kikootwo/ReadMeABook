/**
 * Component: Chapter Merger ordering across disc folders
 * Documentation: documentation/features/chapter-merging.md
 */

import path from 'path';
import { describe, expect, it, vi } from 'vitest';

const trackOf = vi.hoisted(() => new Map<string, number>());
vi.mock('child_process', () => {
  const execFile = vi.fn();
  (execFile as unknown as Record<symbol, unknown>)[Symbol.for('nodejs.util.promisify.custom')] = async (
    _file: string,
    args: string[]
  ) => {
    const file = args[args.length - 1];
    const track = trackOf.get(file);
    return {
      stdout: JSON.stringify({ format: { duration: '10', tags: track ? { track: `${track}/2` } : {} } }),
      stderr: '',
    };
  };
  return { execFile, spawn: vi.fn() };
});

import { analyzeChapterFiles } from '@/lib/utils/chapter-merger';

describe('analyzeChapterFiles with a multi-disc order', () => {
  const files = ['CD1/01.mp3', 'CD1/02.mp3', 'CD2/01.mp3', 'CD2/02.mp3'].map((f) => path.join('/src', f));
  files.forEach((f, i) => trackOf.set(f, (i % 2) + 1)); // per-disc tags 1,2,1,2

  it('keeps the order it is given (disc by disc)', async () => {
    const chapters = await analyzeChapterFiles(files, undefined, true);
    expect(chapters.map((c) => c.path)).toEqual(files);
    expect(chapters.map((c) => c.chapterTitle)).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 3', 'Chapter 4']);
  });

  it('with a given order, no metadata-or-filename decision is made or logged', async () => {
    const messages: string[] = [];
    const log = async (message: string) => {
      messages.push(message);
    };
    const logger = { info: log, warn: log, error: log, debug: log } as unknown as Parameters<typeof analyzeChapterFiles>[1];
    await analyzeChapterFiles(files, logger, true);
    expect(messages.filter((m) => /Chapter ordering|Metadata analysis|Track numbers|(metadata|filename)-based/.test(m))).toEqual([]);
    expect(messages).toContain('Using the multi-disc import order for 4 chapters');
  });

  it('without a given order, per-disc tags fall back to basename order as before', async () => {
    const chapters = await analyzeChapterFiles(files);
    expect(chapters.map((c) => path.basename(path.dirname(c.path)) + '/' + c.filename)).toEqual([
      'CD1/01.mp3', 'CD2/01.mp3', 'CD1/02.mp3', 'CD2/02.mp3',
    ]);
  });
});
