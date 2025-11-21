/**
 * Component: Admin Settings Page
 * Documentation: documentation/settings-pages.md
 */

'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import Link from 'next/link';
import { fetchWithAuth } from '@/lib/utils/api';

interface PlexLibrary {
  id: string;
  title: string;
  type: string;
}

interface IndexerConfig {
  id: number;
  name: string;
  protocol: string;
  privacy: string;
  enabled: boolean;
  priority: number;
  seedingTimeMinutes: number;
  rssEnabled: boolean;
  supportsRss?: boolean;
}

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
    metadataTaggingEnabled: boolean;
  };
}

export default function AdminSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [originalSettings, setOriginalSettings] = useState<Settings | null>(null); // Track original values
  const [plexLibraries, setPlexLibraries] = useState<PlexLibrary[]>([]);
  const [indexers, setIndexers] = useState<IndexerConfig[]>([]);
  const [isLocalAdmin, setIsLocalAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingLibraries, setLoadingLibraries] = useState(false);
  const [loadingIndexers, setLoadingIndexers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [validated, setValidated] = useState({
    plex: false,
    prowlarr: false,
    download: false,
    paths: false,
  });
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string }>>({});
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );
  const [activeTab, setActiveTab] = useState<'plex' | 'prowlarr' | 'download' | 'paths' | 'account' | 'bookdate'>('plex');

  // Password change form state
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [changingPassword, setChangingPassword] = useState(false);

  // BookDate configuration state
  const [bookdateProvider, setBookdateProvider] = useState<string>('openai');
  const [bookdateApiKey, setBookdateApiKey] = useState<string>('');
  const [bookdateModel, setBookdateModel] = useState<string>('');
  const [bookdateEnabled, setBookdateEnabled] = useState<boolean>(true);
  const [bookdateConfigured, setBookdateConfigured] = useState<boolean>(false);
  const [bookdateModels, setBookdateModels] = useState<{ id: string; name: string }[]>([]);
  const [testingBookdate, setTestingBookdate] = useState(false);
  const [clearingBookdateSwipes, setClearingBookdateSwipes] = useState(false);

  useEffect(() => {
    fetchSettings();
    fetchCurrentUser();
  }, []);

  const fetchCurrentUser = async () => {
    try {
      const response = await fetchWithAuth('/api/auth/me');
      if (response.ok) {
        const data = await response.json();
        setIsLocalAdmin(data.user?.isLocalAdmin || false);
      }
    } catch (error) {
      console.error('Failed to fetch current user:', error);
    }
  };

  // Fetch libraries/indexers when tabs become active or when page first loads
  useEffect(() => {
    if (!settings) return;

    if (activeTab === 'plex' && settings.plex.url && settings.plex.token) {
      fetchPlexLibraries();
    }
  }, [activeTab, settings?.plex.url, settings?.plex.token]);

  useEffect(() => {
    if (!settings) return;

    if (activeTab === 'prowlarr' && settings.prowlarr.url && settings.prowlarr.apiKey) {
      fetchIndexers();
    }
  }, [activeTab, settings?.prowlarr.url, settings?.prowlarr.apiKey]);

  useEffect(() => {
    if (activeTab === 'bookdate') {
      fetchBookdateConfig();
    }
  }, [activeTab]);

  const fetchSettings = async () => {
    try {
      const response = await fetchWithAuth('/api/admin/settings');
      if (response.ok) {
        const data = await response.json();
        setSettings(data);
        setOriginalSettings(JSON.parse(JSON.stringify(data))); // Deep copy for comparison
      } else {
        console.error('Failed to fetch settings:', response.status, response.statusText);
      }
    } catch (error) {
      console.error('Failed to fetch settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchPlexLibraries = async (force = false) => {
    if (!force && plexLibraries.length > 0) return; // Already loaded

    setLoadingLibraries(true);
    try {
      const response = await fetchWithAuth('/api/admin/settings/plex/libraries');
      if (response.ok) {
        const data = await response.json();
        setPlexLibraries(data.libraries || []);
      } else {
        const data = await response.json();
        console.error('Failed to fetch Plex libraries:', data);
        setMessage({ type: 'error', text: data.message || 'Failed to load Plex libraries. Check your Plex URL and token.' });
      }
    } catch (error) {
      console.error('Failed to fetch Plex libraries:', error);
      setMessage({ type: 'error', text: 'Failed to load Plex libraries. Check your Plex URL and token.' });
    } finally {
      setLoadingLibraries(false);
    }
  };

  const fetchIndexers = async (force = false) => {
    if (!force && indexers.length > 0) return; // Already loaded

    setLoadingIndexers(true);
    try {
      const response = await fetchWithAuth('/api/admin/settings/prowlarr/indexers');
      if (response.ok) {
        const data = await response.json();
        setIndexers(data.indexers || []);
      } else {
        console.error('Failed to fetch indexers:', response.status);
        // Don't show error on initial load, only if user explicitly tries to load
        if (force) {
          setMessage({ type: 'error', text: 'Failed to load indexers. Check your Prowlarr settings.' });
        }
      }
    } catch (error) {
      console.error('Failed to fetch indexers:', error);
      if (force) {
        setMessage({ type: 'error', text: 'Failed to load Prowlarr indexers. Check your Prowlarr URL and API key.' });
      }
    } finally {
      setLoadingIndexers(false);
    }
  };

  const fetchBookdateConfig = async () => {
    try {
      const response = await fetchWithAuth('/api/bookdate/config');
      const data = await response.json();

      if (data.config) {
        setBookdateProvider(data.config.provider || 'openai');
        setBookdateModel(data.config.model || '');
        setBookdateEnabled(data.config.isEnabled !== false); // Default to true
        setBookdateConfigured(data.config.isVerified || false);
      }
    } catch (error) {
      console.error('Failed to load BookDate config:', error);
    }
  };

  const handleTestBookdateConnection = async () => {
    const hasApiKey = bookdateApiKey.trim().length > 0;

    // Allow testing with saved API key if already configured
    if (!hasApiKey && !bookdateConfigured) {
      setMessage({ type: 'error', text: 'Please enter an API key' });
      return;
    }

    setTestingBookdate(true);
    setMessage(null);

    try {
      const payload: any = {
        provider: bookdateProvider,
      };

      // Include API key if user entered a new one, otherwise use saved key
      if (hasApiKey) {
        payload.apiKey = bookdateApiKey;
      } else {
        payload.useSavedKey = true;
      }

      const response = await fetchWithAuth('/api/bookdate/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Connection test failed');
      }

      setBookdateModels(data.models || []);
      setMessage({ type: 'success', text: 'Connection successful! Please select a model.' });

      // Auto-select first model if none selected
      if (!bookdateModel && data.models?.length > 0) {
        setBookdateModel(data.models[0].id);
      }
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Connection test failed' });
    } finally {
      setTestingBookdate(false);
    }
  };

  const handleSaveBookdateConfig = async () => {
    // Validate: model is required
    if (!bookdateModel) {
      setMessage({ type: 'error', text: 'Please select a model' });
      return;
    }

    // Only require API key if not already configured OR if user entered one
    const hasApiKey = bookdateApiKey.trim().length > 0;
    if (!bookdateConfigured && !hasApiKey) {
      setMessage({ type: 'error', text: 'Please enter an API key for initial setup' });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const payload: any = {
        provider: bookdateProvider,
        model: bookdateModel,
        isEnabled: bookdateEnabled,
      };

      // Only include API key if user entered a new one
      if (hasApiKey) {
        payload.apiKey = bookdateApiKey;
      }

      const response = await fetchWithAuth('/api/bookdate/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save configuration');
      }

      setMessage({ type: 'success', text: 'BookDate configuration saved successfully!' });
      setBookdateConfigured(true);
      setBookdateApiKey(''); // Clear API key from UI after save
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to save configuration' });
    } finally {
      setSaving(false);
    }
  };

  const handleClearBookdateSwipes = async () => {
    if (!confirm('This will clear all swipe history. Continue?')) {
      return;
    }

    setClearingBookdateSwipes(true);
    setMessage(null);

    try {
      const response = await fetchWithAuth('/api/bookdate/swipes', {
        method: 'DELETE',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to clear swipe history');
      }

      setMessage({ type: 'success', text: 'Swipe history cleared successfully!' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to clear swipe history' });
    } finally {
      setClearingBookdateSwipes(false);
    }
  };

  const testPlexConnection = async () => {
    if (!settings) return;

    setTesting(true);
    setMessage(null);

    try {
      const response = await fetchWithAuth('/api/admin/settings/test-plex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: settings.plex.url,
          token: settings.plex.token,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setValidated({ ...validated, plex: true });
        setTestResults({ ...testResults, plex: { success: true, message: `Connected to ${data.serverName}` } });
        setMessage({ type: 'success', text: `Connected to ${data.serverName}. You can now save.` });
        // Update libraries
        if (data.libraries) {
          setPlexLibraries(data.libraries);
        }
      } else {
        setValidated({ ...validated, plex: false });
        setTestResults({ ...testResults, plex: { success: false, message: data.error || 'Connection failed' } });
        setMessage({ type: 'error', text: data.error || 'Failed to connect to Plex' });
      }
    } catch (error) {
      setValidated({ ...validated, plex: false });
      const errorMsg = error instanceof Error ? error.message : 'Failed to test connection';
      setTestResults({ ...testResults, plex: { success: false, message: errorMsg } });
      setMessage({ type: 'error', text: errorMsg });
    } finally {
      setTesting(false);
    }
  };

  const testProwlarrConnection = async () => {
    if (!settings) return;

    setTesting(true);
    setMessage(null);

    try {
      const response = await fetchWithAuth('/api/admin/settings/test-prowlarr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: settings.prowlarr.url,
          apiKey: settings.prowlarr.apiKey,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setValidated({ ...validated, prowlarr: true });
        setTestResults({ ...testResults, prowlarr: { success: true, message: `Connected to Prowlarr. Found ${data.indexers?.length || 0} indexers` } });
        setMessage({ type: 'success', text: `Connected to Prowlarr. Found ${data.indexers?.length || 0} indexers. You can now save.` });
        // Refresh indexers from database (merges saved config with available indexers)
        await fetchIndexers(true);
      } else {
        setValidated({ ...validated, prowlarr: false });
        setTestResults({ ...testResults, prowlarr: { success: false, message: data.error || 'Connection failed' } });
        setMessage({ type: 'error', text: data.error || 'Failed to connect to Prowlarr' });
      }
    } catch (error) {
      setValidated({ ...validated, prowlarr: false });
      const errorMsg = error instanceof Error ? error.message : 'Failed to test connection';
      setTestResults({ ...testResults, prowlarr: { success: false, message: errorMsg } });
      setMessage({ type: 'error', text: errorMsg });
    } finally {
      setTesting(false);
    }
  };

  const testDownloadClientConnection = async () => {
    if (!settings) return;

    setTesting(true);
    setMessage(null);

    try {
      const response = await fetchWithAuth('/api/admin/settings/test-download-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: settings.downloadClient.type,
          url: settings.downloadClient.url,
          username: settings.downloadClient.username,
          password: settings.downloadClient.password,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setValidated({ ...validated, download: true });
        setTestResults({ ...testResults, download: { success: true, message: `Connected to ${settings.downloadClient.type} (${data.version || 'version unknown'})` } });
        setMessage({ type: 'success', text: `Connected to ${settings.downloadClient.type}. You can now save.` });
      } else {
        setValidated({ ...validated, download: false });
        setTestResults({ ...testResults, download: { success: false, message: data.error || 'Connection failed' } });
        setMessage({ type: 'error', text: data.error || 'Failed to connect to download client' });
      }
    } catch (error) {
      setValidated({ ...validated, download: false });
      const errorMsg = error instanceof Error ? error.message : 'Failed to test connection';
      setTestResults({ ...testResults, download: { success: false, message: errorMsg } });
      setMessage({ type: 'error', text: errorMsg });
    } finally {
      setTesting(false);
    }
  };

  const testPaths = async () => {
    if (!settings) return;

    setTesting(true);
    setMessage(null);

    try {
      const response = await fetch('/api/setup/test-paths', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          downloadDir: settings.paths.downloadDir,
          mediaDir: settings.paths.mediaDir,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setValidated({ ...validated, paths: true });
        setTestResults({ ...testResults, paths: { success: true, message: 'All paths are valid and writable' } });
        setMessage({ type: 'success', text: 'All paths are valid and writable. You can now save.' });
      } else {
        setValidated({ ...validated, paths: false });
        setTestResults({ ...testResults, paths: { success: false, message: data.error || 'Path validation failed' } });
        setMessage({ type: 'error', text: data.error || 'Failed to validate paths' });
      }
    } catch (error) {
      setValidated({ ...validated, paths: false });
      const errorMsg = error instanceof Error ? error.message : 'Failed to test paths';
      setTestResults({ ...testResults, paths: { success: false, message: errorMsg } });
      setMessage({ type: 'error', text: errorMsg });
    } finally {
      setTesting(false);
    }
  };

  const changePassword = async () => {
    setChangingPassword(true);
    setMessage(null);

    try {
      const response = await fetchWithAuth('/api/admin/settings/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(passwordForm),
      });

      const data = await response.json();

      if (data.success) {
        setMessage({ type: 'success', text: 'Password changed successfully!' });
        // Clear form
        setPasswordForm({
          currentPassword: '',
          newPassword: '',
          confirmPassword: '',
        });
        setTimeout(() => setMessage(null), 5000);
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to change password' });
      }
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to change password',
      });
    } finally {
      setChangingPassword(false);
    }
  };

  const saveSettings = async () => {
    if (!settings) return;

    setSaving(true);
    setMessage(null);

    try {
      // Save settings based on active tab
      switch (activeTab) {
        case 'plex':
          const plexResponse = await fetchWithAuth('/api/admin/settings/plex', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings.plex),
          });

          if (!plexResponse.ok) {
            throw new Error('Failed to save Plex settings');
          }
          break;

        case 'prowlarr':
          // Save Prowlarr URL and API key
          const prowlarrResponse = await fetchWithAuth('/api/admin/settings/prowlarr', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings.prowlarr),
          });

          if (!prowlarrResponse.ok) {
            throw new Error('Failed to save Prowlarr settings');
          }

          // Save indexer configuration if indexers are loaded
          if (indexers.length > 0) {
            const indexersResponse = await fetchWithAuth('/api/admin/settings/prowlarr/indexers', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ indexers }),
            });

            if (!indexersResponse.ok) {
              throw new Error('Failed to save indexer configuration');
            }
          }
          break;

        case 'download':
          const downloadResponse = await fetchWithAuth('/api/admin/settings/download-client', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings.downloadClient),
          });

          if (!downloadResponse.ok) {
            throw new Error('Failed to save download client settings');
          }
          break;

        case 'paths':
          const pathsResponse = await fetchWithAuth('/api/admin/settings/paths', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings.paths),
          });

          if (!pathsResponse.ok) {
            throw new Error('Failed to save paths settings');
          }
          break;

        default:
          throw new Error('Unknown settings tab');
      }

      setMessage({ type: 'success', text: 'Settings saved successfully!' });
      // Update original settings to reflect the saved state
      if (settings) {
        setOriginalSettings(JSON.parse(JSON.stringify(settings)));
      }
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
    { id: 'prowlarr', label: 'Indexers', icon: '🔍' },
    { id: 'download', label: 'Download Client', icon: '⬇️' },
    { id: 'paths', label: 'Paths', icon: '📁' },
    { id: 'bookdate', label: 'BookDate', icon: '📚' },
    ...(isLocalAdmin ? [{ id: 'account', label: 'Account', icon: '🔒' }] : []),
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
                  onClick={() => {
                    setActiveTab(tab.id as any);
                    if (tab.id === 'plex') fetchPlexLibraries();
                    if (tab.id === 'prowlarr') fetchIndexers();
                  }}
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
                    onChange={(e) => {
                      setSettings({
                        ...settings,
                        plex: { ...settings.plex, url: e.target.value },
                      });
                      setValidated({ ...validated, plex: false });
                    }}
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
                    onChange={(e) => {
                      setSettings({
                        ...settings,
                        plex: { ...settings.plex, token: e.target.value },
                      });
                      setValidated({ ...validated, plex: false });
                    }}
                    placeholder="Enter your Plex token"
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Find your token in Plex settings → Network → Show Advanced
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Audiobook Library
                  </label>
                  {loadingLibraries ? (
                    <div className="flex items-center gap-2 py-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                      <span className="text-sm text-gray-500">Loading libraries...</span>
                    </div>
                  ) : plexLibraries.length > 0 ? (
                    <select
                      value={settings.plex.libraryId}
                      onChange={(e) => {
                        setSettings({
                          ...settings,
                          plex: { ...settings.plex, libraryId: e.target.value },
                        });
                        setValidated({ ...validated, plex: false });
                      }}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                    >
                      <option value="">Select a library...</option>
                      {plexLibraries.map((lib) => (
                        <option key={lib.id} value={lib.id}>
                          {lib.title} ({lib.type})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="text-sm text-gray-500 py-2">
                      Test your connection to load libraries.
                    </div>
                  )}
                </div>

                <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
                  <Button
                    onClick={testPlexConnection}
                    loading={testing}
                    disabled={!settings.plex.url || !settings.plex.token}
                    variant="outline"
                    className="w-full"
                  >
                    Test Connection
                  </Button>
                  {testResults.plex && (
                    <div className={`mt-3 p-3 rounded-lg text-sm ${
                      testResults.plex.success
                        ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200'
                        : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
                    }`}>
                      {testResults.plex.message}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Prowlarr/Indexers Tab */}
            {activeTab === 'prowlarr' && (
              <div className="space-y-6 max-w-4xl">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                    Indexer Configuration
                  </h2>
                  <p className="text-gray-600 dark:text-gray-400 mb-6">
                    Configure your Prowlarr connection and select which indexers to use with priority and seeding time.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Prowlarr Server URL
                  </label>
                  <Input
                    type="url"
                    value={settings.prowlarr.url}
                    onChange={(e) => {
                      setSettings({
                        ...settings,
                        prowlarr: { ...settings.prowlarr, url: e.target.value },
                      });
                      // Only invalidate if URL actually changed from original
                      if (originalSettings && e.target.value !== originalSettings.prowlarr.url) {
                        setValidated({ ...validated, prowlarr: false });
                      }
                    }}
                    placeholder="http://localhost:9696"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Prowlarr API Key
                  </label>
                  <Input
                    type="password"
                    value={settings.prowlarr.apiKey}
                    onChange={(e) => {
                      setSettings({
                        ...settings,
                        prowlarr: { ...settings.prowlarr, apiKey: e.target.value },
                      });
                      // Only invalidate if API key actually changed from original
                      if (originalSettings && e.target.value !== originalSettings.prowlarr.apiKey) {
                        setValidated({ ...validated, prowlarr: false });
                      }
                    }}
                    placeholder="Enter API key"
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Found in Prowlarr Settings → General → Security → API Key
                  </p>
                </div>

                <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
                  <Button
                    onClick={testProwlarrConnection}
                    loading={testing}
                    disabled={!settings.prowlarr.url || !settings.prowlarr.apiKey}
                    variant="outline"
                    className="w-full"
                  >
                    {(() => {
                      if (originalSettings &&
                          settings.prowlarr.url === originalSettings.prowlarr.url &&
                          settings.prowlarr.apiKey === originalSettings.prowlarr.apiKey) {
                        return 'Refresh Indexers';
                      }
                      return 'Test Connection';
                    })()}
                  </Button>
                  {testResults.prowlarr && (
                    <div className={`mt-3 p-3 rounded-lg text-sm ${
                      testResults.prowlarr.success
                        ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200'
                        : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
                    }`}>
                      {testResults.prowlarr.message}
                    </div>
                  )}
                </div>

                <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                      Indexer Configuration
                    </h3>
                    {indexers.length > 0 && !loadingIndexers && (
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {indexers.filter(idx => idx.enabled).length} enabled
                      </span>
                    )}
                  </div>
                  {loadingIndexers ? (
                    <div className="flex items-center gap-2 py-4">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                      <span className="text-sm text-gray-500">Loading indexers...</span>
                    </div>
                  ) : indexers.length > 0 ? (
                    <div className="space-y-4">
                      {indexers.map((indexer) => (
                        <div
                          key={indexer.id}
                          className="border border-gray-200 dark:border-gray-700 rounded-lg p-4"
                        >
                          <div className="flex items-start gap-4">
                            <input
                              type="checkbox"
                              checked={indexer.enabled}
                              onChange={(e) => {
                                setIndexers(
                                  indexers.map((idx) =>
                                    idx.id === indexer.id
                                      ? { ...idx, enabled: e.target.checked }
                                      : idx
                                  )
                                );
                              }}
                              className="mt-1 h-5 w-5 rounded border-gray-300"
                            />
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <h4 className="font-medium text-gray-900 dark:text-gray-100">
                                  {indexer.name}
                                </h4>
                                <span className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                                  {indexer.protocol}
                                </span>
                              </div>
                              <div className="grid grid-cols-3 gap-4">
                                <div>
                                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                                    Priority (1-25)
                                  </label>
                                  <input
                                    type="number"
                                    min="1"
                                    max="25"
                                    value={indexer.priority}
                                    onChange={(e) => {
                                      const value = parseInt(e.target.value) || 10;
                                      setIndexers(
                                        indexers.map((idx) =>
                                          idx.id === indexer.id
                                            ? { ...idx, priority: Math.max(1, Math.min(25, value)) }
                                            : idx
                                        )
                                      );
                                    }}
                                    disabled={!indexer.enabled}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 disabled:opacity-50"
                                  />
                                  <p className="text-xs text-gray-500 mt-1">Higher = preferred</p>
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                                    Seeding Time (minutes)
                                  </label>
                                  <input
                                    type="number"
                                    min="0"
                                    value={indexer.seedingTimeMinutes}
                                    onChange={(e) => {
                                      const value = e.target.value === '' ? 0 : parseInt(e.target.value);
                                      setIndexers(
                                        indexers.map((idx) =>
                                          idx.id === indexer.id
                                            ? { ...idx, seedingTimeMinutes: isNaN(value) ? 0 : value }
                                            : idx
                                        )
                                      );
                                    }}
                                    disabled={!indexer.enabled}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 disabled:opacity-50"
                                  />
                                  <p className="text-xs text-gray-500 mt-1">0 = unlimited</p>
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                                    RSS Monitoring
                                  </label>
                                  <div className="flex items-center h-[42px]">
                                    <input
                                      type="checkbox"
                                      checked={indexer.rssEnabled || false}
                                      onChange={(e) => {
                                        setIndexers(
                                          indexers.map((idx) =>
                                            idx.id === indexer.id
                                              ? { ...idx, rssEnabled: e.target.checked }
                                              : idx
                                          )
                                        );
                                      }}
                                      disabled={!indexer.enabled || indexer.supportsRss === false}
                                      className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                                    />
                                  </div>
                                  <p className="text-xs text-gray-500 mt-1">Auto check for new releases</p>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-gray-500 py-6 text-center border border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
                      <p className="mb-2">No indexers configured.</p>
                      <p className="text-xs">
                        {settings.prowlarr.url && settings.prowlarr.apiKey
                          ? 'Click "Refresh Indexers" above to load available indexers from Prowlarr.'
                          : 'Enter your Prowlarr URL and API key above, then click "Test Connection" to load indexers.'}
                      </p>
                    </div>
                  )}
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
                    onChange={(e) => {
                      setSettings({
                        ...settings,
                        downloadClient: { ...settings.downloadClient, type: e.target.value },
                      });
                      setValidated({ ...validated, download: false });
                    }}
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
                    onChange={(e) => {
                      setSettings({
                        ...settings,
                        downloadClient: { ...settings.downloadClient, url: e.target.value },
                      });
                      setValidated({ ...validated, download: false });
                    }}
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
                    onChange={(e) => {
                      setSettings({
                        ...settings,
                        downloadClient: {
                          ...settings.downloadClient,
                          username: e.target.value,
                        },
                      });
                      setValidated({ ...validated, download: false });
                    }}
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
                    onChange={(e) => {
                      setSettings({
                        ...settings,
                        downloadClient: {
                          ...settings.downloadClient,
                          password: e.target.value,
                        },
                      });
                      setValidated({ ...validated, download: false });
                    }}
                    placeholder="Enter password"
                  />
                </div>

                <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
                  <Button
                    onClick={testDownloadClientConnection}
                    loading={testing}
                    disabled={!settings.downloadClient.url || !settings.downloadClient.username || !settings.downloadClient.password}
                    variant="outline"
                    className="w-full"
                  >
                    Test Connection
                  </Button>
                  {testResults.download && (
                    <div className={`mt-3 p-3 rounded-lg text-sm ${
                      testResults.download.success
                        ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200'
                        : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
                    }`}>
                      {testResults.download.message}
                    </div>
                  )}
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
                    onChange={(e) => {
                      setSettings({
                        ...settings,
                        paths: { ...settings.paths, downloadDir: e.target.value },
                      });
                      setValidated({ ...validated, paths: false });
                    }}
                    placeholder="/downloads"
                    className="font-mono"
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Temporary location for torrent downloads (kept for seeding)
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Media Directory
                  </label>
                  <Input
                    type="text"
                    value={settings.paths.mediaDir}
                    onChange={(e) => {
                      setSettings({
                        ...settings,
                        paths: { ...settings.paths, mediaDir: e.target.value },
                      });
                      setValidated({ ...validated, paths: false });
                    }}
                    placeholder="/media/audiobooks"
                    className="font-mono"
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Final location for organized audiobook library (Plex scans this directory)
                  </p>
                </div>

                {/* Metadata Tagging Toggle */}
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                  <div className="flex items-start gap-4">
                    <input
                      type="checkbox"
                      id="metadata-tagging-settings"
                      checked={settings.paths.metadataTaggingEnabled}
                      onChange={(e) => {
                        setSettings({
                          ...settings,
                          paths: { ...settings.paths, metadataTaggingEnabled: e.target.checked },
                        });
                        setValidated({ ...validated, paths: false });
                      }}
                      className="mt-1 h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="flex-1">
                      <label
                        htmlFor="metadata-tagging-settings"
                        className="block text-sm font-medium text-gray-900 dark:text-gray-100 cursor-pointer"
                      >
                        Auto-tag audio files with metadata
                      </label>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        Automatically write correct title, author, and narrator metadata to m4b and mp3 files
                        during file organization. This significantly improves Plex matching accuracy for audiobooks
                        with missing or incorrect metadata.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
                  <Button
                    onClick={testPaths}
                    loading={testing}
                    disabled={!settings.paths.downloadDir || !settings.paths.mediaDir}
                    variant="outline"
                    className="w-full"
                  >
                    Test Paths
                  </Button>
                  {testResults.paths && (
                    <div className={`mt-3 p-3 rounded-lg text-sm ${
                      testResults.paths.success
                        ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200'
                        : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
                    }`}>
                      {testResults.paths.message}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* BookDate Tab */}
            {activeTab === 'bookdate' && (
              <div className="space-y-6 max-w-2xl">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                    BookDate Configuration
                  </h2>
                  <p className="text-gray-600 dark:text-gray-400 mb-6">
                    Configure global AI-powered audiobook recommendations. All users share this API key, but receive personalized recommendations based on their individual library and ratings.
                  </p>
                </div>

                {/* Enable/Disable Toggle */}
                {bookdateConfigured && (
                  <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-medium text-gray-900 dark:text-white mb-1">
                          BookDate Feature
                        </h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {bookdateEnabled ? 'Feature is currently enabled' : 'Feature is currently disabled'}
                        </p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={bookdateEnabled}
                          onChange={(e) => setBookdateEnabled(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                      </label>
                    </div>
                  </div>
                )}

                {/* AI Provider */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    AI Provider
                  </label>
                  <select
                    value={bookdateProvider}
                    onChange={(e) => {
                      setBookdateProvider(e.target.value);
                      setBookdateModels([]);
                    }}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="openai">OpenAI</option>
                    <option value="claude">Claude (Anthropic)</option>
                  </select>
                </div>

                {/* API Key */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    API Key
                  </label>
                  <Input
                    type="password"
                    value={bookdateApiKey}
                    onChange={(e) => {
                      setBookdateApiKey(e.target.value);
                      setBookdateModels([]);
                    }}
                    placeholder={
                      bookdateConfigured
                        ? '••••••••••••••••'
                        : (bookdateProvider === 'openai' ? 'sk-...' : 'sk-ant-...')
                    }
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    The API key is stored securely and encrypted. Leave blank to keep existing key.
                  </p>
                </div>

                {/* Test Connection Button */}
                <Button
                  onClick={handleTestBookdateConnection}
                  loading={testingBookdate}
                  disabled={!bookdateApiKey.trim() && !bookdateConfigured}
                  variant="outline"
                  className="w-full"
                >
                  {bookdateConfigured && !bookdateApiKey.trim()
                    ? 'Test Connection & Fetch Models (using saved API key)'
                    : 'Test Connection & Fetch Models'}
                </Button>

                {/* Model Selection */}
                {bookdateModels.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Select Model
                    </label>
                    <select
                      value={bookdateModel}
                      onChange={(e) => setBookdateModel(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">-- Choose a model --</option>
                      {bookdateModels.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Note about per-user settings */}
                {(bookdateModels.length > 0 || bookdateConfigured) && bookdateModel && (
                  <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                    <p className="text-sm text-blue-800 dark:text-blue-300">
                      <strong>Note:</strong> Library scope and custom prompt preferences are now configured per-user.
                      Users can adjust these settings in their BookDate preferences (settings icon on the BookDate page).
                    </p>
                  </div>
                )}

                {/* Save Button */}
                {bookdateModel && (
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
                    <Button
                      onClick={handleSaveBookdateConfig}
                      loading={saving}
                      disabled={!bookdateModel}
                      className="w-full"
                    >
                      Save BookDate Configuration
                    </Button>
                  </div>
                )}

                {/* Clear Swipe History */}
                {bookdateConfigured && (
                  <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                      Clear All Swipe History
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                      Remove all swipe history and cached recommendations for ALL users. This will reset everyone's BookDate recommendations.
                    </p>
                    <Button
                      onClick={handleClearBookdateSwipes}
                      loading={clearingBookdateSwipes}
                      variant="outline"
                      className="border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
                    >
                      Clear Swipe History
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Account Tab - Only visible to local admin */}
            {activeTab === 'account' && isLocalAdmin && (
              <div className="space-y-6 max-w-2xl">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                    Account Security
                  </h2>
                  <p className="text-gray-600 dark:text-gray-400 mb-6">
                    Change your local admin account password.
                  </p>
                </div>

                {/* Info Box */}
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 mt-0.5">
                      <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="text-sm text-blue-800 dark:text-blue-200">
                      <p className="font-medium mb-1">Local Admin Account</p>
                      <p>
                        This password is for your local admin account created during setup.
                        This is separate from Plex authentication and is used to log in to the admin portal.
                      </p>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Current Password
                  </label>
                  <Input
                    type="password"
                    value={passwordForm.currentPassword}
                    onChange={(e) =>
                      setPasswordForm({ ...passwordForm, currentPassword: e.target.value })
                    }
                    placeholder="Enter current password"
                    autoComplete="current-password"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    New Password
                  </label>
                  <Input
                    type="password"
                    value={passwordForm.newPassword}
                    onChange={(e) =>
                      setPasswordForm({ ...passwordForm, newPassword: e.target.value })
                    }
                    placeholder="Enter new password"
                    autoComplete="new-password"
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Must be at least 8 characters
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Confirm New Password
                  </label>
                  <Input
                    type="password"
                    value={passwordForm.confirmPassword}
                    onChange={(e) =>
                      setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })
                    }
                    placeholder="Confirm new password"
                    autoComplete="new-password"
                  />
                </div>

                <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
                  <Button
                    onClick={changePassword}
                    loading={changingPassword}
                    disabled={
                      !passwordForm.currentPassword ||
                      !passwordForm.newPassword ||
                      !passwordForm.confirmPassword ||
                      passwordForm.newPassword.length < 8 ||
                      passwordForm.newPassword !== passwordForm.confirmPassword
                    }
                    className="w-full bg-blue-600 hover:bg-blue-700"
                  >
                    Change Password
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Footer - Hide for Account tab */}
          {activeTab !== 'account' && activeTab !== 'bookdate' && (
            <div className="bg-gray-50 dark:bg-gray-900 px-8 py-4 border-t border-gray-200 dark:border-gray-700">
              <div className="flex justify-end gap-4">
                <Button variant="outline" onClick={() => window.location.reload()}>
                  Cancel
                </Button>
                <Button
                  onClick={saveSettings}
                  loading={saving}
                  disabled={(() => {
                    // For Prowlarr tab: allow save if validated OR if URL/API key unchanged
                    if (activeTab === 'prowlarr' && originalSettings && settings) {
                      const connectionUnchanged =
                        settings.prowlarr.url === originalSettings.prowlarr.url &&
                        settings.prowlarr.apiKey === originalSettings.prowlarr.apiKey;
                      return !validated.prowlarr && !connectionUnchanged;
                    }
                    // For all other tabs: require validation
                    return !validated[activeTab];
                  })()}
                >
                  Save Changes
                </Button>
              </div>
              {(() => {
                // For Prowlarr: show message only if URL/API key changed and not validated
                if (activeTab === 'prowlarr' && originalSettings && settings) {
                  const connectionChanged =
                    settings.prowlarr.url !== originalSettings.prowlarr.url ||
                    settings.prowlarr.apiKey !== originalSettings.prowlarr.apiKey;
                  if (connectionChanged && !validated.prowlarr) {
                    return (
                      <p className="text-sm text-amber-600 dark:text-amber-400 mt-2 text-right">
                        Please test your connection before saving
                      </p>
                    );
                  }
                }
                // For other tabs: show message if not validated
                else if (!validated[activeTab]) {
                  return (
                    <p className="text-sm text-amber-600 dark:text-amber-400 mt-2 text-right">
                      Please test your connection before saving
                    </p>
                  );
                }
                return null;
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
