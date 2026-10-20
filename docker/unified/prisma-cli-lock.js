/**
 * Component: Prisma CLI sub-lockfile generator (build-time only, never copied into the runtime image)
 * Documentation: documentation/deployment/unified.md
 *
 * Usage: node prisma-cli-lock.js <package-lock.json> <out-dir>
 * Writes <out-dir>/package.json + <out-dir>/package-lock.json holding ONLY the `prisma` CLI and its
 * transitive dependencies, copied verbatim (version, resolved, integrity) from the app lockfile, so
 * `npm ci` installs exactly the locked bytes. The prisma version comes from the lockfile, never
 * from a hardcoded value. Optional peer edges are skipped; any unresolved edge is a hard error.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- plain Node CommonJS build script */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = 'node_modules/prisma';
const REGISTRY = 'https://registry.npmjs.org/';
// Flags that describe the package's role in the APP tree; inside the sub-tree every entry is prod.
const STRIP_FLAGS = ['dev', 'devOptional', 'peer'];

/** npm lookup: <from>/node_modules/<name>, then each ancestor's node_modules, then the root. */
function resolveEdge(packages, from, name) {
  let base = from;
  for (;;) {
    const candidate = `${base ? `${base}/` : ''}node_modules/${name}`;
    if (packages[candidate]) return candidate;
    if (!base) return null;
    const cut = base.lastIndexOf('/node_modules/');
    base = cut < 0 ? '' : base.slice(0, cut);
  }
}

/** Edges npm would install for this entry: [name, required]. Optional peers are skipped. */
function edgesOf(entry) {
  const edges = [];
  for (const name of Object.keys(entry.dependencies || {})) edges.push([name, true]);
  for (const name of Object.keys(entry.optionalDependencies || {})) edges.push([name, false]);
  const peerMeta = entry.peerDependenciesMeta || {};
  for (const name of Object.keys(entry.peerDependencies || {})) {
    if (!(peerMeta[name] && peerMeta[name].optional)) edges.push([name, true]);
  }
  return edges;
}

function buildPrismaCliLock(appLock) {
  if (!appLock || typeof appLock !== 'object' || !(appLock.lockfileVersion >= 2) || !appLock.packages) {
    throw new Error('package-lock.json must be lockfileVersion 2 or 3 with a "packages" map');
  }
  const packages = appLock.packages;
  const root = packages[ROOT];
  if (!root || !root.version) throw new Error(`"${ROOT}" not found in package-lock.json`);

  const included = new Set();
  const queue = [ROOT];
  while (queue.length) {
    const key = queue.shift();
    if (included.has(key)) continue;
    included.add(key);
    for (const [name, required] of edgesOf(packages[key])) {
      const target = resolveEdge(packages, key, name);
      if (target) queue.push(target);
      else if (required) throw new Error(`unresolved dependency: ${key} -> ${name}`);
    }
  }

  const outPackages = {
    '': { name: 'rmab-prisma-cli', dependencies: { prisma: root.version } },
  };
  for (const key of [...included].sort()) {
    const src = packages[key];
    if (src.link) throw new Error(`${key} is a link; refusing a non-registry package`);
    if (typeof src.integrity !== 'string' || !src.integrity.startsWith('sha512-')) {
      throw new Error(`${key} has no sha512 integrity in package-lock.json`);
    }
    if (typeof src.resolved !== 'string' || !src.resolved.startsWith(REGISTRY)) {
      throw new Error(`${key} does not resolve from ${REGISTRY}`);
    }
    const entry = { ...src };
    const wasOptionalOnly = src.optional === true && !src.devOptional;
    for (const flag of STRIP_FLAGS) delete entry[flag];
    if (!wasOptionalOnly) delete entry.optional;
    outPackages[key] = entry;
  }

  return {
    version: root.version,
    names: [...included].map((key) => key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length)).sort(),
    packageJson: { name: 'rmab-prisma-cli', private: true, dependencies: { prisma: root.version } },
    lock: { name: 'rmab-prisma-cli', lockfileVersion: 3, requires: true, packages: outPackages },
  };
}

function main(argv) {
  const [lockPath, outDir] = argv;
  if (!lockPath || !outDir) throw new Error('usage: node prisma-cli-lock.js <package-lock.json> <out-dir>');
  const result = buildPrismaCliLock(JSON.parse(fs.readFileSync(lockPath, 'utf8')));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'package.json'), `${JSON.stringify(result.packageJson, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'package-lock.json'), `${JSON.stringify(result.lock, null, 2)}\n`);
  console.log(`prisma ${result.version}: ${result.names.length} packages from the lockfile`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { buildPrismaCliLock, resolveEdge };
