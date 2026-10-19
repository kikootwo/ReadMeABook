/**
 * Component: Prisma CLI sub-lockfile generator — Tests
 * Documentation: documentation/deployment/unified.md
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildPrismaCliLock } = require('../../docker/unified/prisma-cli-lock.js') as {
  buildPrismaCliLock: (lock: unknown) => {
    version: string;
    names: string[];
    packageJson: { dependencies: Record<string, string> };
    lock: { lockfileVersion: number; packages: Record<string, Record<string, unknown>> };
  };
};

const appLock = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package-lock.json'), 'utf8'));

// The prisma CLI closure in the current lockfile, as install paths (two deps resolve to a nested copy).
// Changes only when prisma (or one of its deps) is bumped: update this list with the lockfile.
const EXPECTED_PATHS = [
  '@prisma/config', '@prisma/debug', '@prisma/engines', '@prisma/engines-version', '@prisma/fetch-engine',
  '@prisma/get-platform', '@standard-schema/spec', 'c12', 'chokidar', 'citty', 'confbox', 'consola',
  'deepmerge-ts', 'defu', 'destr', 'dotenv', 'effect', 'empathic', 'exsolve', 'fast-check', 'giget', 'jiti',
  'node-fetch-native', 'nypm', 'nypm/node_modules/citty', 'ohash', 'pathe', 'perfect-debounce', 'pkg-types',
  'pkg-types/node_modules/confbox', 'prisma', 'pure-rand', 'rc9', 'readdirp', 'tinyexec',
].map((p) => `node_modules/${p}`);

const entry = (extra: Record<string, unknown> = {}) => ({
  version: '1.0.0',
  resolved: 'https://registry.npmjs.org/x/-/x-1.0.0.tgz',
  integrity: 'sha512-abc',
  ...extra,
});

describe('buildPrismaCliLock (real package-lock.json)', () => {
  const result = buildPrismaCliLock(appLock);

  it('takes the prisma version from the lockfile', () => {
    expect(result.version).toBe(appLock.packages['node_modules/prisma'].version);
    expect(result.packageJson.dependencies).toEqual({ prisma: result.version });
    expect(result.lock.packages[''].dependencies).toEqual({ prisma: result.version });
  });

  it('contains exactly the prisma CLI closure (no optional peers such as typescript)', () => {
    expect(Object.keys(result.lock.packages).filter(Boolean).sort()).toEqual([...EXPECTED_PATHS].sort());
    expect(result.names).not.toContain('typescript');
  });

  it('copies version, resolved and integrity verbatim, all sha512 from registry.npmjs.org', () => {
    for (const [key, value] of Object.entries(result.lock.packages)) {
      if (key === '') continue;
      const src = appLock.packages[key];
      expect(value.version, key).toBe(src.version);
      expect(value.resolved, key).toBe(src.resolved);
      expect(value.integrity, key).toBe(src.integrity);
      expect(String(value.integrity), key).toMatch(/^sha512-/);
      expect(String(value.resolved), key).toMatch(/^https:\/\/registry\.npmjs\.org\//);
    }
  });

  it('strips app-tree role flags so npm ci installs every entry', () => {
    for (const [key, value] of Object.entries(result.lock.packages)) {
      expect(value.dev, key).toBeUndefined();
      expect(value.devOptional, key).toBeUndefined();
      expect(value.peer, key).toBeUndefined();
      expect(value.optional, key).toBeUndefined();
    }
    expect(result.lock.lockfileVersion).toBe(3);
  });

  it('every dependency edge of every entry resolves inside the sub-lock', () => {
    const keys = new Set(Object.keys(result.lock.packages));
    for (const [key, value] of Object.entries(result.lock.packages)) {
      if (key === '') continue;
      for (const dep of Object.keys((value.dependencies as Record<string, string>) || {})) {
        const nested = `${key}/node_modules/${dep}`;
        expect(keys.has(nested) || keys.has(`node_modules/${dep}`), `${key} -> ${dep}`).toBe(true);
      }
    }
  });
});

describe('buildPrismaCliLock (synthetic lockfiles)', () => {
  const lock = (packages: Record<string, unknown>) => ({ lockfileVersion: 3, packages: { '': {}, ...packages } });

  it('fails when prisma is not in the lockfile', () => {
    expect(() => buildPrismaCliLock(lock({}))).toThrow(/node_modules\/prisma" not found/);
  });

  it('fails on lockfile v1', () => {
    expect(() => buildPrismaCliLock({ lockfileVersion: 1, dependencies: {} })).toThrow(/lockfileVersion 2 or 3/);
  });

  it('fails on an unresolved required dependency', () => {
    expect(() =>
      buildPrismaCliLock(lock({ 'node_modules/prisma': entry({ dependencies: { missing: '^1' } }) })),
    ).toThrow(/unresolved dependency: node_modules\/prisma -> missing/);
  });

  it('fails on a non-optional peer that is absent, skips an optional one', () => {
    const peer = (optional: boolean) =>
      lock({
        'node_modules/prisma': entry({
          peerDependencies: { typescript: '>=5' },
          peerDependenciesMeta: { typescript: { optional } },
        }),
        'node_modules/typescript': entry(),
      });
    expect(buildPrismaCliLock(peer(true)).names).toEqual(['prisma']);
    expect(buildPrismaCliLock(peer(false)).names).toEqual(['prisma', 'typescript']);
    expect(() =>
      buildPrismaCliLock(lock({ 'node_modules/prisma': entry({ peerDependencies: { ts: '>=5' } }) })),
    ).toThrow(/unresolved dependency/);
  });

  it('prefers a nested copy over the hoisted one (npm lookup order)', () => {
    const result = buildPrismaCliLock(
      lock({
        'node_modules/prisma': entry({ dependencies: { a: '^1' } }),
        'node_modules/a': entry({ dependencies: { b: '^2' } }),
        'node_modules/a/node_modules/b': entry({ version: '2.0.0' }),
        'node_modules/b': entry({ version: '1.0.0' }),
      }),
    );
    expect(Object.keys(result.lock.packages).sort()).toEqual(
      ['', 'node_modules/a', 'node_modules/a/node_modules/b', 'node_modules/prisma'].sort(),
    );
  });

  it('keeps optional only for truly optional entries and skips absent optional deps', () => {
    const result = buildPrismaCliLock(
      lock({
        'node_modules/prisma': entry({ devOptional: true, optionalDependencies: { native: '1', gone: '1' } }),
        'node_modules/native': entry({ optional: true, os: ['linux'] }),
      }),
    );
    expect(result.lock.packages['node_modules/prisma'].devOptional).toBeUndefined();
    expect(result.lock.packages['node_modules/native'].optional).toBe(true);
    expect(result.names).toEqual(['native', 'prisma']);
  });

  it('fails on missing sha512 integrity or a non-registry resolved URL', () => {
    expect(() => buildPrismaCliLock(lock({ 'node_modules/prisma': entry({ integrity: 'sha1-abc' }) }))).toThrow(
      /no sha512 integrity/,
    );
    expect(() =>
      buildPrismaCliLock(lock({ 'node_modules/prisma': entry({ resolved: 'https://evil.example/p.tgz' }) })),
    ).toThrow(/does not resolve from/);
    expect(() => buildPrismaCliLock(lock({ 'node_modules/prisma': entry({ link: true }) }))).toThrow(/is a link/);
  });
});
