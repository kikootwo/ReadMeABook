/**
 * Component: Discord Settings Hook
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Self-contained state + actions for the Discord settings tab: load current config, test the bot
 * token, resolve role/channel/user IDs to names, and save. Mirrors the test-then-confirm UX used by
 * the other connection-based settings tabs.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchWithAuth } from '@/lib/utils/api';
import type { DiscordSettings } from '../../lib/types';

export interface ResolvedNames {
  guild?: { name: string | null; error?: string };
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

/** The connected bot's identity, resolved by a successful token test. */
export interface BotIdentity {
  id: string;
  username: string;
  avatarUrl: string;
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
  deletePermission: 'own_only',
};

export function useDiscordSettings() {
  const [settings, setSettings] = useState<DiscordSettings>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<DiscordMessage | null>(null);
  const [botIdentity, setBotIdentity] = useState<BotIdentity | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolvedNames, setResolvedNames] = useState<ResolvedNames | null>(null);
  const [message, setMessage] = useState<DiscordMessage | null>(null);

  const autoRanRef = useRef(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetchWithAuth('/api/admin/settings');
        if (res.ok) {
          const data = await res.json();
          if (active && data.discord) {
            const loaded: DiscordSettings = { ...EMPTY, ...data.discord };
            setSettings(loaded);
            setLoading(false);

            if (!autoRanRef.current) {
              autoRanRef.current = true;
              if (loaded.botToken) {
                setTesting(true);
                fetchWithAuth('/api/admin/settings/test-discord', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ botToken: loaded.botToken }),
                })
                  .then(async (testRes) => {
                    const testData = await testRes.json();
                    if (active && testRes.ok && testData.success) {
                      setBotIdentity({
                        id: testData.botId,
                        username: testData.botUsername,
                        avatarUrl: testData.botAvatarUrl,
                      });
                    }
                  })
                  .catch(() => { /* best-effort */ })
                  .finally(() => { if (active) setTesting(false); });
              }
              const hasIds = loaded.guildId || loaded.requestChannelId || loaded.adminRoleId
                || loaded.adminNotifyChannelId || loaded.requesterRoleId;
              if (loaded.botToken && hasIds) {
                setResolving(true);
                fetchWithAuth('/api/admin/settings/discord/resolve', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    botToken: loaded.botToken,
                    guildId: loaded.guildId,
                    roleId: loaded.adminRoleId,
                    channelId: loaded.requestChannelId,
                    adminNotifyChannelId: loaded.adminNotifyChannelId,
                    requesterRoleId: loaded.requesterRoleId,
                  }),
                })
                  .then(async (resolveRes) => {
                    const resolveData = await resolveRes.json();
                    if (active && resolveRes.ok && resolveData.success) {
                      setResolvedNames(resolveData.results || {});
                    }
                  })
                  .catch(() => { /* best-effort */ })
                  .finally(() => { if (active) setResolving(false); });
              }
            }
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
    // A changed token invalidates the previously resolved bot identity.
    if (key === 'botToken') {
      setBotIdentity(null);
      setTestResult(null);
    }
  }, []);

  const testToken = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    setBotIdentity(null);
    try {
      const res = await fetchWithAuth('/api/admin/settings/test-discord', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botToken: settings.botToken }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setBotIdentity({ id: data.botId, username: data.botUsername, avatarUrl: data.botAvatarUrl });
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
    botIdentity,
    resolving,
    resolvedNames,
    message,
    update,
    testToken,
    resolveIds,
    save,
  };
}
