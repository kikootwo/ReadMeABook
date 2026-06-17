/**
 * Component: Discord Settings Tab
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Configures the Discord slash-command bot: enable toggle, bot token (with a test button), and the
 * guild/channel/role IDs. A "Resolve names" button fetches the human-readable names for the entered
 * IDs so admins can confirm they pasted the correct snowflakes before saving.
 */

'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { DiscordSettings } from '../../lib/types';
import { useDiscordSettings } from './useDiscordSettings';
import { MapUsersModal } from './MapUsersModal';

export function DiscordTab() {
  const {
    settings,
    loading,
    saving,
    testing,
    testResult,
    resolving,
    resolvedNames,
    message,
    update,
    testToken,
    resolveIds,
    save,
  } = useDiscordSettings();

  const [mapUsersOpen, setMapUsersOpen] = useState(false);

  if (loading) {
    return <div className="text-gray-500 dark:text-gray-400">Loading…</div>;
  }

  const resolvedHint = (field?: { name: string | null; error?: string }) => {
    if (!field) return undefined;
    return field.name ? `Resolved: ${field.name}` : field.error || 'Could not resolve';
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">Discord Bot</h2>
        <p className="text-gray-600 dark:text-gray-400 mb-2">
          Let users request titles from Discord with <code>/request</code>, and manage them with{' '}
          <code>/status</code> and <code>/delete</code>. Map each Discord account to a ReadMeABook
          user with <strong>Link Discord Usernames</strong> below (or on the Users page).
        </p>
      </div>

      {/* Enable toggle */}
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <div className="flex items-start gap-4">
          <input
            type="checkbox"
            id="discord-enabled"
            checked={settings.enabled}
            onChange={(e) => update('enabled', e.target.checked)}
            className="mt-1 h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <div className="flex-1">
            <label
              htmlFor="discord-enabled"
              className="block text-sm font-medium text-gray-900 dark:text-gray-100 cursor-pointer"
            >
              Enable Discord bot
            </label>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Connect the gateway bot so linked users can request and manage titles from Discord with{' '}
              <code>/request</code>, <code>/status</code>, and <code>/delete</code>. Requires the bot
              token, server, and channel settings below.
            </p>
          </div>
        </div>
      </div>

      {/* Bot token + test */}
      <div className="space-y-2">
        <Input
          label="Bot Token"
          type="password"
          value={settings.botToken}
          onChange={(e) => update('botToken', e.target.value)}
          placeholder="Bot token from the Discord Developer Portal"
          helperText="Create an application → Bot → Reset Token. Enable the Server Members intent."
        />
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={testToken} disabled={testing || !settings.botToken}>
            {testing ? 'Testing…' : 'Test Token'}
          </Button>
          {testResult && (
            <span
              className={`text-sm ${
                testResult.type === 'success'
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-red-600 dark:text-red-400'
              }`}
            >
              {testResult.text}
            </span>
          )}
        </div>
      </div>

      {/* IDs */}
      <Input
        label="Server (Guild) ID"
        value={settings.guildId}
        onChange={(e) => update('guildId', e.target.value)}
        placeholder="e.g. 123456789012345678"
      />
      <Input
        label="Request Channel ID"
        value={settings.requestChannelId}
        onChange={(e) => update('requestChannelId', e.target.value)}
        placeholder="Channel where approval requests are posted"
        helperText={resolvedHint(resolvedNames?.channel)}
      />
      <Input
        label="Admin Role ID"
        value={settings.adminRoleId}
        onChange={(e) => update('adminRoleId', e.target.value)}
        placeholder="Role pinged for approvals (and allowed to approve/deny)"
        helperText={resolvedHint(resolvedNames?.role)}
      />
      <Input
        label="Admin Notify Channel ID (optional)"
        value={settings.adminNotifyChannelId}
        onChange={(e) => update('adminNotifyChannelId', e.target.value)}
        placeholder="Separate channel for approval pings (defaults to Request Channel)"
        helperText={resolvedHint(resolvedNames?.adminNotifyChannel)}
      />
      <Input
        label="Requester Role ID (optional)"
        value={settings.requesterRoleId}
        onChange={(e) => update('requesterRoleId', e.target.value)}
        placeholder="Restrict who can make requests (blank = anyone linked; admins always can)"
        helperText={resolvedHint(resolvedNames?.requesterRole)}
      />

      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={resolveIds} disabled={resolving}>
          {resolving ? 'Resolving…' : 'Resolve Names'}
        </Button>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          Confirm the entered IDs map to the right server, channels, and role.
        </span>
      </div>

      {/* User mapping */}
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          onClick={() => setMapUsersOpen(true)}
          className="whitespace-nowrap shrink-0"
        >
          Link Discord Usernames
        </Button>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          Search the server and link each ReadMeABook user to their Discord account.
        </span>
      </div>

      {/* Request card delivery */}
      <div className="space-y-1">
        <label
          htmlFor="discord-card-mode"
          className="block text-sm font-medium text-gray-900 dark:text-gray-100"
        >
          Request card delivery
        </label>
        <select
          id="discord-card-mode"
          value={settings.requestCardMode}
          onChange={(e) =>
            update('requestCardMode', e.target.value as DiscordSettings['requestCardMode'])
          }
          className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        >
          <option value="public">Public announcement (post in the request channel)</option>
          <option value="dm">Direct message (DM the requester)</option>
          <option value="both">Both (public announcement + DM)</option>
        </select>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Where the live request card (cover, details, auto-updating status, and Cancel button) is
          posted after a user confirms a request.
        </p>
      </div>

      {/* Save */}
      <div className="flex items-center gap-4 pt-2">
        <Button variant="primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save Settings'}
        </Button>
        {message && (
          <span
            className={`text-sm ${
              message.type === 'success'
                ? 'text-green-600 dark:text-green-400'
                : 'text-red-600 dark:text-red-400'
            }`}
          >
            {message.text}
          </span>
        )}
      </div>

      <MapUsersModal isOpen={mapUsersOpen} onClose={() => setMapUsersOpen(false)} />
    </div>
  );
}
