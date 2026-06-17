/**
 * Component: Link Discord Usernames Modal
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Admin tool (Discord settings tab) for bulk-linking ReadMeABook users to Discord accounts. Lists
 * every RMAB user with a per-row search that queries guild members by name (filtered by the
 * requester role when set). Existing mappings render as full avatar pills (resolved + cached client
 * side). Selecting a result persists the Discord User ID via PUT /api/admin/users.
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { fetchWithAuth } from '@/lib/utils/api';
import { cacheMember, resolveMembers, type DiscordMember } from '@/lib/utils/discordMemberCache';

interface RmabUser {
  id: string;
  plexUsername: string;
  avatarUrl?: string | null;
  discordUserId?: string | null;
}

interface MapUsersModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Deterministic, stable pill colors derived from a Discord user ID. */
function pillStyle(id: string): React.CSSProperties {
  let hue = 0;
  for (let i = 0; i < id.length; i++) {
    hue = (hue * 31 + id.charCodeAt(i)) % 360;
  }
  return {
    backgroundColor: `hsl(${hue} 70% 92%)`,
    color: `hsl(${hue} 65% 28%)`,
    borderColor: `hsl(${hue} 60% 72%)`,
  };
}

/** RMAB user avatar matching the header bar: image, else a blue initial circle. */
function RmabAvatar({ user }: { user: RmabUser }) {
  if (user.avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={user.avatarUrl} alt="" className="h-8 w-8 rounded-full flex-shrink-0 object-cover" />;
  }
  return (
    <div className="h-8 w-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-medium flex-shrink-0">
      {user.plexUsername.charAt(0).toUpperCase()}
    </div>
  );
}

export function MapUsersModal({ isOpen, onClose }: MapUsersModalProps) {
  const [users, setUsers] = useState<RmabUser[]>([]);
  const [resolved, setResolved] = useState<Record<string, DiscordMember>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetchWithAuth('/api/admin/users');
        const data = await res.json();
        if (!active) return;
        if (!res.ok) {
          setError(data.error || 'Failed to load users');
          return;
        }
        const list: RmabUser[] = (data.users || []).map((u: RmabUser) => ({
          id: u.id,
          plexUsername: u.plexUsername,
          avatarUrl: u.avatarUrl,
          discordUserId: u.discordUserId,
        }));
        setUsers(list);

        const mappedIds = list
          .map((u) => u.discordUserId)
          .filter((id): id is string => !!id);
        if (mappedIds.length > 0) {
          const members = await resolveMembers(mappedIds);
          if (active) setResolved(members);
        }
      } catch {
        if (active) setError('Failed to load users');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [isOpen]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Link Discord Usernames" size="sm">
      <div className="space-y-4 min-h-[55vh]">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Search the Discord server for each ReadMeABook user and pick their account. Results are
          limited to members with the requester role when one is configured.
        </p>

        {loading && <div className="text-gray-500 dark:text-gray-400">Loading…</div>}
        {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}

        {!loading && !error && (
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {users.map((user) => (
              <UserMapRow
                key={user.id}
                user={user}
                initialMember={user.discordUserId ? resolved[user.discordUserId] ?? null : null}
              />
            ))}
            {users.length === 0 && (
              <div className="text-sm text-gray-500 dark:text-gray-400 py-2">No users found.</div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function UserMapRow({
  user,
  initialMember,
}: {
  user: RmabUser;
  initialMember: DiscordMember | null;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DiscordMember[]>([]);
  const [searching, setSearching] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // The currently mapped Discord account (rich member), plus the bare ID fallback when unresolved.
  const [mapped, setMapped] = useState<DiscordMember | null>(initialMember);
  const [mappedId, setMappedId] = useState<string | null>(user.discordUserId ?? null);

  // Debounced member search.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let active = true;
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetchWithAuth('/api/admin/settings/discord/search-members', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q }),
        });
        const data = await res.json();
        if (!active) return;
        if (res.ok && data.success) {
          setResults(data.results || []);
          setRowError(null);
        } else {
          setResults([]);
          setRowError(data.error || 'Search failed');
        }
      } catch {
        if (active) setRowError('Search failed');
      } finally {
        if (active) setSearching(false);
      }
    }, 350);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [query]);

  const persist = useCallback(
    async (discordUserId: string | null) => {
      setSaving(true);
      setRowError(null);
      try {
        const res = await fetchWithAuth(`/api/admin/users/${user.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ discordUserId }),
        });
        const data = await res.json();
        if (!res.ok) {
          setRowError(data.error || 'Could not save mapping');
          return false;
        }
        return true;
      } catch {
        setRowError('Could not save mapping');
        return false;
      } finally {
        setSaving(false);
      }
    },
    [user.id]
  );

  const select = useCallback(
    async (member: DiscordMember) => {
      const ok = await persist(member.id);
      if (!ok) return;
      cacheMember(member);
      setMapped(member);
      setMappedId(member.id);
      setQuery('');
      setResults([]);
    },
    [persist]
  );

  const unlink = useCallback(async () => {
    const ok = await persist(null);
    if (!ok) return;
    setMapped(null);
    setMappedId(null);
  }, [persist]);

  return (
    <div className="py-3 flex items-start gap-3">
      {/* RMAB user (left) */}
      <div className="flex items-center gap-2 w-32 shrink-0 pt-1">
        <RmabAvatar user={user} />
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
          {user.plexUsername}
        </span>
      </div>

      {/* Mapping + search (right) */}
      <div className="flex-1 min-w-0">
        {mapped || mappedId ? (
          <div className="flex items-center gap-2 flex-wrap">
            {mapped ? (
              <span
                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
                style={pillStyle(mapped.id)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={mapped.avatarUrl} alt="" className="h-4 w-4 rounded-full object-cover" />
                {mapped.displayName}
              </span>
            ) : (
              <span
                className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium"
                style={pillStyle(mappedId!)}
              >
                ID · {mappedId}
              </span>
            )}
            <button
              type="button"
              onClick={unlink}
              disabled={saving}
              className="rounded-md border border-gray-300 dark:border-gray-600 px-2 py-1 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              {saving ? 'Unlinking…' : 'Unlink'}
            </button>
          </div>
        ) : (
          <div>
            <div className="relative">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search Discord by name…"
                className="block w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              />
              {searching && <span className="absolute right-2 top-1.5 text-xs text-gray-400">…</span>}
            </div>
            {results.length > 0 && (
              <div className="mt-1 rounded-md border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700">
                {results.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => select(member)}
                    className="flex w-full items-center gap-2 px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={member.avatarUrl} alt="" className="h-6 w-6 rounded-full object-cover flex-shrink-0" />
                    <span
                      className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium"
                      style={pillStyle(member.id)}
                    >
                      {member.displayName}
                    </span>
                    {member.displayName !== member.username && (
                      <span className="text-xs text-gray-400 truncate">@{member.username}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {rowError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{rowError}</p>}
      </div>
    </div>
  );
}
