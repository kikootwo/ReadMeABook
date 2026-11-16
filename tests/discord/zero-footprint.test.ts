/**
 * Component: Discord Zero-Footprint Tests
 * Documentation: documentation/integrations/discord-bot.md
 *
 * With the bot off, the web paths that later PRs hook into (approve, deny, cancel,
 * admin delete, app init) and the request creators /request shares must never load discord.js or a bot module. Static part:
 * walk each entry's import graph and allow only the running-check facade. Runtime
 * part: the facade does nothing (no import) while the bot is not running and never
 * makes its caller wait.
 */

import fs from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'src');

const ENTRIES = [
  'src/app/api/admin/requests/[id]/approve/route.ts',
  'src/app/api/requests/[id]/route.ts',
  'src/app/api/requests/[id]/cancel/route.ts',
  'src/lib/services/request-cancel.service.ts',
  'src/app/api/admin/requests/[id]/route.ts',
  'src/lib/services/request-delete.service.ts',
  'src/lib/startup/app-init.ts',
  'src/lib/startup/shutdown-coordinator.ts',
  // Shared with /request: the web request paths never reach the bot's handlers
  'src/app/api/requests/route.ts',
  'src/lib/services/request-creator.service.ts',
  'src/app/api/audiobooks/[asin]/fetch-ebook/route.ts',
  'src/lib/services/ebook-request-creator.service.ts',
];

/** Modules a core path may import: the facade (it loads the bot lazily, when running), the actor resolver and the ID check. */
const ALLOWED_DISCORD_MODULES = new Set([
  'src/lib/services/discord/discord-runtime.ts',
  'src/lib/services/discord/discord-actor.ts',
  'src/lib/services/discord/discord-snowflake.ts',
]);

/** Static import/export, and import() or require() with a quoted or plain template-literal specifier. */
const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|(?:import|require)\(\s*(?:['"]([^'"]+)['"]|`([^`$]+)`)\s*\)/g;

function resolveModule(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Every file reachable from `entry` through static and dynamic imports, plus bare package specifiers. */
function importGraph(entry: string) {
  const files = new Set<string>();
  const packages = new Map<string, string>();
  const discordModules = new Map<string, string>();
  const stack = [path.join(ROOT, entry)];
  while (stack.length) {
    const file = stack.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    // The facade itself is the boundary: what it loads lazily is not part of the core path
    if (rel === 'src/lib/services/discord/discord-runtime.ts') continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(IMPORT_RE)) {
      const spec = match[1] ?? match[2] ?? match[3];
      const resolved = resolveModule(spec, file);
      if (!resolved) {
        packages.set(spec, rel);
        continue;
      }
      const resolvedRel = path.relative(ROOT, resolved).replace(/\\/g, '/');
      if (resolvedRel.startsWith('src/lib/services/discord/')) discordModules.set(resolvedRel, rel);
      stack.push(resolved);
    }
  }
  return { files, packages, discordModules };
}

describe('Discord zero footprint: core web paths', () => {
  it.each(ENTRIES)('%s never imports discord.js or a bot module', (entry) => {
    expect(fs.existsSync(path.join(ROOT, entry))).toBe(true);
    const { files, packages, discordModules } = importGraph(entry);

    expect(files.size).toBeGreaterThan(1);
    expect([...packages.keys()].filter((p) => p === 'discord.js' || p.startsWith('@discordjs/'))).toEqual([]);
    const disallowed = [...discordModules.keys()].filter((m) => !ALLOWED_DISCORD_MODULES.has(m));
    expect(disallowed).toEqual([]);
  });

  it.each([
    ["require('discord.js')", 'discord.js'],
    ['require("@discordjs/rest")', '@discordjs/rest'],
    ['await import(`discord.js`)', 'discord.js'],
    ["const x = await import( './discord-bot.service' )", './discord-bot.service'],
  ])('the import pattern catches %s', (source, spec) => {
    expect([...source.matchAll(IMPORT_RE)].map((m) => m[1] ?? m[2] ?? m[3])).toEqual([spec]);
  });

  it('the walker sees the bot module when it is imported (control)', () => {
    const { discordModules } = importGraph('src/app/api/admin/settings/discord/route.ts');
    expect([...discordModules.keys()]).toContain('src/lib/services/discord/discord-bot.service.ts');
  });

  it('the walker reaches the /request handlers through the bot (control)', () => {
    const { discordModules } = importGraph('src/lib/services/discord/discord-bot.service.ts');
    expect([...discordModules.keys()]).toEqual(
      expect.arrayContaining([
        'src/lib/services/discord/request/discord-request-handlers.ts',
        'src/lib/services/discord/request/discord-request-access.ts',
        'src/lib/services/discord/discord-custom-id.ts',
        'src/lib/services/discord/discord-book-embed.ts',
      ])
    );
  });

  // A value import or re-export, a side-effect import, or a require of discord.js (a lazy import() is fine)
  const VALUE_IMPORT_RE =
    /^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+['"]discord\.js['"]|^\s*import\s+['"]discord\.js['"]|\brequire\s*\(\s*['"]discord\.js['"]\s*\)/m;

  it('no Discord module imports a discord.js value at load (only types and lazy imports)', () => {
    const discordDir = path.join(SRC, 'lib/services/discord');
    const files = fs.readdirSync(discordDir, { recursive: true }).map(String).filter((f) => f.endsWith('.ts'));
    const valueImports = files.filter((file) =>
      VALUE_IMPORT_RE.test(fs.readFileSync(path.join(discordDir, file), 'utf8'))
    );
    expect(files.length).toBeGreaterThan(5);
    expect(valueImports).toEqual([]);
    // The pattern itself: a value import matches, a type-only import does not
    expect(VALUE_IMPORT_RE.test("import { Client } from 'discord.js';")).toBe(true);
    expect(VALUE_IMPORT_RE.test("import type { Client } from 'discord.js';")).toBe(false);
  });

  it('the value-import pattern also catches re-exports, side-effect imports and require()', () => {
    expect(VALUE_IMPORT_RE.test("export { Client } from 'discord.js';")).toBe(true);
    expect(VALUE_IMPORT_RE.test("export * from 'discord.js';")).toBe(true);
    expect(VALUE_IMPORT_RE.test("export type { Client } from 'discord.js';")).toBe(false);
    expect(VALUE_IMPORT_RE.test("import 'discord.js';")).toBe(true);
    expect(VALUE_IMPORT_RE.test("const discord = require('discord.js');")).toBe(true);
    expect(VALUE_IMPORT_RE.test("const discord = await import('discord.js');")).toBe(false);
  });
});

const botModule = vi.hoisted(() => ({ evaluated: 0, run: vi.fn() }));
vi.mock('@/lib/services/discord/discord-bot.service', () => {
  botModule.evaluated++;
  return { getDiscordBotService: () => ({ marker: 'service' }) };
});
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

describe('Discord zero footprint: the running-check facade', () => {
  beforeEach(() => {
    vi.resetModules();
    botModule.evaluated = 0;
    botModule.run.mockReset();
    delete (globalThis as Record<symbol, unknown>)[Symbol.for('rmab.singleton.discord-runtime')];
  });

  it('bot not running: syncDiscord does not import the bot module or call the callback', async () => {
    const { syncDiscord, isDiscordBotRunning } = await import('@/lib/services/discord/discord-runtime');

    expect(isDiscordBotRunning()).toBe(false);
    syncDiscord('test', botModule.run);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(botModule.evaluated).toBe(0);
    expect(botModule.run).not.toHaveBeenCalled();
  });

  it('bot running: the callback gets the service; a callback that never settles does not block the caller', async () => {
    const runtime = await import('@/lib/services/discord/discord-runtime');
    runtime.setDiscordBotRunning(true);
    botModule.run.mockReturnValue(new Promise(() => undefined));

    const started = Date.now();
    const result = runtime.syncDiscord('test', botModule.run);
    expect(result).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(50);

    await vi.waitFor(() => expect(botModule.run).toHaveBeenCalledWith({ marker: 'service' }));
  });

  it('bot running: a throwing callback never reaches the caller', async () => {
    const runtime = await import('@/lib/services/discord/discord-runtime');
    runtime.setDiscordBotRunning(true);
    botModule.run.mockRejectedValue(new Error('Discord is down'));
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    expect(() => runtime.syncDiscord('test', botModule.run)).not.toThrow();
    await vi.waitFor(() => expect(botModule.run).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 10));
    process.off('unhandledRejection', unhandled);

    expect(unhandled).not.toHaveBeenCalled();
  });
});
