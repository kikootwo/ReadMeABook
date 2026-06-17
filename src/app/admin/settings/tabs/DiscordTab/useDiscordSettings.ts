/**
 * Component: Discord Settings Hook
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Self-contained state + actions for the Discord settings tab: load current config, test the bot
 * token, resolve role/channel/user IDs to names, and save. Mirrors the test-then-confirm UX used by
 * the other connection-based settings tabs.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchWithAuth } from '@/lib/utils/api';
import type { DiscordSettings } from '../../lib/types';

export interface ResolvedNames {
  role?: { name: string | null; error?: string };
  channel?: { name: string | null; error?: string };
  adminNotifyChannel?: { name: string | null; error?: string };
  requesterRole?: { name: string | null; error?: string };
  user?: { name: string | null; error?: string };
}

export interface DiscordMessage {
  type: 'success' | 'error';
  text: string;
}

const EMPTY: DiscordSettings = {
  enabled: false,
  botToken: '',
  guildId: '',
  requestChannelId: '',
  adminRoleId: '',
  adminNotifyChannelId: '',
  requestCardMode: 'public',
  requesterRoleId: '',
};

export function useDiscordSettings() {
  const [settings, setSettings] = useState<DiscordSettings>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<DiscordMessage | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolvedNames, setResolvedNames] = useState<ResolvedNames | null>(null);
  const [message, setMessage] = useState<DiscordMessage | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetchWithAuth('/api/admin/settings');
        if (res.ok) {
          const data = await res.json();
          if (active && data.discord) {
            setSettings({ ...EMPTY, ...data.discord });
          }
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const update = useCallback(<K extends keyof DiscordSettings>(key: K, value: DiscordSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setMessage(null);
  }, []);

  const testToken = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetchWithAuth('/api/admin/settings/test-discord', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botToken: settings.botToken }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTestResult({ type: 'success', text: `Connected as ${data.botUsername}` });
      } else {
        setTestResult({ type: 'error', text: data.error || 'Token test failed' });
      }
    } catch {
      setTestResult({ type: 'error', text: 'Token test failed' });
    } finally {
      setTesting(false);
    }
  }, [settings.botToken]);

  const resolveIds = useCallback(async () => {
    setResolving(true);
    setResolvedNames(null);
    try {
      const res = await fetchWithAuth('/api/admin/settings/discord/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botToken: settings.botToken,
          guildId: settings.guildId,
          roleId: settings.adminRoleId,
          channelId: settings.requestChannelId,
          adminNotifyChannelId: settings.adminNotifyChannelId,
          requesterRoleId: settings.requesterRoleId,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setResolvedNames(data.results || {});
      } else {
        setMessage({ type: 'error', text: data.error || 'Could not resolve IDs' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Could not resolve IDs' });
    } finally {
      setResolving(false);
    }
  }, [settings]);

  const save = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetchWithAuth('/api/admin/settings/discord', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setMessage({ type: 'success', text: 'Discord settings saved' });
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to save settings' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to save settings' });
    } finally {
      setSaving(false);
    }
  }, [settings]);

  return {
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
  };
}
