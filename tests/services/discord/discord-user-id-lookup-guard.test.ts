/**
 * Component: Discord User ID Lookup Guard Test
 * Documentation: documentation/backend/services/auth.md
 *
 * A Discord user ID resolves to an account only through resolveDiscordActor
 * (src/lib/services/discord/discord-actor.ts), which applies the account refusal.
 * Scans every .ts/.tsx file under src/ (except the generated Prisma client in src/generated)
 * and fails on:
 *   - `discordUserId` inside a `where` object (`where: { ... }` or `const where = { ... }`,
 *     nested objects and arrays included), and
 *   - the raw column name `discord_user_id` (raw SQL).
 * A tripwire for the direct forms, not a proof. Not caught: a where object built under
 * another variable name, a typed declaration (`const where: Prisma.UserWhereInput = { ... }`),
 * or a property assignment (`where.discordUserId = ...`).
 */

import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const ALLOWED = new Set(['src/lib/services/discord/discord-actor.ts']);
const SKIPPED_DIRS = new Set([path.join(ROOT, 'src', 'generated')]);

/** The text of the `{ ... }` object that opens at `start`, braces balanced. */
function objectAt(source: string, start: number): string {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  return source.slice(start);
}

/** Lookups of an account by Discord user ID in one source file. */
function findDiscordIdLookups(source: string): string[] {
  const hits: string[] = [];
  for (const match of source.matchAll(/\bwhere\s*[:=]\s*\{/g)) {
    const object = objectAt(source, match.index! + match[0].length - 1);
    if (/\bdiscordUserId\b/.test(object)) hits.push(object.replace(/\s+/g, ' ').slice(0, 120));
  }
  if (/\bdiscord_user_id\b/.test(source)) hits.push('raw column discord_user_id');
  return hits;
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(full)) out.push(...listFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('Discord user ID lookups', () => {
  it('flags discordUserId in a where object (nested too) and the raw column, and nothing else', () => {
    expect(findDiscordIdLookups('prisma.user.findFirst({ where: { OR: [{ id }, { discordUserId: x }] } })')).toHaveLength(1);
    expect(findDiscordIdLookups('const where = { discordUserId };')).toHaveLength(1);
    expect(findDiscordIdLookups('prisma.$queryRawUnsafe("select id from users where discord_user_id = $1", x)')).toHaveLength(1);
    expect(findDiscordIdLookups([
      'prisma.user.updateMany({ where: { id, deletedAt: null }, data: { discordUserId } })',
      'prisma.user.findMany({ where: { role: "user" }, select: { discordUserId: true } })',
    ].join('\n'))).toEqual([]);
  });

  it('happen only in resolveDiscordActor', () => {
    const offenders: string[] = [];
    const files = listFiles(path.join(ROOT, 'src'));
    for (const file of files) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      if (ALLOWED.has(rel)) continue;
      for (const hit of findDiscordIdLookups(readFileSync(file, 'utf8'))) offenders.push(`${rel}: ${hit}`);
    }
    expect(files.length).toBeGreaterThan(100);
    // The scan sees the resolver's own lookup, so a miss elsewhere is not a blind scanner
    expect(findDiscordIdLookups(readFileSync(path.join(ROOT, 'src/lib/services/discord/discord-actor.ts'), 'utf8'))).toHaveLength(1);
    expect(offenders).toEqual([]);
  });
});
