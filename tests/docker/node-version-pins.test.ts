/**
 * Component: Node version pins stay on one major (image stages, e2e images, CI, @types/node) — Tests
 * Documentation: documentation/deployment/unified.md
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

// e2e/Dockerfile.test's build context leaves out .github/ and e2e/, so the containerized unit suite
// can't see these files. Skip them there with a reason, but never on GitHub Actions (full checkout).
// (Not CI: Dockerfile.test itself sets CI=true.)
const onGitHubActions = process.env.GITHUB_ACTIONS === 'true';

interface Pin {
  /** e.g. `node:24-bookworm@sha256:…`, with any `docker.io/library/` prefix removed */
  image: string;
  stage?: string;
  line: number;
  text: string;
}

const lineAt = (text: string, index: number) => text.slice(0, index).split('\n').length;

// Any spelling of an official node image: `FROM [--platform=…] [docker.io/library/]node:<tag> [AS <stage>]`.
const NODE_FROM = /^FROM\s+(?:--platform=\S+\s+)?(?:docker\.io\/library\/)?(node:\S+)(?:\s+AS\s+(\S+))?[ \t]*$/gim;

function nodeFroms(text: string): Pin[] {
  return [...text.matchAll(NODE_FROM)].map((m) => ({
    image: m[1],
    stage: m[2],
    line: lineAt(text, m.index ?? 0),
    text: m[0].trim(),
  }));
}

// node:24, node:24-bookworm, node:24.11.1-bookworm, node:24@sha256:…
function majorOf(image: string): number | undefined {
  const m = image.match(/^node:(\d+)(?:\.\d+){0,2}(?:[-@]|$)/);
  return m ? Number(m[1]) : undefined;
}

interface Found {
  major: number | undefined;
  line: number;
  text: string;
}

const fromPins = (text: string): Found[] => nodeFroms(text).map((p) => ({ major: majorOf(p.image), line: p.line, text: p.text }));

const workflowPins = (text: string): Found[] =>
  [...text.matchAll(/node-version:\s*['"]?(\d+)[^\n]*/g)].map((m) => ({
    major: Number(m[1]),
    line: lineAt(text, m.index ?? 0),
    text: m[0].trim(),
  }));

function typesNodePins(text: string): Found[] {
  const spec: string | undefined = JSON.parse(text).devDependencies?.['@types/node'];
  if (spec === undefined) return [];
  const m = spec.match(/^[~^]?(\d+)/);
  return [{ major: m ? Number(m[1]) : undefined, line: lineAt(text, text.indexOf('"@types/node"')), text: `"@types/node": "${spec}"` }];
}

// The image's major is the reference every other pin must match.
const UNIFIED = 'dockerfile.unified';
const unifiedText = read(UNIFIED);
const unifiedFroms = nodeFroms(unifiedText);
const imageMajor = majorOf(unifiedFroms[0]?.image ?? '');
if (imageMajor === undefined) throw new Error(`${UNIFIED}: no FROM node:<major>… stage found`);

const PINNED_FILES: { file: string; pins: (text: string) => Found[]; digest: boolean }[] = [
  { file: 'e2e/Dockerfile.test', pins: fromPins, digest: true },
  { file: 'e2e/fake-arr/Dockerfile', pins: fromPins, digest: true },
  { file: '.github/workflows/pr-ci.yml', pins: workflowPins, digest: false },
  { file: '.github/workflows/run-tests.yml', pins: workflowPins, digest: false },
  // @types/node must describe the runtime it type-checks for.
  { file: 'package.json', pins: typesNodePins, digest: false },
];

describe('Node version pins', () => {
  it(`${UNIFIED}: base, builder and prisma-cli all use the same node:<major>-bookworm image`, () => {
    const where = (p: Pin) => `${UNIFIED}:${p.line}: ${p.text}`;
    expect(unifiedFroms.length, `${UNIFIED}: expected exactly 3 node stages, found ${unifiedFroms.map(where).join(' | ')}`).toBe(3);
    expect(unifiedFroms.map((p) => p.stage?.toLowerCase()), `${UNIFIED}: node stages`).toEqual(['base', 'builder', 'prisma-cli']);
    for (const p of unifiedFroms) {
      expect(p.image, `${where(p)} differs from ${unifiedFroms[0].image}`).toBe(unifiedFroms[0].image);
      expect(p.image, `${where(p)} is not a node:<version>-bookworm image`).toMatch(
        /^node:\d+(?:\.\d+){0,2}-bookworm(?:@sha256:[0-9a-f]{64})?$/,
      );
    }
  });

  for (const { file, pins, digest } of PINNED_FILES) {
    it(`${file} uses Node ${imageMajor}`, ({ skip }) => {
      if (!fs.existsSync(path.join(root, file))) {
        if (onGitHubActions) throw new Error(`${file} is missing on GitHub Actions`);
        const reason = `${file} is not in this checkout (e2e/Dockerfile.test build context); checked on GitHub Actions and host runs`;
        console.warn(`[node-version-pins] skipped: ${reason}`);
        skip(reason);
        return;
      }
      const text = read(file);
      const found = pins(text);
      expect(found.length, `${file}: no Node version pin found`).toBeGreaterThan(0);
      for (const f of found) {
        expect(f.major, `${file}:${f.line}: ${f.text} — expected Node ${imageMajor} (the ${UNIFIED} major)`).toBe(imageMajor);
      }
      if (digest) {
        for (const p of nodeFroms(text)) {
          expect(p.image, `${file}:${p.line}: ${p.text} — must be pinned by @sha256 digest`).toMatch(/@sha256:[0-9a-f]{64}$/);
        }
      }
    });
  }
});
