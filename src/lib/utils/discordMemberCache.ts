/**
 * Component: Discord Member Client Cache
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Client-side localStorage cache mapping Discord User IDs → display info (name + avatar), so the
 * user-mapping surfaces can render full pills for existing mappings without re-hitting Discord on
 * every modal open. Misses are resolved in one batched call and written back to the cache.
 */

import { fetchWithAuth } from '@/lib/utils/api';

export interface DiscordMember {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
}

const CACHE_KEY = 'rmab.discordMemberCache.v1';
const TTL_MS = 24 * 60 * 60 * 1000; // 24h

interface CacheEntry {
  m: DiscordMember;
  ts: number;
}

function readCache(): Record<string, CacheEntry> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeCache(cache: Record<string, CacheEntry>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Quota exceeded / disabled storage — caching is best-effort.
  }
}

/** Store a known member (e.g. one just selected from search) so future opens skip the network. */
export function cacheMember(member: DiscordMember): void {
  const cache = readCache();
  cache[member.id] = { m: member, ts: Date.now() };
  writeCache(cache);
}

/**
 * Resolve the given Discord IDs to members, serving fresh cache hits locally and batching the misses
 * into a single API call. Returns a map keyed by Discord ID (unresolved IDs are simply absent).
 */
export async function resolveMembers(ids: string[]): Promise<Record<string, DiscordMember>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const out: Record<string, DiscordMember> = {};
  const cache = readCache();
  const now = Date.now();
  const misses: string[] = [];

  for (const id of unique) {
    const entry = cache[id];
    if (entry && now - entry.ts < TTL_MS) {
      out[id] = entry.m;
    } else {
      misses.push(id);
    }
  }

  if (misses.length > 0) {
    try {
      const res = await fetchWithAuth('/api/admin/settings/discord/resolve-members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: misses }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        for (const m of (data.results || []) as DiscordMember[]) {
          out[m.id] = m;
          cache[m.id] = { m, ts: now };
        }
        writeCache(cache);
      }
    } catch {
      // Leave misses unresolved; callers fall back to showing the raw ID.
    }
  }

  return out;
}
