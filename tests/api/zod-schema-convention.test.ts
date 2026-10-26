/**
 * Component: Zod Schema Convention Test
 * Documentation: documentation/backend/validation.md
 *
 * Request arrays go through boundedArray (src/lib/utils/zod-validation.ts), which checks the length
 * before any element is parsed; zod's own max check only covers a leading .max() on an array.
 * Caught in src/ (outside zod-validation.ts): z.array/z.set/z.map/z.tuple (also z?.x, z['x'], split
 * across lines), the .array() schema method, import/export-from statements on 'zod' other than
 * `import { z } from 'zod'` (named builders, namespace or default imports), and any zod subpath
 * (zod/v3, zod/v4, zod/compile, ...) in import, export-from, require() or import().
 */

import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const ALLOWED = new Set(['src/lib/utils/zod-validation.ts']);
const SKIPPED_DIRS = new Set(['generated']);

const PATTERNS: RegExp[] = [
  // z.array(  z?.set(  z.map (  z['tuple'](
  /\bz\??\.(?:array|set|map|tuple)\(/,
  /\bz\??\.?\[['"`](?:array|set|map|tuple)['"`]\]/,
  // z.string().array()
  /\.array\(\)/,
  // any zod subpath: 'zod/v3', "zod/v4", `zod/compile`
  /['"`]zod\/[^'"`]*['"`]/,
  // a zod import other than `import { z } from 'zod'` (also `export ... from 'zod'`)
  /\b(?:import|export)(?!\{z\}from['"`]zod['"`])(?:type)?[^;'"`]*from['"`]zod['"`]/,
];

/** Source with whitespace collapsed and removed around punctuation, so split calls match. */
function normalise(source: string): string {
  return source
    .replace(/\s+/g, ' ')
    .replace(/ ?(\?\.|[.()[\]{}=,:;]) ?/g, '$1')
    .replace(/\b(import|export|from|type) ?/g, '$1');
}

function findViolations(source: string): string[] {
  const text = normalise(source);
  const hits: string[] = [];
  for (const pattern of PATTERNS) {
    for (const match of text.matchAll(new RegExp(pattern.source, 'g'))) {
      hits.push(text.slice(Math.max(0, match.index! - 30), match.index! + match[0].length + 10));
    }
  }
  return hits;
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) out.push(...listFiles(full));
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('zod schema conventions', () => {
  it('use boundedArray for arrays and import only { z } from the root zod package', () => {
    const offenders: string[] = [];
    for (const file of listFiles(path.join(ROOT, 'src'))) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      if (ALLOWED.has(rel)) continue;
      for (const hit of findViolations(readFileSync(file, 'utf8'))) offenders.push(`${rel}: ...${hit}...`);
    }
    expect(offenders).toEqual([]);
  });

  it('scans the zod importers (sanity check on the file walk)', () => {
    const importers = listFiles(path.join(ROOT, 'src')).filter((file) => readFileSync(file, 'utf8').includes("from 'zod'"));
    expect(importers.length).toBeGreaterThan(20);
    expect(importers.map((file) => path.relative(ROOT, file).replace(/\\/g, '/'))).toContain('src/lib/utils/zod-validation.ts');
    expect(importers.filter((file) => readFileSync(file, 'utf8').includes('boundedArray(')).length).toBeGreaterThan(2);
  });

  it.each([
    'const Body = z.object({ ids: z.array(z.string()).max(10) });',
    'z\n  .array(z.string())',
    'z?.set(z.string())',
    'z.map(z.string(), z.number())',
    'z.tuple([z.string()])',
    "z['array'](z.string())",
    'z.string().array()',
    "import { z } from 'zod/v4';",
    "import { z } from 'zod/v3';",
    "import 'zod/compile';",
    "const { z } = require('zod/v4');",
    "await import('zod/mini')",
    "export { z } from 'zod/v4';",
    "import { array } from 'zod';",
    "import * as zod from 'zod';",
    "import zod from 'zod';",
    "import { z, array } from 'zod';",
    "import {\n  z as zz,\n} from 'zod';",
    "import type { ZodType } from 'zod';",
  ])('catches %j', (line) => {
    expect(findViolations(line)).not.toEqual([]);
  });

  it.each([
    "import { z } from 'zod';",
    "import {\n  z\n} from 'zod';",
    'items: boundedArray(z.string(), 10, { min: 1 }),',
    "import { boundedArray } from '@/lib/utils/zod-validation';",
    "import { fromZodError } from 'zod-validation-error';",
    'const ids = Array.from(set); map.set(key, value); list.map((x) => x);',
    'z.record(z.string(), z.any())',
  ])('ignores %j', (line) => {
    expect(findViolations(line)).toEqual([]);
  });
});
