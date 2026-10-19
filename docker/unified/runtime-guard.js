/**
 * Component: Unified image runtime guard (build-time only; bind-mounted by dockerfile.unified, never in a layer)
 * Documentation: documentation/deployment/unified.md
 *
 * Runs in the FINAL runtime stage under `RUN --network=none`. Fails the build when the runtime image
 * cannot apply its schema offline, cannot run credential recovery, misses a traced server dependency,
 * or carries a native binary for the wrong architecture.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- plain Node CommonJS build script */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { builtinModules, createRequire } = require('module');

const APP = '/app';
const ENTRYPOINT = '/entrypoint.sh';
const DUMMY_DB_URL = 'postgresql://dummy:dummy@localhost:5432/dummy?schema=public';
// ELF e_machine per Node arch (same bytes as the ffmpeg guard: 0x3e x86_64, 0xb7 aarch64).
const E_MACHINE = { x64: 0x3e, arm64: 0xb7 };
// Bare require("…") matches in .next/server that are allowed to be unresolvable, keyed by spec,
// limited to the chunk file name they may appear in. Each needs a reason.
const ALLOWED_UNRESOLVED = new Map([
  // Not a require: an HMR comment in Next's Turbopack runtime ("contains e.g. a `require("something")` call").
  ['something', /^\[turbopack\]_runtime\.js$/],
]);
// Server externals the app is known to load at runtime; their absence means the scan stopped seeing requires.
const EXPECTED_EXTERNALS = ['bcrypt', 'bull'];

const failures = [];
const fail = (msg) => failures.push(msg);
const ok = (msg) => console.log(`OK: ${msg}`);

function walk(dir, onFile) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, onFile);
    else if (ent.isFile()) onFile(full);
  }
}

/** The exact PRISMA_CLI the entrypoint runs (one assignment, no quoting tricks). */
function prismaCliFromEntrypoint() {
  const matches = [...fs.readFileSync(ENTRYPOINT, 'utf8').matchAll(/^PRISMA_CLI=(\S+)$/gm)];
  if (matches.length !== 1) throw new Error(`expected one PRISMA_CLI= line in ${ENTRYPOINT}, found ${matches.length}`);
  return matches[0][1];
}

/** Runs the entrypoint's own preflight block, so the guard and the start path cannot drift. */
function checkPreflight() {
  const text = fs.readFileSync(ENTRYPOINT, 'utf8');
  const block = (text.match(/^# >>> prisma-cli-preflight[^\n]*\n([\s\S]*?)^# <<< prisma-cli-preflight/m) || [])[1];
  if (!block || !/^PRISMA_CLI=/m.test(block) || !/exit 1/.test(block)) {
    throw new Error(`prisma-cli-preflight block not found (or incomplete) in ${ENTRYPOINT}`);
  }
  execFileSync('bash', ['-c', `set -eu\n${block}`], { stdio: 'inherit' });
  ok('entrypoint Prisma CLI preflight passes');
}

function checkPrisma(cli) {
  const real = fs.realpathSync(cli);
  if (!real.endsWith('/node_modules/prisma/build/index.js')) fail(`${cli} resolves to ${real}, not prisma/build/index.js`);
  if (fs.lstatSync(cli).isSymbolicLink()) ok(`${cli} -> ${real}`);
  else fail(`${cli} is not a symlink (a lone COPY flattens it and the CLI cannot find its wasm)`);

  const env = { ...process.env, CHECKPOINT_DISABLE: '1' };
  const out = execFileSync(cli, ['--version'], { cwd: APP, env, encoding: 'utf8' });
  const field = (label) => (out.match(new RegExp(`^${label}\\s*:\\s*(.+)$`, 'm')) || [])[1]?.trim();
  const cliVersion = field('prisma');
  const defaultHash = field('Default Engines Hash');
  const schemaEngine = field('Schema Engine') || '';

  const { Prisma } = require(path.join(APP, 'src/generated/prisma'));
  const { enginesVersion } = require(path.join(APP, 'node_modules/@prisma/engines-version'));
  const client = Prisma.prismaVersion;
  if (cliVersion !== client.client) fail(`prisma CLI ${cliVersion} != generated client ${client.client}`);
  if (enginesVersion !== client.engine) fail(`@prisma/engines-version ${enginesVersion} != client engine ${client.engine}`);
  if (defaultHash !== client.engine) fail(`CLI engines hash ${defaultHash} != client engine ${client.engine}`);
  if (!schemaEngine.includes(client.engine)) fail(`schema engine "${schemaEngine}" is not build ${client.engine}`);
  ok(`prisma CLI ${cliVersion}, client ${client.client}, engines ${client.engine}`);

  // Exercises the schema-engine binary for real (no database, no network).
  const sql = execFileSync(
    cli,
    ['migrate', 'diff', '--from-empty', '--to-schema-datamodel', path.join(APP, 'prisma/schema.prisma'), '--script'],
    { cwd: APP, env: { ...env, DATABASE_URL: DUMMY_DB_URL }, encoding: 'utf8' },
  );
  if (!/CREATE TABLE/.test(sql)) fail('prisma migrate diff --from-empty produced no CREATE TABLE');
  else ok(`schema engine rendered ${sql.match(/CREATE TABLE/g).length} tables offline`);
}

function checkRecovery() {
  const scriptRequire = createRequire(path.join(APP, 'scripts/recover-credentials.js'));
  // Same path the recovery script loads first.
  scriptRequire(path.join(APP, 'scripts', '..', 'src', 'generated', 'prisma', 'client'));
  const bcrypt = scriptRequire('bcrypt');
  if (!bcrypt.compareSync('guard', bcrypt.hashSync('guard', 4))) fail('bcrypt round-trip failed');
  const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
  if (pkg.scripts?.['rmab:recover'] !== 'node scripts/recover-credentials.js') fail('package.json lacks rmab:recover');
  ok('credential recovery loads its Prisma client and bcrypt');
}

function checkLayout() {
  for (const rel of ['server.js', 'prisma/schema.prisma', 'prisma/data-migrations', 'public', '.next/static', 'scripts/recover-credentials.js']) {
    if (!fs.existsSync(path.join(APP, rel))) fail(`missing /app/${rel}`);
  }
  ok('runtime layout present');
}

function checkServerRequires() {
  const builtins = new Set(builtinModules);
  const missing = new Map();
  const seen = new Set();
  let checked = 0;
  walk(path.join(APP, '.next/server'), (file) => {
    if (!file.endsWith('.js')) return;
    const req = createRequire(file);
    for (const [, spec] of fs.readFileSync(file, 'utf8').matchAll(/\brequire\(\s*["']([^"'./][^"']*)["']\s*\)/g)) {
      const bare = spec.replace(/^node:/, '');
      if (builtins.has(bare) || builtins.has(bare.split('/')[0])) continue;
      checked++;
      seen.add(spec);
      try {
        req.resolve(spec);
      } catch {
        const allowedIn = ALLOWED_UNRESOLVED.get(spec);
        if (!(allowedIn && allowedIn.test(path.basename(file)))) missing.set(spec, path.relative(APP, file));
      }
    }
  });
  for (const [spec, file] of missing) fail(`unresolvable require("${spec}") in ${file}`);
  for (const spec of EXPECTED_EXTERNALS) if (!seen.has(spec)) fail(`no require("${spec}") found in .next/server (scan is blind)`);
  ok(`${checked} bare require() calls (${seen.size} specifiers) in .next/server resolve`);
}

function checkElfArch() {
  const want = E_MACHINE[process.arch];
  if (want === undefined) throw new Error(`unsupported arch ${process.arch}`);
  const elves = [];
  const inspect = (file) => {
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(20);
    const n = fs.readSync(fd, head, 0, 20, 0);
    fs.closeSync(fd);
    if (n < 20 || head.readUInt32BE(0) !== 0x7f454c46) return;
    const machine = head.readUInt16LE(18);
    elves.push(file);
    if (machine !== want) fail(`${file}: e_machine 0x${machine.toString(16)}, expected 0x${want.toString(16)} for ${process.arch}`);
  };
  walk(APP, inspect);
  ['/usr/local/bin/ffmpeg', '/usr/local/bin/ffprobe'].forEach(inspect);
  const count = (re) => elves.filter((f) => re.test(path.basename(f))).length;
  if (count(/^schema-engine-/) !== 1) fail(`expected 1 schema-engine ELF, found ${count(/^schema-engine-/)}`);
  if (count(/^libquery_engine-.*\.so\.node$/) < 2) fail('expected the CLI and generated-client libquery_engine copies');
  if (count(/^bcrypt_lib\.node$/) < 1) fail('bcrypt_lib.node not found');
  ok(`${elves.length} ELF files match ${process.arch}:\n  ${elves.join('\n  ')}`);
}

try {
  checkLayout();
  checkPreflight();
  checkPrisma(prismaCliFromEntrypoint());
  checkRecovery();
  checkServerRequires();
  checkElfArch();
} catch (error) {
  fail(error.stack || String(error));
}
if (failures.length) {
  console.error(failures.map((f) => `ERROR: ${f}`).join('\n'));
  process.exit(1);
}
