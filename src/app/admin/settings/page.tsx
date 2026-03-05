/**
 * Component: Admin Settings Page (Refactored Shell)
 * Documentation: documentation/settings-pages.md
 *
 * This is a refactored shell component that orchestrates the modular tab components.
 * Each tab has been extracted into its own component with dedicated hooks for state management.
 */

'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import Link from 'next/link';
import { fetchWithAuth } from '@/lib/utils/api';
import { IndexerFlagConfig } from '@/lib/utils/ranking-algorithm';

// Tab Components
import { LibraryTab } from './tabs/LibraryTab/LibraryTab';
import { AuthTab } from './tabs/AuthTab/AuthTab';
import { IndexersTab } from './tabs/IndexersTab/IndexersTab';
import { DownloadTab } from './tabs/DownloadTab/DownloadTab';
import { PathsTab } from './tabs/PathsTab/PathsTab';
import { EbookTab } from './tabs/EbookTab/EbookTab';
import { BookDateTab } from './tabs/BookDateTab/BookDateTab';
import { NotificationsTab } from './tabs/NotificationsTab';
import { ApiTab } from './tabs/ApiTab/ApiTab';

// Types and Helpers
import type { Settings, SettingsTab, IndexerConfig, SavedIndexerConfig, Message } from './lib/types';
import { parseArrayToCommaSeparated, saveTabSettings, validateAuthSettings, getTabValidation, getTabs } from './lib/helpers';

export default function AdminSettings() {
  // Core state
  const [settings, setSettings] = useState<Settings | null>(null);
  const [originalSettings, setOriginalSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>('library');

  // Validation state (tracks if each tab's settings are valid)
  const [validated, setValidated] = useState({
    plex: false,
    audiobookshelf: false,
    oidc: false,
    registration: false,
    prowlarr: false,
    download: false,
    paths: false,
  });

  // Indexer-specific state (used by IndexersTab)
  const [configuredIndexers, setConfiguredIndexers] = useState<SavedIndexerConfig[]>([]);
  const [originalConfiguredIndexers, setOriginalConfiguredIndexers] = useState<SavedIndexerConfig[]>([]);
  const [flagConfigs, setFlagConfigs] = useState<IndexerFlagConfig[]>([]);
  const [originalFlagConfigs, setOriginalFlagConfigs] = useState<IndexerFlagConfig[]>([]);

  // Initial data fetch
  useEffect(() => {
    fetchSettings();
  }, []);

  /**
   * Fetches all settings from the API
   */
  const fetchSettings = async () => {
    try {
      const response = await fetchWithAuth('/api/admin/settings');
      if (response.ok) {
        const data = await response.json();

        // Convert OIDC allowed lists from JSON arrays to comma-separated strings for display
        if (data.oidc) {
          data.oidc.allowedEmails = parseArrayToCommaSeparated(data.oidc.allowedEmails);
          data.oidc.allowedUsernames = parseArrayToCommaSeparated(data.oidc.allowedUsernames);
        }

        setSettings(data);
        setOriginalSettings(JSON.parse(JSON.stringify(data)));
      }
    } catch (error) {
      console.error('Failed to fetch settings:', error);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Fetches indexers from Prowlarr (used by IndexersTab)
   */
  const fetchIndexers = async (force = false) => {
    try {
      const response = await fetchWithAuth('/api/admin/settings/prowlarr/indexers');
      if (response.ok) {
        const data = await response.json();
        const flags = data.flagConfigs || [];
        setFlagConfigs(flags);
        setOriginalFlagConfigs(JSON.parse(JSON.stringify(flags)));

        // Extract configured indexers (enabled ones)
        const configured = (data.indexers || [])
          .filter((idx: IndexerConfig) => idx.enabled)
          .map((idx: IndexerConfig) => {
            const config: any = {
              id: idx.id,
              name: idx.name,
              protocol: idx.protocol,
              priority: idx.priority,
              rssEnabled: idx.rssEnabled,
              audiobookCategories: idx.audiobookCategories || [3030],
              ebookCategories: idx.ebookCategories || [7020],
            };

            // Add protocol-specific fields
            const isTorrent = idx.protocol?.toLowerCase() === 'torrent';
            if (isTorrent) {
              config.seedingTimeMinutes = idx.seedingTimeMinutes ?? 0;
            } else {
              config.removeAfterProcessing = idx.removeAfterProcessing ?? true;
            }

            return config;
          });
        setConfiguredIndexers(configured);
        setOriginalConfiguredIndexers(JSON.parse(JSON.stringify(configured)));
      } else {
        console.error('Failed to fetch indexers:', response.status);
        if (force) {
          setMessage({ type: 'error', text: 'Failed to load indexers. Check your Prowlarr settings.' });
        }
      }
    } catch (error) {
      console.error('Failed to fetch indexers:', error);
      if (force) {
        setMessage({ type: 'error', text: 'Failed to load Prowlarr indexers. Check your Prowlarr URL and API key.' });
      }
    }
  };

  /**
   * Saves settings for the currently active tab
   */
  const saveSettings = async () => {
    if (!settings) return;

    // Validate auth settings before saving
    if (activeTab === 'auth') {
      const validation = validateAuthSettings(settings);
      if (!validation.valid) {
        setMessage({ type: 'error', text: validation.message! });
        return;
      }
    }

    setSaving(true);
    setMessage(null);

    try {
      await saveTabSettings(activeTab, settings, configuredIndexers, flagConfigs);
      setMessage({ type: 'success', text: 'Settings saved successfully!' });
      setOriginalSettings(JSON.parse(JSON.stringify(settings)));

      // Also update original indexers and flag configs when saving prowlarr tab
      if (activeTab === 'prowlarr') {
        setOriginalConfiguredIndexers(JSON.parse(JSON.stringify(configuredIndexers)));
        setOriginalFlagConfigs(JSON.parse(JSON.stringify(flagConfigs)));
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

  // Loading state
  if (loading || !settings) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // Dynamic tabs, validation, and change detection
  const tabs = getTabs(settings.backendMode);
  const currentTabValidation = getTabValidation(activeTab, settings, originalSettings, validated);

  // Check for unsaved changes in settings and indexer-specific state
  const hasUnsavedChanges = (() => {
    const settingsChanged = JSON.stringify(settings) !== JSON.stringify(originalSettings);

    // For prowlarr tab, also check indexers and flag configs
    if (activeTab === 'prowlarr') {
      const indexersChanged = JSON.stringify(configuredIndexers) !== JSON.stringify(originalConfiguredIndexers);
      const flagConfigsChanged = JSON.stringify(flagConfigs) !== JSON.stringify(originalFlagConfigs);
      return settingsChanged || indexersChanged || flagConfigsChanged;
    }

    return settingsChanged;
  })();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="sticky top-0 z-10 mb-8 flex items-center justify-between bg-gray-50 dark:bg-gray-900 py-4 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              Settings
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-2">
              Configure system integrations and preferences
            </p>
          </div>
          <Link
            href="/admin"
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            <span>Back to Dashboard</span>
          </Link>
        </div>

        {/* Tab Navigation */}
        <div className="mb-6 border-b border-gray-200 dark:border-gray-700">
          <nav className="flex space-x-8 overflow-x-auto" aria-label="Tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2
                  ${
                    activeTab === tab.id
                      ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                  }
                `}
              >
                <span>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Message Display */}
        {message && (
          <div
            className={`mb-6 p-4 rounded-lg ${
              message.type === 'success'
                ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200'
                : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Tab Content */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          {/* Library Tab */}
          {activeTab === 'library' && (
            <LibraryTab
              settings={settings}
              onChange={setSettings}
              onValidationChange={(section, isValid) => {
                setValidated({ ...validated, [section]: isValid });
              }}
              onSuccess={(msg) => setMessage({ type: 'success', text: msg })}
              onError={(msg) => setMessage({ type: 'error', text: msg })}
            />
          )}

          {/* Auth Tab (only in Audiobookshelf mode) */}
          {activeTab === 'auth' && settings?.backendMode === 'audiobookshelf' && (
            <AuthTab
              settings={settings}
              onChange={setSettings}
              onValidationChange={(section, isValid) => {
                setValidated({ ...validated, [section]: isValid });
              }}
              onSuccess={(msg) => setMessage({ type: 'success', text: msg })}
              onError={(msg) => setMessage({ type: 'error', text: msg })}
            />
          )}

          {/* Indexers Tab */}
          {activeTab === 'prowlarr' && (
            <IndexersTab
              settings={settings}
              originalSettings={originalSettings}
              indexers={configuredIndexers}
              flagConfigs={flagConfigs}
              onChange={setSettings}
              onIndexersChange={setConfiguredIndexers}
              onFlagConfigsChange={setFlagConfigs}
              onValidationChange={(isValid) => setValidated({ ...validated, prowlarr: isValid })}
              onRefreshIndexers={() => fetchIndexers(true)}
            />
          )}

          {/* Download Client Tab */}
          {activeTab === 'download' && (
            <DownloadTab
              downloadClient={settings.downloadClient}
              onChange={(dc) => setSettings({ ...settings, downloadClient: dc })}
              onValidationChange={(isValid) => setValidated({ ...validated, download: isValid })}
            />
          )}

          {/* Paths Tab */}
          {activeTab === 'paths' && (
            <PathsTab
              paths={settings.paths}
              onChange={(paths) => setSettings({ ...settings, paths })}
              onValidationChange={(isValid) => setValidated({ ...validated, paths: isValid })}
            />
          )}

          {/* E-book Sidecar Tab */}
          {activeTab === 'ebook' && (
            <EbookTab
              ebook={settings.ebook}
              onChange={(ebook) => setSettings({ ...settings, ebook })}
              onSuccess={(msg) => setMessage({ type: 'success', text: msg })}
              onError={(msg) => setMessage({ type: 'error', text: msg })}
              markAsSaved={() => setOriginalSettings(JSON.parse(JSON.stringify(settings)))}
            />
          )}

          {/* BookDate Tab */}
          {activeTab === 'bookdate' && (
            <BookDateTab
              onSuccess={(msg) => setMessage({ type: 'success', text: msg })}
              onError={(msg) => setMessage({ type: 'error', text: msg })}
            />
          )}

          {/* Notifications Tab */}
          {activeTab === 'notifications' && <NotificationsTab />}

          {/* API Tab */}
          {activeTab === 'api' && <ApiTab />}

          {/* Save Button (only for tabs that save through main page) */}
          {activeTab !== 'ebook' && activeTab !== 'bookdate' && activeTab !== 'notifications' && activeTab !== 'api' && (
            <div className="mt-8 flex gap-4">
              <Button
                onClick={saveSettings}
                disabled={saving || !currentTabValidation || !hasUnsavedChanges}
                variant="primary"
              >
                {saving ? 'Saving...' : 'Save Settings'}
              </Button>
              {!currentTabValidation && hasUnsavedChanges && (
                <p className="text-sm text-gray-500 dark:text-gray-400 self-center">
                  {activeTab === 'prowlarr'
                    ? 'Please test the Prowlarr connection before saving'
                    : 'Please test the connection before saving'}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
