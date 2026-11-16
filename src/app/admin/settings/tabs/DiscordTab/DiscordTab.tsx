/**
 * Component: Discord Settings Tab
 * Documentation: documentation/settings-pages.md
 */

'use client';

import React from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useDiscordSettings, type DiscordBotStatusView, type DiscordIdKey } from './useDiscordSettings';

interface DiscordTabProps {
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

const STATUS_STYLES: Record<DiscordBotStatusView['state'], { label: string; className: string }> = {
  stopped: { label: 'Not running', className: 'bg-gray-500/10 text-gray-700 dark:text-gray-300' },
  starting: { label: 'Connecting', className: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' },
  running: { label: 'Online', className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  failed: { label: 'Could not connect', className: 'bg-red-500/10 text-red-700 dark:text-red-400' },
};

const ID_FIELDS: { key: DiscordIdKey; label: string; help: string }[] = [
  { key: 'guildId', label: 'Server ID', help: 'The Discord server the bot works in. Required to enable the bot.' },
  { key: 'requestChannelId', label: 'Request channel ID', help: 'Optional. Where request messages will be posted.' },
  { key: 'adminRoleId', label: 'Admin role ID', help: 'Optional. Pinged on approval messages. It grants no rights in RMAB.' },
  { key: 'adminNotifyChannelId', label: 'Admin notification channel ID', help: 'Optional. Where approval messages will be posted.' },
];

export function DiscordTab({ onSuccess, onError }: DiscordTabProps) {
  const { values, loaded, loadError, retryLoad, status, testResult, testing, saving, errors, update, test, save } =
    useDiscordSettings();
  const pill = STATUS_STYLES[status.state];
  const hasErrors = Object.keys(errors).length > 0;

  if (loadError) {
    return (
      <div className="space-y-4 max-w-2xl">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Discord Bot</h2>
        <div className="p-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 space-y-3">
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">{loadError}</p>
          <Button variant="secondary" onClick={retryLoad}>Retry</Button>
        </div>
      </div>
    );
  }
  if (!loaded) {
    return <div className="text-sm text-gray-500 dark:text-gray-400">Loading Discord settings...</div>;
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <div className="flex flex-wrap items-center gap-3 mb-2">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Discord Bot</h2>
          <span
            className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${pill.className}`}
            title={status.lastError}
          >
            {status.state === 'running' && status.botTag ? `${pill.label} as ${status.botTag}` : pill.label}
          </span>
        </div>
        <p className="text-gray-600 dark:text-gray-400">
          Connect a Discord bot to this RMAB server. It has no commands yet. Users act in Discord as the RMAB account an
          admin links to their Discord ID on the Users page. Use one bot token for one RMAB server only.
        </p>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Create a Discord application just for RMAB and turn Public Bot off: connecting replaces that application&apos;s
          commands in your server.
        </p>
        {status.state === 'failed' && status.lastError && (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400 break-words">Last error: {status.lastError}</p>
        )}
      </div>

      <div className="flex items-start gap-4 p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
        <button
          type="button"
          role="switch"
          aria-checked={values.enabled}
          aria-label="Enable the Discord bot"
          onClick={() => update({ enabled: !values.enabled })}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${
            values.enabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
          }`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${values.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Enable the Discord bot</div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            While off, the bot stays disconnected. Test still checks the token with Discord.
          </p>
        </div>
      </div>

      <Input
        id="discord-bot-token"
        label="Bot token"
        type="password"
        autoComplete="off"
        value={values.botToken}
        onChange={(e) => update({ botToken: e.target.value })}
        helperText="From the Discord Developer Portal (your application, Bot, Reset Token). Stored encrypted."
      />

      {ID_FIELDS.map((field) => (
        <div key={field.key}>
          <Input
            id={`discord-${field.key}`}
            label={field.label}
            inputMode="numeric"
            value={values[field.key]}
            onChange={(e) => update({ [field.key]: e.target.value })}
            error={errors[field.key]}
            helperText={field.help}
          />
          {field.key !== 'guildId' && testResult?.names[field.key] && (
            <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-400">Found: {testResult.names[field.key]}</p>
          )}
          {field.key === 'guildId' && testResult?.guild && (
            <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-400">Found: {testResult.guild.name}</p>
          )}
        </div>
      ))}

      <p className="text-xs text-gray-500 dark:text-gray-400">
        To copy an ID, turn on Developer Mode in Discord (User Settings, Advanced), then right-click the server, channel
        or role and choose Copy ID.
      </p>

      {testResult && (
        <div className="p-4 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 space-y-2">
          <p className="text-sm text-gray-900 dark:text-gray-100">
            Token works: the bot is <span className="font-medium">{testResult.bot.username}</span>.
          </p>
          {testResult.guilds.length > 0 && (
            <p className="text-sm text-gray-700 dark:text-gray-300 break-words">
              In servers: {testResult.guilds.map((g) => `${g.name} (${g.id})`).join(', ')}
            </p>
          )}
          {testResult.warnings.map((warning) => (
            <p key={warning} className="text-sm text-amber-700 dark:text-amber-400">{warning}</p>
          ))}
          <a
            href={testResult.inviteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-sm font-medium text-blue-700 dark:text-blue-300 underline"
          >
            Invite the bot to your server
          </a>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={() => test(onError)} disabled={testing || hasErrors}>
          {testing ? 'Testing...' : 'Test'}
        </Button>
        <Button variant="primary" onClick={() => save(onSuccess, onError)} disabled={saving || hasErrors}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
