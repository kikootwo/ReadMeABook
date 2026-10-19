/**
 * Component: E2E unit image: trusted Prisma engine fetch (the only network step after npm ci)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Runs inside the e2e:unit image build from the TRUSTED harness (BuildKit named context), never from
 * the branch. It reads one data value from the branch's installed packages (the Prisma engines commit
 * hash, validated as 40 hex chars), downloads the schema engine and query engine library from Prisma's
 * CDN, verifies each against its published .sha256, and writes them to <out>. No branch code runs.
 *
 * Usage: node fetch-prisma-engines.mjs <node_modules dir> <out dir>
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';

const [nodeModules, out] = process.argv.slice(2);
if (!nodeModules || !out) {
  console.error('usage: fetch-prisma-engines.mjs <node_modules> <out>');
  process.exit(2);
}

const pkg = JSON.parse(fs.readFileSync(path.join(nodeModules, '@prisma', 'engines-version', 'package.json'), 'utf8'));
const hash = pkg?.prisma?.enginesVersion;
if (!/^[0-9a-f]{40}$/.test(String(hash))) {
  console.error(`refusing engines version ${JSON.stringify(hash)} (expected 40 hex chars)`);
  process.exit(2);
}
const platform = { x64: 'debian-openssl-3.0.x', arm64: 'linux-arm64-openssl-3.0.x' }[process.arch];
if (!platform) {
  console.error(`unsupported arch ${process.arch}`);
  process.exit(2);
}

const base = `https://binaries.prisma.sh/all_commits/${hash}/${platform}`;
const engines = [
  { remote: 'schema-engine.gz', local: 'schema-engine', mode: 0o755 },
  { remote: 'libquery_engine.so.node.gz', local: `libquery_engine-${platform}.so.node`, mode: 0o644 },
];

async function get(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (error) {
      if (attempt >= 4) throw new Error(`${url}: ${error.message}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

fs.mkdirSync(out, { recursive: true });
for (const e of engines) {
  const gz = await get(`${base}/${e.remote}`);
  const expected = (await get(`${base}/${e.remote}.sha256`)).toString('utf8').trim().split(/\s+/)[0];
  const actual = createHash('sha256').update(gz).digest('hex');
  if (!/^[0-9a-f]{64}$/.test(expected) || expected !== actual) {
    console.error(`${e.remote}: sha256 mismatch (expected ${expected}, got ${actual})`);
    process.exit(1);
  }
  const file = path.join(out, e.local);
  fs.writeFileSync(file, zlib.gunzipSync(gz));
  fs.chmodSync(file, e.mode);
  console.log(`[prisma-engines] ${e.local} ${actual.slice(0, 12)} ok`);
}
