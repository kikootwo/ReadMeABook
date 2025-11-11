/**
 * Component: Admin Settings Page
 * Documentation: documentation/settings-pages.md
 */

'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import Link from 'next/link';

interface Settings {
  plex: {
    url: string;
    token: string;
    libraryId: string;
  };
  prowlarr: {
    url: string;
    apiKey: string;
  };
  downloadClient: {
    type: string;
    url: string;
    username: string;
    password: string;
  };
  paths: {
    downloadDir: string;
    mediaDir: string;
  };
  general: {
    appName: string;
    allowRegistrations: boolean;
    maxConcurrentDownloads: number;
    autoApproveRequests: boolean;
  };
}

export default function AdminSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );
  const [activeTab, setActiveTab] = useState<
    'plex' | 'prowlarr' | 'download' | 'paths' | 'general'
  >('plex');

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const response = await fetch('/api/admin/settings');
      if (response.ok) {
        const data = await response.json();
        setSettings(data);
      }
    } catch (error) {
      console.error('Failed to fetch settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    if (!settings) return;

    setSaving(true);
    setMessage(null);

    try {
      // Save Plex settings
      const plexResponse = await fetch('/api/admin/settings/plex', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings.plex),
      });

      if (!plexResponse.ok) {
        throw new Error('Failed to save Plex settings');
      }

      setMessage({ type: 'success', text: 'Settings saved successfully!' });
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to save settings',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading || !settings) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const tabs = [
    { id: 'plex', label: 'Plex', icon: '📺' },
    { id: 'prowlarr', label: 'Prowlarr', icon: '🔍' },
    { id: 'download', label: 'Download Client', icon: '⬇️' },
    { id: 'paths', label: 'Paths', icon: '📁' },
    { id: 'general', label: 'General', icon: '⚙️' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-4 mb-4">
            <Link
              href="/admin"
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
            >
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </Link>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Settings</h1>
          </div>
          <p className="text-gray-600 dark:text-gray-400">
            Configure external services and system preferences
          </p>
        </div>

        {/* Message Banner */}
        {message && (
          <div
            className={`mb-6 rounded-lg p-4 ${
              message.type === 'success'
                ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
                : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
            }`}
          >
            <p
              className={`text-sm ${
                message.type === 'success'
                  ? 'text-green-800 dark:text-green-200'
                  : 'text-red-800 dark:text-red-200'
              }`}
            >
              {message.text}
            </p>
          </div>
        )}

        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          {/* Tabs */}
          <div className="border-b border-gray-200 dark:border-gray-700">
            <nav className="flex -mb-px">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`px-6 py-4 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab.id
                      ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                      : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  <span className="mr-2">{tab.icon}</span>
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Content */}
          <div className="p-8">
            {/* Plex Tab */}
            {activeTab === 'plex' && (
              <div className="space-y-6 max-w-2xl">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                    Plex Media Server
                  </h2>
                  <p className="text-gray-600 dark:text-gray-400 mb-6">
                    Configure your Plex server connection and audiobook library.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Server URL
                  </label>
                  <Input
                    type="url"
                    value={settings.plex.url}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        plex: { ...settings.plex, url: e.target.value },
                      })
                    }
                    placeholder="http://localhost:32400"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Authentication Token
                  </label>
                  <Input
                    type="password"
                    value={settings.plex.token}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        plex: { ...settings.plex, token: e.target.value },
                      })
                    }
                    placeholder="Enter your Plex token"
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Find your token in Plex settings → Network → Show Advanced
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Audiobook Library ID
                  </label>
                  <Input
                    type="text"
                    value={settings.plex.libraryId}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        plex: { ...settings.plex, libraryId: e.target.value },
                      })
                    }
                    placeholder="Library ID"
                  />
                </div>
              </div>
            )}

            {/* Prowlarr Tab */}
            {activeTab === 'prowlarr' && (
              <div className="space-y-6 max-w-2xl">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                    Prowlarr Configuration
                  </h2>
                  <p className="text-gray-600 dark:text-gray-400 mb-6">
                    Configure your Prowlarr indexer manager.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Server URL
                  </label>
                  <Input
                    type="url"
                    value={settings.prowlarr.url}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        prowlarr: { ...settings.prowlarr, url: e.target.value },
                      })
                    }
                    placeholder="http://localhost:9696"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    API Key
                  </label>
                  <Input
                    type="password"
                    value={settings.prowlarr.apiKey}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        prowlarr: { ...settings.prowlarr, apiKey: e.target.value },
                      })
                    }
                    placeholder="Enter API key"
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Found in Prowlarr Settings → General → Security → API Key
                  </p>
                </div>
              </div>
            )}

            {/* Download Client Tab */}
            {activeTab === 'download' && (
              <div className="space-y-6 max-w-2xl">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                    Download Client
                  </h2>
                  <p className="text-gray-600 dark:text-gray-400 mb-6">
                    Configure your torrent download client (qBittorrent/Transmission).
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Client Type
                  </label>
                  <select
                    value={settings.downloadClient.type}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        downloadClient: { ...settings.downloadClient, type: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  >
                    <option value="qbittorrent">qBittorrent</option>
                    <option value="transmission">Transmission</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Server URL
                  </label>
                  <Input
                    type="url"
                    value={settings.downloadClient.url}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        downloadClient: { ...settings.downloadClient, url: e.target.value },
                      })
                    }
                    placeholder="http://localhost:8080"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Username
                  </label>
                  <Input
                    type="text"
                    value={settings.downloadClient.username}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        downloadClient: {
                          ...settings.downloadClient,
                          username: e.target.value,
                        },
                      })
                    }
                    placeholder="admin"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Password
                  </label>
                  <Input
                    type="password"
                    value={settings.downloadClient.password}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        downloadClient: {
                          ...settings.downloadClient,
                          password: e.target.value,
                        },
                      })
                    }
                    placeholder="Enter password"
                  />
                </div>
              </div>
            )}

            {/* Paths Tab */}
            {activeTab === 'paths' && (
              <div className="space-y-6 max-w-2xl">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                    Directory Paths
                  </h2>
                  <p className="text-gray-600 dark:text-gray-400 mb-6">
                    Configure download and media directory paths.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Download Directory
                  </label>
                  <Input
                    type="text"
                    value={settings.paths.downloadDir}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        paths: { ...settings.paths, downloadDir: e.target.value },
                      })
                    }
                    placeholder="/downloads"
                    className="font-mono"
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Temporary location for torrent downloads
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Media Directory
                  </label>
                  <Input
                    type="text"
                    value={settings.paths.mediaDir}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        paths: { ...settings.paths, mediaDir: e.target.value },
                      })
                    }
                    placeholder="/media/audiobooks"
                    className="font-mono"
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Final location for organized audiobook library (Plex scans this directory)
                  </p>
                </div>
              </div>
            )}

            {/* General Tab */}
            {activeTab === 'general' && (
              <div className="space-y-6 max-w-2xl">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                    General Settings
                  </h2>
                  <p className="text-gray-600 dark:text-gray-400 mb-6">
                    Configure general application preferences.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Application Name
                  </label>
                  <Input
                    type="text"
                    value={settings.general.appName}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        general: { ...settings.general, appName: e.target.value },
                      })
                    }
                    placeholder="ReadMeABook"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Max Concurrent Downloads
                  </label>
                  <Input
                    type="number"
                    min="1"
                    max="10"
                    value={settings.general.maxConcurrentDownloads}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        general: {
                          ...settings.general,
                          maxConcurrentDownloads: parseInt(e.target.value),
                        },
                      })
                    }
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Maximum number of simultaneous downloads
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="bg-gray-50 dark:bg-gray-900 px-8 py-4 border-t border-gray-200 dark:border-gray-700">
            <div className="flex justify-end gap-4">
              <Button variant="outline" onClick={() => window.location.reload()}>
                Cancel
              </Button>
              <Button onClick={saveSettings} loading={saving}>
                Save Changes
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
