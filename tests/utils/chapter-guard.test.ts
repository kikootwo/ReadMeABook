/**
 * Component: Tagged Copy Chapter Guard Unit Tests (#511)
 * Documentation: documentation/phase3/file-organization.md
 */

import { describe, expect, it, vi } from 'vitest';

const probeState = vi.hoisted(() => ({ stdout: '', calls: [] as Array<{ cmd: string; args: string[]; options: Record<string, unknown> }> }));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const { promisify } = await import('util');
  const execFile = Object.assign(vi.fn(), {
    [promisify.custom]: async (cmd: string, args: string[], options: Record<string, unknown>) => {
      probeState.calls.push({ cmd, args, options });
      return { stdout: probeState.stdout, stderr: '' };
    },
  });
  return { ...actual, default: { ...actual, execFile }, execFile };
});

import { CHAPTER_TOLERANCE_S, firstChapterDifference, probeChapters, type ProbedChapter } from '@/lib/utils/chapter-guard';

const ch = (title: string, start: number, end: number): ProbedChapter => ({ title, start, end });
const TABLE = [ch('One', 0, 10), ch('Two', 10, 20)];

describe('firstChapterDifference', () => {
  it('matches identical tables and drift up to the tolerance', () => {
    expect(firstChapterDifference(TABLE, TABLE)).toBe(0);
    expect(firstChapterDifference(TABLE, [ch('One', 0, 10.1), ch('Two', 10.1, 19.9)])).toBe(0);
    expect(CHAPTER_TOLERANCE_S).toBe(0.1);
  });

  it('reports the first chapter whose start, end, title or presence differs', () => {
    expect(firstChapterDifference(TABLE, [ch('One', 0, 10), ch('Two', 10.11, 20)])).toBe(2);
    expect(firstChapterDifference(TABLE, [ch('One', 0, 0), ch('Two', 10, 10)])).toBe(1);
    expect(firstChapterDifference(TABLE, [ch('One', 0, 10), ch('two', 10, 20)])).toBe(2);
    expect(firstChapterDifference(TABLE, [TABLE[1], TABLE[0]])).toBe(1);
    expect(firstChapterDifference(TABLE, TABLE.slice(0, 1))).toBe(2);
    expect(firstChapterDifference(TABLE, [...TABLE, ch('Three', 20, 30)])).toBe(3);
  });

  it('treats a time ffprobe did not give (NaN) as a difference', () => {
    expect(firstChapterDifference(TABLE, [ch('One', 0, Number.NaN), TABLE[1]])).toBe(1);
  });
});

describe('probeChapters', () => {
  it('runs ffprobe with an argv list and a timeout, and reads titles case-insensitively', async () => {
    probeState.stdout = JSON.stringify({
      chapters: [
        { id: 0, start_time: '0.000000', end_time: '20.571995', tags: { title: '001' } },
        { id: 1, start_time: '20.571995', end_time: '30.000000', tags: { TITLE: '002' } },
        { id: 2, start_time: '30.000000', end_time: '40.000000' },
      ],
    });

    await expect(probeChapters('/books/a b; $(x).m4b')).resolves.toEqual([
      ch('001', 0, 20.571995), ch('002', 20.571995, 30), ch('', 30, 40),
    ]);
    expect(probeState.calls).toEqual([{
      cmd: 'ffprobe',
      args: ['-v', 'error', '-show_chapters', '-of', 'json', '/books/a b; $(x).m4b'],
      options: { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 },
    }]);
  });

  it('returns no chapters when ffprobe lists none', async () => {
    probeState.stdout = JSON.stringify({ chapters: [] });
    await expect(probeChapters('/books/a.mp3')).resolves.toEqual([]);
    probeState.stdout = '{}';
    await expect(probeChapters('/books/a.mp3')).resolves.toEqual([]);
  });
});
