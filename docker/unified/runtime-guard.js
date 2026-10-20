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
// Next >= 16.4 (Turbopack) requires them through hashed aliases ("bcrypt-a3fecf8c027c10c9") that live as
// relative symlinks in .next/node_modules; either form counts, and an alias must land on the real package.
const EXPECTED_EXTERNALS = ['bcrypt', 'bull'];
const HASHED_ALIAS = /^(.+)-[0-9a-f]{16}$/;

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
  // The script's own helpers (side-effect free modules): each must be present and load.
  const libDir = path.join(APP, 'scripts/lib');
  const libs = fs.existsSync(libDir) ? fs.readdirSync(libDir).filter((f) => f.endsWith('.js')).sort() : [];
  for (const need of ['terminal-prompt.js', 'password-users.js']) if (!libs.includes(need)) fail(`missing /app/scripts/lib/${need}`);
  for (const lib of libs) {
    try {
      scriptRequire(path.join(libDir, lib));
    } catch (error) {
      fail(`/app/scripts/lib/${lib} does not load: ${error.message.split('\n')[0]}`);
    }
  }
  ok(`credential recovery loads its Prisma client, bcrypt and scripts/lib (${libs.join(', ')})`);
}

// Never shipped: the tracer sweeps in the whole project root (dynamic fs access in routes), and
// next.config.ts outputFileTracingExcludes keeps these out of .next/standalone.
const NOT_SHIPPED = [
  'src/app', 'src/components', 'src/contexts', 'src/hooks', 'src/lib', 'tests', 'e2e', 'screenshots',
  'documentation', 'docker', 'dockerfile.unified', 'package-lock.json', 'tsconfig.json',
];

function checkLayout() {
  const absent = ['server.js', 'prisma/schema.prisma', 'prisma/data-migrations', 'public', '.next/static', 'scripts/recover-credentials.js']
    .filter((rel) => !fs.existsSync(path.join(APP, rel)));
  const shipped = NOT_SHIPPED.filter((rel) => fs.existsSync(path.join(APP, rel)));
  for (const rel of absent) fail(`missing /app/${rel}`);
  if (shipped.length) fail(`non-runtime files in /app (check outputFileTracingExcludes in next.config.ts): ${shipped.join(', ')}`);
  if (!absent.length && !shipped.length) ok(`runtime layout present; none of ${NOT_SHIPPED.length} non-runtime paths shipped`);
}

/** bull 4 loads its Lua from lib/scripts/<name>-<keys>.js (precompiled copies of lib/commands/*.lua). */
function checkBullScripts() {
  const root = path.dirname(fs.realpathSync(createRequire(path.join(APP, 'server.js')).resolve('bull/package.json')));
  const commands = require(path.join(root, 'lib/scripts/index.js'));
  const names = Object.keys(commands);
  const bad = names.filter((n) => typeof commands[n]?.content !== 'string' || commands[n].content.length === 0 || typeof commands[n].keys !== 'number');
  if (names.length < 20) fail(`bull lib/scripts exports only ${names.length} commands`);
  if (bad.length) fail(`bull commands without Lua content: ${bad.join(', ')}`);
  // Optional cross-check: the .lua sources arrive only through a broad route trace and are not
  // loaded at runtime, so their absence is fine; when present, each must have its lib/scripts entry.
  const luaDir = path.join(root, 'lib/commands');
  const lua = fs.existsSync(luaDir) ? fs.readdirSync(luaDir).filter((f) => f.endsWith('.lua')).map((f) => f.slice(0, -4)) : [];
  const unmatched = lua.filter((n) => !names.includes(n));
  if (unmatched.length) fail(`bull lib/commands/*.lua without a lib/scripts entry: ${unmatched.join(', ')}`);
  ok(`bull ${names.length} Lua commands load (${lua.length ? `${lua.length} lib/commands/*.lua cross-checked` : 'lib/commands/*.lua not shipped, cross-check skipped'})`);
}

function checkServerRequires() {
  const builtins = new Set(builtinModules);
  const missing = new Map();
  const seen = new Set();
  const toLoad = new Map();
  let checked = 0;
  walk(path.join(APP, '.next/server'), (file) => {
    if (!file.endsWith('.js')) return;
    const req = createRequire(file);
    for (const [, spec] of fs.readFileSync(file, 'utf8').matchAll(/\brequire\(\s*["']([^"'./][^"']*)["']\s*\)/g)) {
      const bare = spec.replace(/^node:/, '');
      if (builtins.has(bare) || builtins.has(bare.split('/')[0])) continue;
      checked++;
      let resolved = null;
      try {
        resolved = fs.realpathSync(req.resolve(spec));
      } catch {
        const allowedIn = ALLOWED_UNRESOLVED.get(spec);
        if (!(allowedIn && allowedIn.test(path.basename(file)))) missing.set(spec, path.relative(APP, file));
      }
      // App externals (not Next's own runtime files) are also loaded, so a missing transitive
      // dependency fails here rather than on the first request that needs it.
      if (resolved && !spec.startsWith('next/') && !toLoad.has(spec)) toLoad.set(spec, { req, file });
      const alias = spec.match(HASHED_ALIAS);
      if (alias && resolved) {
        // A hashed alias must point at the real package under /app/node_modules.
        const pkgRoot = path.join(APP, 'node_modules', alias[1]) + path.sep;
        if (!resolved.startsWith(pkgRoot)) fail(`require("${spec}") resolves to ${resolved}, not ${pkgRoot}`);
        seen.add(alias[1]);
      }
      seen.add(spec);
    }
  });
  for (const [spec, file] of missing) fail(`unresolvable require("${spec}") in ${file}`);
  for (const spec of EXPECTED_EXTERNALS) if (!seen.has(spec)) fail(`no require("${spec}") (or a hashed alias of it) found in .next/server (scan is blind)`);
  ok(`${checked} bare require() calls (${seen.size} specifiers) in .next/server resolve`);
  for (const [spec, { req, file }] of toLoad) {
    try {
      req(spec);
    } catch (error) {
      fail(`require("${spec}") from ${path.relative(APP, file)} resolves but does not load: ${error.message.split('\n')[0]}`);
    }
  }
  ok(`${toLoad.size} app externals load: ${[...toLoad.keys()].join(', ')}`);
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
  // bcrypt 5: lib/binding/napi-v3/bcrypt_lib.node; bcrypt 6: prebuilds/linux-<arch>/bcrypt.{glibc,musl}.node
  if (!elves.some((f) => f.includes('/node_modules/bcrypt/') && f.endsWith('.node'))) fail('no bcrypt native binding (.node under node_modules/bcrypt/) found');
  ok(`${elves.length} ELF files match ${process.arch}:\n  ${elves.join('\n  ')}`);
}

try {
  checkLayout();
  checkPreflight();
  checkPrisma(prismaCliFromEntrypoint());
  checkRecovery();
  checkServerRequires();
  checkBullScripts();
  checkElfArch();
} catch (error) {
  fail(error.stack || String(error));
}
if (failures.length) {
  console.error(failures.map((f) => `ERROR: ${f}`).join('\n'));
  process.exit(1);
}
