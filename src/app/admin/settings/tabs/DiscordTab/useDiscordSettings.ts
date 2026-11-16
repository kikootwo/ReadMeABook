/**
 * Component: Discord Settings Tab - Custom Hook
 * Documentation: documentation/settings-pages.md
 *
 * Loading the tab reads RMAB's saved settings only. Discord is contacted only when the
 * admin clicks Test (never on load, enabled or not). Test and Save stay off until the
 * saved settings load (a blank form must never be saved over them). After a Save that
 * enables the bot, the status is read again a few times so the pill settles.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { fetchWithAuth } from '@/lib/utils/api';
import { isSnowflake } from '@/lib/services/discord/discord-snowflake';

export interface DiscordFormValues {
  enabled: boolean;
  botToken: string;
  guildId: string;
  requestChannelId: string;
  adminRoleId: string;
  adminNotifyChannelId: string;
  requesterRoleId: string;
  requestCardMode: DiscordCardModeValue;
}

/** Where a Discord request's live card goes: the requester's DMs, the request channel, or both. */
export type DiscordCardModeValue = 'dm' | 'public' | 'both';

export type DiscordIdKey = 'guildId' | 'requestChannelId' | 'adminRoleId' | 'adminNotifyChannelId' | 'requesterRoleId';

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

interface ServerView {
  settings?: DiscordFormValues;
  status?: DiscordBotStatusView;
}

const EMPTY: DiscordFormValues = {
  enabled: false,
  botToken: '',
  guildId: '',
  requestChannelId: '',
  adminRoleId: '',
  adminNotifyChannelId: '',
  requesterRoleId: '',
  requestCardMode: 'dm',
};

const SETTINGS_URL = '/api/admin/settings/discord';
export const LOAD_ERROR = 'Could not load the saved Discord settings. Test and Save stay off until they load.';
/** Status reads after a Save that enables the bot (stops early once running or failed). */
export const STATUS_POLLS = 5;
export const STATUS_POLL_MS = 1000;
export const ID_ERROR = 'Discord IDs are 15 to 20 digits';
const ID_KEYS: DiscordIdKey[] = ['guildId', 'requestChannelId', 'adminRoleId', 'adminNotifyChannelId', 'requesterRoleId'];

/** Per-field error text for IDs that are filled in but not a Discord ID. */
export function idErrors(values: DiscordFormValues): Partial<Record<DiscordIdKey, string>> {
  const errors: Partial<Record<DiscordIdKey, string>> = {};
  for (const key of ID_KEYS) {
    const value = values[key].trim();
    if (value && !isSnowflake(value)) errors[key] = ID_ERROR;
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
  requesterRoleId: values.requesterRoleId.trim(),
});

async function readError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => ({}));
  return body.message || body.error || fallback;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function useDiscordSettings() {
  const [values, setValues] = useState<DiscordFormValues>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  /** A token is saved (the GET sends the mask): emptying the field then clears it on purpose. */
  const [savedHasToken, setSavedHasToken] = useState(false);
  const [status, setStatus] = useState<DiscordBotStatusView>({ state: 'stopped' });
  const [testResult, setTestResult] = useState<DiscordTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const mounted = useRef(true);
  const pollRun = useRef(0);

  const applyServerView = (data: ServerView) => {
    if (data.settings) {
      setValues({ ...EMPTY, ...data.settings });
      setSavedHasToken(Boolean(data.settings.botToken));
    }
    if (data.status) setStatus(data.status);
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // One GET to RMAB on mount and per Retry; never a call to Discord
  useEffect(() => {
    let active = true;
    fetchWithAuth(SETTINGS_URL)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as ServerView;
      })
      .then((data) => {
        if (!active) return;
        if (data.settings) {
          setValues({ ...EMPTY, ...data.settings });
          setSavedHasToken(Boolean(data.settings.botToken));
        }
        if (data.status) setStatus(data.status);
        setLoaded(true);
      })
      .catch((error) => {
        console.error('Failed to load Discord settings:', error);
        if (active) setLoadError(LOAD_ERROR);
      });
    return () => {
      active = false;
    };
  }, [loadAttempt]);

  const retryLoad = () => {
    setLoadError(null);
    setLoadAttempt((attempt) => attempt + 1);
  };

  const update = (patch: Partial<DiscordFormValues>) => {
    setValues((current) => ({ ...current, ...patch }));
    // A result for other IDs or another token would mislead
    if (Object.keys(patch).some((key) => key !== 'enabled' && key !== 'requestCardMode')) setTestResult(null);
  };

  /** Reads the bot status a few times after a Save, until it is running or failed. */
  const pollStatus = async () => {
    const run = ++pollRun.current;
    for (let i = 0; i < STATUS_POLLS; i++) {
      await sleep(STATUS_POLL_MS);
      if (!mounted.current || run !== pollRun.current) return;
      try {
        const response = await fetchWithAuth(SETTINGS_URL);
        if (!response.ok) continue;
        const data = (await response.json()) as ServerView;
        if (!mounted.current || run !== pollRun.current) return;
        if (data.status) setStatus(data.status);
        if (data.status?.state === 'running' || data.status?.state === 'failed') return;
      } catch {
        // Read again on the next round
      }
    }
  };

  const test = async (onError: (message: string) => void) => {
    if (!loaded) return;
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
        requesterRoleId: t.requesterRoleId,
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
    if (!loaded) return;
    setSaving(true);
    try {
      const t = trimmed(values);
      const response = await fetchWithAuth(SETTINGS_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // '' alone keeps the saved token: say so when the admin emptied the field
        body: JSON.stringify({ ...t, clearBotToken: savedHasToken && t.botToken === '' }),
      });
      if (!response.ok) {
        onError(await readError(response, 'Failed to save Discord settings'));
        return;
      }
      applyServerView(await response.json());
      onSuccess(values.enabled ? 'Discord settings saved. The bot is connecting.' : 'Discord settings saved.');
      if (values.enabled) void pollStatus();
    } catch {
      onError('Failed to save Discord settings');
    } finally {
      setSaving(false);
    }
  };

  return { values, loaded, loadError, retryLoad, status, testResult, testing, saving, errors: idErrors(values), update, test, save };
}
