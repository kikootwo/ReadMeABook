/**
 * Component: Tailwind Opacity Utility Convention Test
 * Documentation: documentation/frontend/components.md
 *
 * Tailwind v4 dropped the separate opacity utilities (bg-opacity-50, ring-opacity-5, ...). They
 * compile to nothing, so `bg-black bg-opacity-50` renders as solid black. Use the slash form
 * (bg-black/50, ring-black/5) instead.
 */

import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'src');
const SKIPPED_DIRS = new Set(['generated']);
const REMOVED_UTILITY = /\b(?:bg|text|border|divide|ring|placeholder)-opacity-(?:\d+|\[)/g;

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) out.push(...listFiles(full));
    } else if (/\.(ts|tsx|css)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function findRemovedUtilities(source: string): string[] {
  return [...source.matchAll(REMOVED_UTILITY)].map((match) => match[0]);
}

describe('Tailwind v4 opacity utilities', () => {
  it('recognises the removed utilities and leaves the supported forms alone', () => {
    expect(findRemovedUtilities('bg-black bg-opacity-50 hover:text-opacity-75 ring-opacity-5')).toEqual([
      'bg-opacity-50',
      'text-opacity-75',
      'ring-opacity-5',
    ]);
    expect(findRemovedUtilities('border-opacity-[0.3] divide-opacity-10 placeholder-opacity-0')).toHaveLength(3);
    expect(
      findRemovedUtilities('bg-black/50 ring-black/5 opacity-0 group-hover:opacity-100 transition-opacity')
    ).toEqual([]);
  });

  it('no file under src uses a removed *-opacity-<n> utility', () => {
    const files = listFiles(SRC);
    expect(files.length).toBeGreaterThan(50);

    const violations = files.flatMap((file) =>
      findRemovedUtilities(readFileSync(file, 'utf8')).map(
        (hit) => `${path.relative(ROOT, file).split(path.sep).join('/')}: ${hit}`
      )
    );

    expect(violations).toEqual([]);
  });
});
