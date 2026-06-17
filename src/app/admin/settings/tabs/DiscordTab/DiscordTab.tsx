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
import { MapUsersModal, pillStyle } from './MapUsersModal';

export function DiscordTab() {
  const {
    settings,
    loading,
    saving,
    testing,
    testResult,
    botIdentity,
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
          helperText={
            <>
              <a
                href="https://discord.com/developers/applications"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 underline hover:text-blue-800 dark:hover:text-blue-300"
              >
                Create an application
              </a>
              {' → Bot → Reset Token. Enable the Server Members intent.'}
            </>
          }
        />
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={testToken} disabled={testing || !settings.botToken}>
            {testing ? 'Testing…' : 'Test Token'}
          </Button>
          {botIdentity && (
            <a
              href={`https://discord.com/developers/applications/${botIdentity.id}/bot`}
              target="_blank"
              rel="noopener noreferrer"
              title="Open this bot's configuration in the Discord Developer Portal"
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium hover:brightness-95 transition"
              style={pillStyle(botIdentity.id)}
            >
              <img
                src={botIdentity.avatarUrl}
                alt=""
                className="h-4 w-4 rounded-full object-cover"
              />
              {botIdentity.username}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 16 16"
                fill="currentColor"
                className="h-3 w-3 opacity-60"
              >
                <path d="M8.5 2.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-1 0V3.707L8.354 8.854a.5.5 0 1 1-.708-.708L12.293 3H9a.5.5 0 0 1-.5-.5z" />
                <path d="M3.5 4A1.5 1.5 0 0 0 2 5.5v7A1.5 1.5 0 0 0 3.5 14h7a1.5 1.5 0 0 0 1.5-1.5V9a.5.5 0 0 1 1 0v3.5A2.5 2.5 0 0 1 11 15H3.5A2.5 2.5 0 0 1 1 12.5v-7A2.5 2.5 0 0 1 3.5 3H7a.5.5 0 0 1 0 1H3.5z" />
              </svg>
            </a>
          )}
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
        helperText={resolvedHint(resolvedNames?.guild)}
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

      {/* Delete permission */}
      <div className="space-y-1">
        <label
          htmlFor="discord-delete-perm"
          className="block text-sm font-medium text-gray-900 dark:text-gray-100"
        >
          /delete command permissions
        </label>
        <select
          id="discord-delete-perm"
          value={settings.deletePermission}
          onChange={(e) =>
            update('deletePermission', e.target.value as DiscordSettings['deletePermission'])
          }
          className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        >
          <option value="own_only">Users can delete their own requests (default)</option>
          <option value="anyone_any">Anyone can delete any request</option>
          <option value="admin_only">Only admins can use /delete</option>
          <option value="disabled">Disable /delete entirely</option>
        </select>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Controls who can use the <code>/delete</code> command and which requests they can remove.
          Admins always have full access unless the command is disabled entirely.
        </p>
        {settings.deletePermission === 'admin_only' && (
          <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
            <strong>Note:</strong> This hides <code>/delete</code> from non-administrators in
            Discord. If your admins don&apos;t have Discord&apos;s built-in Administrator permission,
            they&apos;ll need a per-command exception: <strong>Server Settings → Integrations →{' '}
            {botIdentity ? botIdentity.username : 'your bot'} → /delete</strong>, then add the admin
            role or specific users who should have access.
          </div>
        )}
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
