/**
 * Component: Discord Settings Tab - Custom Hook
 * Documentation: documentation/settings-pages.md
 *
 * Loading the tab reads RMAB's saved settings only. Discord is contacted only when the
 * admin clicks Test (never on load, enabled or not).
 */

'use client';

import { useEffect, useState } from 'react';
import { fetchWithAuth } from '@/lib/utils/api';

export interface DiscordFormValues {
  enabled: boolean;
  botToken: string;
  guildId: string;
  requestChannelId: string;
  adminRoleId: string;
  adminNotifyChannelId: string;
}

export type DiscordIdKey = 'guildId' | 'requestChannelId' | 'adminRoleId' | 'adminNotifyChannelId';

export interface DiscordBotStatusView {
  state: 'stopped' | 'starting' | 'running' | 'failed';
  botTag?: string;
  lastError?: string;
}

export interface DiscordTestResult {
  bot: { id: string; username: string };
  inviteUrl: string;
  guilds: { id: string; name: string }[];
  guild: { id: string; name: string } | null;
  names: Partial<Record<Exclude<DiscordIdKey, 'guildId'>, string>>;
  warnings: string[];
}

const EMPTY: DiscordFormValues = {
  enabled: false,
  botToken: '',
  guildId: '',
  requestChannelId: '',
  adminRoleId: '',
  adminNotifyChannelId: '',
};

const SNOWFLAKE = /^[1-9]\d{14,19}$/;
export const ID_ERROR = 'Discord IDs are 15 to 20 digits';
const ID_KEYS: DiscordIdKey[] = ['guildId', 'requestChannelId', 'adminRoleId', 'adminNotifyChannelId'];

/** Per-field error text for IDs that are filled in but not a Discord ID. */
export function idErrors(values: DiscordFormValues): Partial<Record<DiscordIdKey, string>> {
  const errors: Partial<Record<DiscordIdKey, string>> = {};
  for (const key of ID_KEYS) {
    const value = values[key].trim();
    if (value && !SNOWFLAKE.test(value)) errors[key] = ID_ERROR;
  }
  return errors;
}

const trimmed = (values: DiscordFormValues): DiscordFormValues => ({
  ...values,
  botToken: values.botToken.trim(),
  guildId: values.guildId.trim(),
  requestChannelId: values.requestChannelId.trim(),
  adminRoleId: values.adminRoleId.trim(),
  adminNotifyChannelId: values.adminNotifyChannelId.trim(),
});

async function readError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => ({}));
  return body.message || body.error || fallback;
}

export function useDiscordSettings() {
  const [values, setValues] = useState<DiscordFormValues>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<DiscordBotStatusView>({ state: 'stopped' });
  const [testResult, setTestResult] = useState<DiscordTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  const applyServerView = (data: { settings?: DiscordFormValues; status?: DiscordBotStatusView }) => {
    if (data.settings) setValues({ ...EMPTY, ...data.settings });
    if (data.status) setStatus(data.status);
  };

  // One GET to RMAB on mount; never a call to Discord
  useEffect(() => {
    let active = true;
    fetchWithAuth('/api/admin/settings/discord')
      .then(async (response) => {
        const data = response.ok ? await response.json() : null;
        if (!active || !data) return;
        if (data.settings) setValues({ ...EMPTY, ...data.settings });
        if (data.status) setStatus(data.status);
      })
      .catch((error) => console.error('Failed to load Discord settings:', error))
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const update = (patch: Partial<DiscordFormValues>) => setValues((current) => ({ ...current, ...patch }));

  const test = async (onError: (message: string) => void) => {
    setTesting(true);
    setTestResult(null);
    try {
      const t = trimmed(values);
      const payload = {
        botToken: t.botToken,
        guildId: t.guildId,
        requestChannelId: t.requestChannelId,
        adminRoleId: t.adminRoleId,
        adminNotifyChannelId: t.adminNotifyChannelId,
      };
      const response = await fetchWithAuth('/api/admin/settings/test-discord', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        onError(await readError(response, 'Discord test failed'));
        return;
      }
      setTestResult(await response.json());
    } catch {
      onError('Discord test failed');
    } finally {
      setTesting(false);
    }
  };

  const save = async (onSuccess: (message: string) => void, onError: (message: string) => void) => {
    setSaving(true);
    try {
      const response = await fetchWithAuth('/api/admin/settings/discord', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(trimmed(values)),
      });
      if (!response.ok) {
        onError(await readError(response, 'Failed to save Discord settings'));
        return;
      }
      applyServerView(await response.json());
      onSuccess(values.enabled ? 'Discord settings saved. The bot is connecting.' : 'Discord settings saved.');
    } catch {
      onError('Failed to save Discord settings');
    } finally {
      setSaving(false);
    }
  };

  return { values, loaded, status, testResult, testing, saving, errors: idErrors(values), update, test, save };
}
