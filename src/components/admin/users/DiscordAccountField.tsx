/**
 * Component: Discord Account Field (admin Users page)
 * Documentation: documentation/admin-dashboard.md
 *
 * Shown only when the Discord bot is configured. An admin links a user's Discord ID
 * (PUT /api/admin/users/[id]/discord) or unlinks it. The user acts in Discord as this
 * RMAB account, with this account's role. The parent keys it by user and saved ID, so a save
 * or a different user starts it fresh.
 */

'use client';

import React, { useState } from 'react';
import { fetchJSON } from '@/lib/utils/api';
import { isSnowflake } from '@/lib/services/discord/discord-snowflake';

interface DiscordAccountFieldProps {
  user: { id: string; plexUsername: string; discordUserId?: string | null };
  onSaved: () => void;
}

/** "Discord: <id>" under a user's name when linked. */
export function DiscordIdLine({ discordUserId }: { discordUserId?: string | null }) {
  if (!discordUserId) return null;
  return <div className="text-xs text-indigo-600 dark:text-indigo-400 mt-0.5 font-mono">{`Discord: ${discordUserId}`}</div>;
}

export function DiscordAccountField({ user, onSaved }: DiscordAccountFieldProps) {
  const [value, setValue] = useState(user.discordUserId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = value.trim();
  const invalid = trimmed !== '' && !isSnowflake(trimmed);
  const unchanged = trimmed === (user.discordUserId ?? '');

  const submit = async (discordUserId: string | null) => {
    setSaving(true);
    setError(null);
    try {
      await fetchJSON(`/api/admin/users/${user.id}/discord`, {
        method: 'PUT',
        body: JSON.stringify({ discordUserId }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update the Discord link');
    } finally {
      setSaving(false);
    }
  };

  const inputId = `discord-user-id-${user.id}`;
  return (
    <div className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg space-y-2">
      <label htmlFor={inputId} className="block text-sm font-medium text-gray-900 dark:text-gray-100">
        Discord user ID
      </label>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        In Discord, turn on Developer Mode (User Settings, Advanced), right-click the user and choose Copy User ID.
        Link an admin only if their Discord account uses two-factor sign-in.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          id={inputId}
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Not linked"
          className="min-w-0 flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => submit(trimmed)}
            disabled={saving || invalid || unchanged || trimmed === ''}
            aria-label="Save Discord ID"
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Save
          </button>
          {user.discordUserId && (
            <button
              type="button"
              onClick={() => submit(null)}
              disabled={saving}
              aria-label="Unlink Discord"
              className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              Unlink
            </button>
          )}
        </div>
      </div>
      {invalid && <p className="text-xs text-red-600 dark:text-red-400">A Discord user ID is 15 to 20 digits</p>}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
