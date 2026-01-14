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
import { IndexerFlagConfig } from '@/lib/utils/ranking-algorithm';
import { FlagConfigRow } from '@/components/admin/FlagConfigRow';
import { IndexersTab } from './tabs/IndexersTab';

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
  categories?: number[];
  supportsRss?: boolean;
}

interface Settings {
  backendMode: 'plex' | 'audiobookshelf';
  hasLocalUsers: boolean;
  audibleRegion: string;
  plex: {
    url: string;
    token: string;
    libraryId: string;
    triggerScanAfterImport: boolean;
  };
  audiobookshelf: {
    serverUrl: string;
    apiToken: string;
    libraryId: string;
    triggerScanAfterImport: boolean;
  };
  oidc: {
    enabled: boolean;
    providerName: string;
    issuerUrl: string;
    clientId: string;
    clientSecret: string;
    accessControlMethod: string;
    accessGroupClaim: string;
    accessGroupValue: string;
    allowedEmails: string;
    allowedUsernames: string;
    adminClaimEnabled: boolean;
    adminClaimName: string;
    adminClaimValue: string;
  };
  registration: {
    enabled: boolean;
    requireAdminApproval: boolean;
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
    disableSSLVerify: boolean;
    remotePathMappingEnabled: boolean;
    remotePath: string;
    localPath: string;
  };
  paths: {
    downloadDir: string;
    mediaDir: string;
    metadataTaggingEnabled: boolean;
    chapterMergingEnabled: boolean;
  };
  ebook: {
    enabled: boolean;
    preferredFormat: string;
    baseUrl: string;
    flaresolverrUrl: string;
  };
}

interface PendingUser {
  id: string;
  plexUsername: string;
  plexEmail: string | null;
  authProvider: string | null;
  createdAt: string;
}

interface ABSLibrary {
  id: string;
  name: string;
  type: string;
  itemCount: number;
}

export default function AdminSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [originalSettings, setOriginalSettings] = useState<Settings | null>(null); // Track original values
  const [plexLibraries, setPlexLibraries] = useState<PlexLibrary[]>([]);
  const [absLibraries, setAbsLibraries] = useState<ABSLibrary[]>([]);
  const [indexers, setIndexers] = useState<IndexerConfig[]>([]);
  const [configuredIndexers, setConfiguredIndexers] = useState<Array<{id: number; name: string; priority: number; seedingTimeMinutes: number; rssEnabled: boolean; categories: number[]}>>([]);
  const [flagConfigs, setFlagConfigs] = useState<IndexerFlagConfig[]>([]);
  const [pendingUsers, setPendingUsers] = useState<PendingUser[]>([]);
  const [isLocalAdmin, setIsLocalAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingLibraries, setLoadingLibraries] = useState(false);
  const [loadingIndexers, setLoadingIndexers] = useState(false);
  const [loadingPendingUsers, setLoadingPendingUsers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [validated, setValidated] = useState({
    plex: false,
    audiobookshelf: false,
    oidc: false,
    registration: false,
    prowlarr: false,
    download: false,
    paths: false,
  });
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string }>>({});
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );
  const [activeTab, setActiveTab] = useState<'library' | 'auth' | 'prowlarr' | 'download' | 'paths' | 'ebook' | 'bookdate'>('library');

  // BookDate configuration state
  const [bookdateProvider, setBookdateProvider] = useState<string>('openai');
  const [bookdateApiKey, setBookdateApiKey] = useState<string>('');
  const [bookdateModel, setBookdateModel] = useState<string>('');
  const [bookdateBaseUrl, setBookdateBaseUrl] = useState<string>('');
  const [bookdateEnabled, setBookdateEnabled] = useState<boolean>(true);
  const [bookdateConfigured, setBookdateConfigured] = useState<boolean>(false);
  const [bookdateModels, setBookdateModels] = useState<{ id: string; name: string }[]>([]);
  const [testingBookdate, setTestingBookdate] = useState(false);
  const [clearingBookdateSwipes, setClearingBookdateSwipes] = useState(false);

  // FlareSolverr testing state
  const [testingFlaresolverr, setTestingFlaresolverr] = useState(false);
  const [flaresolverrTestResult, setFlaresolverrTestResult] = useState<{
    success: boolean;
    message: string;
    responseTime?: number;
  } | null>(null);

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

    if (activeTab === 'library' && settings.backendMode === 'plex' && settings.plex.url && settings.plex.token) {
      fetchPlexLibraries();
    } else if (activeTab === 'library' && settings.backendMode === 'audiobookshelf' && settings.audiobookshelf.serverUrl && settings.audiobookshelf.apiToken) {
      fetchABSLibraries();
    }
  }, [activeTab, settings?.plex.url, settings?.plex.token, settings?.audiobookshelf.serverUrl, settings?.audiobookshelf.apiToken, settings?.backendMode]);

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

  useEffect(() => {
    if (activeTab === 'auth' && settings?.registration.requireAdminApproval) {
      fetchPendingUsers();
    }
  }, [activeTab, settings?.registration.requireAdminApproval]);

  const fetchSettings = async () => {
    try {
      const response = await fetchWithAuth('/api/admin/settings');
      if (response.ok) {
        const data = await response.json();

        // Convert OIDC allowed lists from JSON arrays to comma-separated strings for display
        if (data.oidc) {
          const parseArrayToCommaSeparated = (jsonStr: string): string => {
            try {
              const arr = JSON.parse(jsonStr);
              return Array.isArray(arr) ? arr.join(', ') : '';
            } catch {
              return '';
            }
          };

          data.oidc.allowedEmails = parseArrayToCommaSeparated(data.oidc.allowedEmails);
          data.oidc.allowedUsernames = parseArrayToCommaSeparated(data.oidc.allowedUsernames);
        }

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

  const fetchABSLibraries = async (force = false) => {
    if (!force && absLibraries.length > 0) return; // Already loaded

    setLoadingLibraries(true);
    try {
      const response = await fetchWithAuth('/api/admin/settings/audiobookshelf/libraries');
      if (response.ok) {
        const data = await response.json();
        setAbsLibraries(data.libraries || []);
      } else {
        const data = await response.json();
        console.error('Failed to fetch ABS libraries:', data);
        setMessage({ type: 'error', text: data.message || 'Failed to load Audiobookshelf libraries. Check your server URL and API token.' });
      }
    } catch (error) {
      console.error('Failed to fetch ABS libraries:', error);
      setMessage({ type: 'error', text: 'Failed to load Audiobookshelf libraries. Check your server URL and API token.' });
    } finally {
      setLoadingLibraries(false);
    }
  };

  const fetchPendingUsers = async () => {
    setLoadingPendingUsers(true);
    try {
      const response = await fetchWithAuth('/api/admin/users/pending');
      if (response.ok) {
        const data = await response.json();
        setPendingUsers(data.users || []);
      } else {
        console.error('Failed to fetch pending users:', response.status);
      }
    } catch (error) {
      console.error('Failed to fetch pending users:', error);
    } finally {
      setLoadingPendingUsers(false);
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
        setFlagConfigs(data.flagConfigs || []);

        // Extract configured indexers (enabled ones) for the new IndexerManagement component
        const configured = (data.indexers || [])
          .filter((idx: IndexerConfig) => idx.enabled)
          .map((idx: IndexerConfig) => ({
            id: idx.id,
            name: idx.name,
            priority: idx.priority,
            seedingTimeMinutes: idx.seedingTimeMinutes,
            rssEnabled: idx.rssEnabled,
            categories: idx.categories || [3030], // Include categories, default to audiobooks
          }));
        setConfiguredIndexers(configured);
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
        setBookdateBaseUrl(data.config.baseUrl || '');
        setBookdateEnabled(data.config.isEnabled !== false); // Default to true
        setBookdateConfigured(data.config.isVerified || false);
      }
    } catch (error) {
      console.error('Failed to load BookDate config:', error);
    }
  };

  const handleTestBookdateConnection = async () => {
    const hasApiKey = bookdateApiKey.trim().length > 0;

    // Validation
    if (bookdateProvider === 'custom') {
      if (!bookdateBaseUrl.trim()) {
        setMessage({ type: 'error', text: 'Please enter a base URL for custom provider' });
        return;
      }
    } else {
      // Allow testing with saved API key if already configured
      if (!hasApiKey && !bookdateConfigured) {
        setMessage({ type: 'error', text: 'Please enter an API key' });
        return;
      }
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
      } else if (bookdateProvider !== 'custom') {
        payload.useSavedKey = true;
      }

      // Include baseUrl for custom provider
      if (bookdateProvider === 'custom') {
        payload.baseUrl = bookdateBaseUrl;
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

    // Validate: baseUrl required for custom provider
    if (bookdateProvider === 'custom') {
      if (!bookdateBaseUrl.trim()) {
        setMessage({ type: 'error', text: 'Please enter a base URL for custom provider' });
        return;
      }
    } else {
      // Only require API key if not already configured OR if user entered one
      const hasApiKey = bookdateApiKey.trim().length > 0;
      if (!bookdateConfigured && !hasApiKey) {
        setMessage({ type: 'error', text: 'Please enter an API key for initial setup' });
        return;
      }
    }

    setSaving(true);
    setMessage(null);

    try {
      const hasApiKey = bookdateApiKey.trim().length > 0;
      const payload: any = {
        provider: bookdateProvider,
        model: bookdateModel,
        isEnabled: bookdateEnabled,
      };

      // Only include API key if user entered a new one
      if (hasApiKey) {
        payload.apiKey = bookdateApiKey;
      }

      // Include baseUrl for custom provider
      if (bookdateProvider === 'custom') {
        payload.baseUrl = bookdateBaseUrl;
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

  const handleSaveEbookSettings = async () => {
    if (!settings) return;

    setSaving(true);
    setMessage(null);

    try {
      const response = await fetchWithAuth('/api/admin/settings/ebook', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: settings.ebook?.enabled || false,
          format: settings.ebook?.preferredFormat || 'epub',
          baseUrl: settings.ebook?.baseUrl || 'https://annas-archive.li',
          flaresolverrUrl: settings.ebook?.flaresolverrUrl || '',
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save e-book settings');
      }

      setMessage({ type: 'success', text: 'E-book sidecar settings saved successfully!' });
      // Update original settings to reflect the saved state
      setOriginalSettings(JSON.parse(JSON.stringify(settings)));
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to save e-book settings',
      });
    } finally {
      setSaving(false);
    }
  };

  const testFlaresolverrConnection = async () => {
    if (!settings?.ebook?.flaresolverrUrl) {
      setFlaresolverrTestResult({
        success: false,
        message: 'Please enter a FlareSolverr URL first',
      });
      return;
    }

    setTestingFlaresolverr(true);
    setFlaresolverrTestResult(null);

    try {
      const response = await fetchWithAuth('/api/admin/settings/ebook/test-flaresolverr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: settings.ebook.flaresolverrUrl }),
      });

      const result = await response.json();
      setFlaresolverrTestResult(result);
    } catch (error) {
      setFlaresolverrTestResult({
        success: false,
        message: error instanceof Error ? error.message : 'Test failed',
      });
    } finally {
      setTestingFlaresolverr(false);
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

  const testABSConnection = async () => {
    if (!settings) return;

    setTesting(true);
    setMessage(null);

    try {
      const response = await fetchWithAuth('/api/setup/test-abs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverUrl: settings.audiobookshelf.serverUrl,
          apiToken: settings.audiobookshelf.apiToken,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setValidated({ ...validated, audiobookshelf: true });
        setTestResults({ ...testResults, audiobookshelf: { success: true, message: `Connected to Audiobookshelf` } });
        setMessage({ type: 'success', text: 'Connected to Audiobookshelf. You can now save.' });
        // Update libraries
        if (data.libraries) {
          setAbsLibraries(data.libraries);
        }
      } else {
        setValidated({ ...validated, audiobookshelf: false });
        setTestResults({ ...testResults, audiobookshelf: { success: false, message: data.error || 'Connection failed' } });
        setMessage({ type: 'error', text: data.error || 'Failed to connect to Audiobookshelf' });
      }
    } catch (error) {
      setValidated({ ...validated, audiobookshelf: false });
      const errorMsg = error instanceof Error ? error.message : 'Failed to test connection';
      setTestResults({ ...testResults, audiobookshelf: { success: false, message: errorMsg } });
      setMessage({ type: 'error', text: errorMsg });
    } finally {
      setTesting(false);
    }
  };

  const testOIDCConnection = async () => {
    if (!settings) return;

    setTesting(true);
    setMessage(null);

    try {
      const response = await fetchWithAuth('/api/setup/test-oidc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issuerUrl: settings.oidc.issuerUrl,
          clientId: settings.oidc.clientId,
          clientSecret: settings.oidc.clientSecret,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setValidated({ ...validated, oidc: true });
        setTestResults({ ...testResults, oidc: { success: true, message: 'OIDC configuration is valid' } });
        setMessage({ type: 'success', text: 'OIDC configuration is valid. You can now save.' });
      } else {
        setValidated({ ...validated, oidc: false });
        setTestResults({ ...testResults, oidc: { success: false, message: data.error || 'Connection failed' } });
        setMessage({ type: 'error', text: data.error || 'Failed to validate OIDC configuration' });
      }
    } catch (error) {
      setValidated({ ...validated, oidc: false });
      const errorMsg = error instanceof Error ? error.message : 'Failed to test OIDC connection';
      setTestResults({ ...testResults, oidc: { success: false, message: errorMsg } });
      setMessage({ type: 'error', text: errorMsg });
    } finally {
      setTesting(false);
    }
  };

  const approveUser = async (userId: string, approve: boolean) => {
    try {
      const response = await fetchWithAuth(`/api/admin/users/${userId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approve }),
      });

      const data = await response.json();

      if (data.success) {
        setMessage({ type: 'success', text: data.message });
        // Refresh pending users list
        await fetchPendingUsers();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to process user approval' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to process user approval' });
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
          disableSSLVerify: settings.downloadClient.disableSSLVerify,
          remotePathMappingEnabled: settings.downloadClient.remotePathMappingEnabled,
          remotePath: settings.downloadClient.remotePath,
          localPath: settings.downloadClient.localPath,
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

  const saveSettings = async () => {
    if (!settings) return;

    setSaving(true);
    setMessage(null);

    try {
      // Save settings based on active tab
      switch (activeTab) {
        case 'library':
          // Save Audible region (common to both backends)
          const audibleResponse = await fetchWithAuth('/api/admin/settings/audible', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ region: settings.audibleRegion }),
          });

          if (!audibleResponse.ok) {
            throw new Error('Failed to save Audible region settings');
          }

          // Save backend-specific settings
          if (settings.backendMode === 'plex') {
            const plexResponse = await fetchWithAuth('/api/admin/settings/plex', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(settings.plex),
            });

            if (!plexResponse.ok) {
              throw new Error('Failed to save Plex settings');
            }
          } else {
            const absResponse = await fetchWithAuth('/api/admin/settings/audiobookshelf', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(settings.audiobookshelf),
            });

            if (!absResponse.ok) {
              throw new Error('Failed to save Audiobookshelf settings');
            }
          }
          break;

        case 'auth':
          // Validate: In Audiobookshelf mode, at least one auth method must be enabled OR local users must exist
          if (settings.backendMode === 'audiobookshelf') {
            if (!settings.oidc.enabled && !settings.registration.enabled && !settings.hasLocalUsers) {
              setMessage({
                type: 'error',
                text: 'At least one authentication method must be enabled (OIDC or Manual Registration) since no local users exist. Otherwise, you will be locked out of the system.',
              });
              setSaving(false);
              return;
            }
          }

          // Save OIDC settings if OIDC is enabled
          if (settings.oidc.enabled) {
            // Helper function to parse comma-separated strings into JSON arrays
            const parseCommaSeparatedToArray = (str: string): string => {
              if (!str || str.trim() === '') return '[]';
              const items = str.split(',').map(s => s.trim()).filter(s => s.length > 0);
              return JSON.stringify(items);
            };

            const oidcPayload = {
              ...settings.oidc,
              allowedEmails: parseCommaSeparatedToArray(settings.oidc.allowedEmails),
              allowedUsernames: parseCommaSeparatedToArray(settings.oidc.allowedUsernames),
            };

            const oidcResponse = await fetchWithAuth('/api/admin/settings/oidc', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(oidcPayload),
            });

            if (!oidcResponse.ok) {
              throw new Error('Failed to save OIDC settings');
            }
          }

          // Save registration settings
          const registrationResponse = await fetchWithAuth('/api/admin/settings/registration', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings.registration),
          });

          if (!registrationResponse.ok) {
            throw new Error('Failed to save registration settings');
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

          // Save indexer configuration and flag configs
          // Convert configured indexers to the format expected by the API (with enabled: true)
          const indexersForSave = configuredIndexers.map((idx) => ({
            ...idx,
            enabled: true,
          }));

          const indexersResponse = await fetchWithAuth('/api/admin/settings/prowlarr/indexers', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ indexers: indexersForSave, flagConfigs }),
          });

          if (!indexersResponse.ok) {
            throw new Error('Failed to save indexer configuration');
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
    { id: 'library', label: settings?.backendMode === 'plex' ? 'Plex' : 'Audiobookshelf', icon: '📺' },
    ...(settings?.backendMode === 'audiobookshelf' ? [{ id: 'auth', label: 'Authentication', icon: '🔐' }] : []),
    { id: 'prowlarr', label: 'Indexers', icon: '🔍' },
    { id: 'download', label: 'Download Client', icon: '⬇️' },
    { id: 'paths', label: 'Paths', icon: '📁' },
    { id: 'ebook', label: 'E-book Sidecar', icon: '📖' },
    { id: 'bookdate', label: 'BookDate', icon: '📚' },
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

        {/* Backend Mode Display */}
        <div className="mb-6 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 mt-0.5">
              <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="text-sm text-blue-800 dark:text-blue-200">
              <p className="font-medium mb-1">Backend Mode: {settings?.backendMode === 'plex' ? 'Plex' : 'Audiobookshelf'}</p>
              <p>
                ⚠️ Backend mode cannot be changed after setup. To switch backends, you must reset the instance and run the setup wizard again.
              </p>
            </div>
          </div>
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
                    if (tab.id === 'library') {
                      if (settings?.backendMode === 'plex') {
                        fetchPlexLibraries();
                      } else {
                        fetchABSLibraries();
                      }
                    }
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
            {/* Library Tab - Conditional (Plex or Audiobookshelf) */}
            {activeTab === 'library' && settings?.backendMode === 'plex' && (
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

                <div className="space-y-2">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.plex.triggerScanAfterImport}
                      onChange={(e) => {
                        setSettings({
                          ...settings,
                          plex: { ...settings.plex, triggerScanAfterImport: e.target.checked },
                        });
                      }}
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
                    />
                    <div className="flex-1">
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Trigger library scan after import
                      </span>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Automatically triggers Plex to scan its filesystem after organizing downloaded files.
                        Only enable this if you have Plex's filesystem watcher (automatic scanning) disabled.
                        Most users should leave this disabled and rely on Plex's built-in automatic detection.
                      </p>
                    </div>
                  </label>
                </div>

                {/* Audible Region Selection */}
                <div className="border-t border-gray-200 dark:border-gray-700 pt-6 space-y-2">
                  <label
                    htmlFor="audible-region"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    Audible Region
                  </label>
                  <select
                    id="audible-region"
                    value={settings.audibleRegion || 'us'}
                    onChange={(e) => {
                      setSettings({
                        ...settings,
                        audibleRegion: e.target.value,
                      });
                    }}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="us">United States</option>
                    <option value="ca">Canada</option>
                    <option value="uk">United Kingdom</option>
                    <option value="au">Australia</option>
                    <option value="in">India</option>
                  </select>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Select the Audible region that matches your metadata engine (Audnexus/Audible Agent)
                    configuration in Plex. This ensures accurate book matching and metadata.
                  </p>
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

            {/* Audiobookshelf Tab */}
            {activeTab === 'library' && settings?.backendMode === 'audiobookshelf' && (
              <div className="space-y-6 max-w-2xl">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                    Audiobookshelf Server
                  </h2>
                  <p className="text-gray-600 dark:text-gray-400 mb-6">
                    Configure your Audiobookshelf server connection and audiobook library.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Server URL
                  </label>
                  <Input
                    type="url"
                    value={settings.audiobookshelf.serverUrl}
                    onChange={(e) => {
                      setSettings({
                        ...settings,
                        audiobookshelf: { ...settings.audiobookshelf, serverUrl: e.target.value },
                      });
                      setValidated({ ...validated, audiobookshelf: false });
                    }}
                    placeholder="http://localhost:13378"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    API Token
                  </label>
                  <Input
                    type="password"
                    value={settings.audiobookshelf.apiToken}
                    onChange={(e) => {
                      setSettings({
                        ...settings,
                        audiobookshelf: { ...settings.audiobookshelf, apiToken: e.target.value },
                      });
                      setValidated({ ...validated, audiobookshelf: false });
                    }}
                    placeholder="Enter your Audiobookshelf API token"
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Generate in Audiobookshelf: Settings → API Keys → Add API Key
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
                  ) : absLibraries.length > 0 ? (
                    <select
                      value={settings.audiobookshelf.libraryId}
                      onChange={(e) => {
                        setSettings({
                          ...settings,
                          audiobookshelf: { ...settings.audiobookshelf, libraryId: e.target.value },
                        });
                        setValidated({ ...validated, audiobookshelf: false });
                      }}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                    >
                      <option value="">Select a library...</option>
                      {absLibraries.map((lib) => (
                        <option key={lib.id} value={lib.id}>
                          {lib.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="text-sm text-gray-500 py-2">
                      Test your connection to load libraries.
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.audiobookshelf.triggerScanAfterImport}
                      onChange={(e) => {
                        setSettings({
                          ...settings,
                          audiobookshelf: { ...settings.audiobookshelf, triggerScanAfterImport: e.target.checked },
                        });
                      }}
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
                    />
                    <div className="flex-1">
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Trigger library scan after import
                      </span>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Automatically triggers Audiobookshelf to scan its filesystem after organizing downloaded files.
                        Only enable this if you have Audiobookshelf's filesystem watcher (automatic scanning) disabled.
                        Most users should leave this disabled and rely on Audiobookshelf's built-in automatic detection.
                      </p>
                    </div>
                  </label>
                </div>

                {/* Audible Region Selection */}
                <div className="border-t border-gray-200 dark:border-gray-700 pt-6 space-y-2">
                  <label
                    htmlFor="audible-region-abs"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    Audible Region
                  </label>
                  <select
                    id="audible-region-abs"
                    value={settings.audibleRegion || 'us'}
                    onChange={(e) => {
                      setSettings({
                        ...settings,
                        audibleRegion: e.target.value,
                      });
                    }}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="us">United States</option>
                    <option value="ca">Canada</option>
                    <option value="uk">United Kingdom</option>
                    <option value="au">Australia</option>
                    <option value="in">India</option>
                  </select>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Select the Audible region that matches your metadata engine (Audnexus/Audible Agent)
                    configuration in Audiobookshelf. This ensures accurate book matching and metadata.
                  </p>
                </div>

                <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
                  <Button
                    onClick={testABSConnection}
                    loading={testing}
                    disabled={!settings.audiobookshelf.serverUrl || !settings.audiobookshelf.apiToken}
                    variant="outline"
                    className="w-full"
                  >
                    Test Connection
                  </Button>
                  {testResults.audiobookshelf && (
                    <div className={`mt-3 p-3 rounded-lg text-sm ${
                      testResults.audiobookshelf.success
                        ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200'
                        : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
                    }`}>
                      {testResults.audiobookshelf.message}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Prowlarr/Indexers Tab */}
            {activeTab === 'prowlarr' && (
              <IndexersTab
                settings={settings}
                originalSettings={originalSettings}
                indexers={configuredIndexers}
                flagConfigs={flagConfigs}
                onSettingsChange={setSettings}
                onIndexersChange={setConfiguredIndexers}
                onFlagConfigsChange={setFlagConfigs}
                onValidationChange={setValidated}
                validated={validated}
              />
            )}

            {/* Download Client Tab */}
            {activeTab === 'download' && (
              <div className="space-y-6 max-w-2xl">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                    Download Client
                  </h2>
                  <p className="text-gray-600 dark:text-gray-400 mb-6">
                    Configure your download client: qBittorrent for torrents or SABnzbd for Usenet/NZB downloads.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Client Type
                  </label>
                  <select
                    value={settings.downloadClient.type}
                    onChange={(e) => {
                      // Clear credentials when switching client types
                      setSettings({
                        ...settings,
                        downloadClient: {
                          ...settings.downloadClient,
                          type: e.target.value,
                          username: '', // Clear username (only used by qBittorrent)
                          password: '', // Clear password/API key
                        },
                      });
                      setValidated({ ...validated, download: false });
                    }}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  >
                    <option value="qbittorrent">qBittorrent</option>
                    <option value="sabnzbd">SABnzbd</option>
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

                {/* qBittorrent: Username + Password */}
                {settings.downloadClient.type === 'qbittorrent' && (
                  <>
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
                  </>
                )}

                {/* SABnzbd: API Key only */}
                {settings.downloadClient.type === 'sabnzbd' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      API Key
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
                      placeholder="Enter SABnzbd API key"
                    />
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      Find this in SABnzbd under Config → General → API Key
                    </p>
                  </div>
                )}

                {/* SSL Verification Toggle */}
                {settings.downloadClient.url.startsWith('https') && (
                  <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-4 border border-yellow-200 dark:border-yellow-800">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        id="disable-ssl-verify"
                        checked={settings.downloadClient.disableSSLVerify}
                        onChange={(e) => {
                          setSettings({
                            ...settings,
                            downloadClient: {
                              ...settings.downloadClient,
                              disableSSLVerify: e.target.checked,
                            },
                          });
                          setValidated({ ...validated, download: false });
                        }}
                        className="mt-1 h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
                      />
                      <div className="flex-1">
                        <label
                          htmlFor="disable-ssl-verify"
                          className="block text-sm font-medium text-gray-900 dark:text-gray-100 cursor-pointer"
                        >
                          Disable SSL Certificate Verification
                        </label>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                          Enable this if you're using a self-signed certificate or getting SSL errors.
                          <span className="text-yellow-700 dark:text-yellow-500 font-medium"> ⚠️ Only use on trusted private networks.</span>
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Remote Path Mapping */}
                <div className="mt-6 bg-gray-50 dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                  <div className="flex items-start gap-4">
                    <input
                      type="checkbox"
                      id="remote-path-mapping"
                      checked={settings.downloadClient.remotePathMappingEnabled}
                      onChange={(e) => {
                        setSettings({
                          ...settings,
                          downloadClient: {
                            ...settings.downloadClient,
                            remotePathMappingEnabled: e.target.checked,
                          },
                        });
                        setValidated({ ...validated, download: false });
                      }}
                      className="mt-1 h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
                    />
                    <div className="flex-1">
                      <label
                        htmlFor="remote-path-mapping"
                        className="block text-sm font-medium text-gray-900 dark:text-gray-100 cursor-pointer"
                      >
                        Enable Remote Path Mapping
                      </label>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        Use this when qBittorrent runs on a different machine or uses different mount points (e.g., remote seedbox, Docker containers)
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 font-mono">
                        Example: Remote <span className="text-blue-600 dark:text-blue-400">/remote/mnt/d/done</span> → Local <span className="text-green-600 dark:text-green-400">/downloads</span>
                      </p>

                      {/* Warning for existing downloads */}
                      {settings.downloadClient.remotePathMappingEnabled && (
                        <div className="mt-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                          <p className="text-sm text-yellow-800 dark:text-yellow-200">
                            ⚠️ <strong>Note:</strong> Path mapping only affects new downloads. In-progress downloads will continue using their original paths.
                          </p>
                        </div>
                      )}

                      {/* Conditional Fields */}
                      {settings.downloadClient.remotePathMappingEnabled && (
                        <div className="mt-4 grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              Remote Path (from qBittorrent)
                            </label>
                            <Input
                              type="text"
                              placeholder="/remote/mnt/d/done"
                              value={settings.downloadClient.remotePath}
                              onChange={(e) => {
                                setSettings({
                                  ...settings,
                                  downloadClient: {
                                    ...settings.downloadClient,
                                    remotePath: e.target.value,
                                  },
                                });
                                setValidated({ ...validated, download: false });
                              }}
                            />
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                              The path prefix as reported by qBittorrent
                            </p>
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              Local Path (for ReadMeABook)
                            </label>
                            <Input
                              type="text"
                              placeholder="/downloads"
                              value={settings.downloadClient.localPath}
                              onChange={(e) => {
                                setSettings({
                                  ...settings,
                                  downloadClient: {
                                    ...settings.downloadClient,
                                    localPath: e.target.value,
                                  },
                                });
                                setValidated({ ...validated, download: false });
                              }}
                            />
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                              The actual path where files are accessible
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
                  <Button
                    onClick={testDownloadClientConnection}
                    loading={testing}
                    disabled={
                      !settings.downloadClient.url ||
                      !settings.downloadClient.password ||
                      (settings.downloadClient.type === 'qbittorrent' && !settings.downloadClient.username)
                    }
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

                {/* Chapter Merging Toggle */}
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                  <div className="flex items-start gap-4">
                    <input
                      type="checkbox"
                      id="chapter-merging-settings"
                      checked={settings.paths.chapterMergingEnabled}
                      onChange={(e) => {
                        setSettings({
                          ...settings,
                          paths: { ...settings.paths, chapterMergingEnabled: e.target.checked },
                        });
                        setValidated({ ...validated, paths: false });
                      }}
                      className="mt-1 h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="flex-1">
                      <label
                        htmlFor="chapter-merging-settings"
                        className="block text-sm font-medium text-gray-900 dark:text-gray-100 cursor-pointer"
                      >
                        Auto-merge chapters to M4B
                      </label>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        Automatically merge multi-file chapter downloads into a single M4B audiobook with chapter
                        markers. Improves playback experience and library organization.
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

            {/* E-book Sidecar Tab */}
            {activeTab === 'ebook' && (
              <div className="space-y-6 max-w-2xl">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                    E-book Sidecar
                  </h2>
                  <p className="text-gray-600 dark:text-gray-400 mb-6">
                    Automatically download e-books from Anna's Archive to accompany your audiobooks.
                    E-books are placed in the same folder as the audiobook files.
                  </p>
                </div>

                {/* Enable Toggle */}
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                  <div className="flex items-start gap-4">
                    <input
                      type="checkbox"
                      id="ebook-enabled"
                      checked={settings.ebook?.enabled || false}
                      onChange={(e) => {
                        setSettings({
                          ...settings,
                          ebook: { ...settings.ebook, enabled: e.target.checked },
                        });
                      }}
                      className="mt-1 h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="flex-1">
                      <label
                        htmlFor="ebook-enabled"
                        className="block text-sm font-medium text-gray-900 dark:text-gray-100 cursor-pointer"
                      >
                        Enable e-book sidecar downloads
                      </label>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        When enabled, the system will search for e-books matching your audiobook's ASIN
                        and download them to the same folder.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Format Selection */}
                {settings.ebook?.enabled && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Preferred Format
                    </label>
                    <select
                      value={settings.ebook?.preferredFormat || 'epub'}
                      onChange={(e) => {
                        setSettings({
                          ...settings,
                          ebook: { ...settings.ebook, preferredFormat: e.target.value },
                        });
                      }}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                               bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                               focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="epub">EPUB</option>
                      <option value="pdf">PDF</option>
                      <option value="mobi">MOBI</option>
                      <option value="azw3">AZW3</option>
                      <option value="any">Any format</option>
                    </select>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                      EPUB is recommended for most e-readers. "Any format" will download the first available format.
                    </p>
                  </div>
                )}

                {/* Base URL (Advanced) */}
                {settings.ebook?.enabled && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Base URL (Advanced)
                    </label>
                    <Input
                      type="text"
                      value={settings.ebook?.baseUrl || 'https://annas-archive.li'}
                      onChange={(e) => {
                        setSettings({
                          ...settings,
                          ebook: { ...settings.ebook, baseUrl: e.target.value },
                        });
                      }}
                      placeholder="https://annas-archive.li"
                      className="font-mono"
                    />
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                      Change this if the primary Anna's Archive mirror is unavailable.
                    </p>
                  </div>
                )}

                {/* FlareSolverr (Optional - for Cloudflare bypass) */}
                {settings.ebook?.enabled && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        FlareSolverr URL (Optional)
                      </label>
                      <div className="flex gap-2">
                        <Input
                          type="text"
                          value={settings.ebook?.flaresolverrUrl || ''}
                          onChange={(e) => {
                            setSettings({
                              ...settings,
                              ebook: { ...settings.ebook, flaresolverrUrl: e.target.value },
                            });
                            setFlaresolverrTestResult(null);
                          }}
                          placeholder="http://localhost:8191"
                          className="font-mono flex-1"
                        />
                        <Button
                          onClick={testFlaresolverrConnection}
                          loading={testingFlaresolverr}
                          variant="secondary"
                          className="whitespace-nowrap"
                        >
                          Test Connection
                        </Button>
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        FlareSolverr helps bypass Cloudflare protection on Anna's Archive.
                        Leave empty if not needed.
                      </p>
                      {flaresolverrTestResult && (
                        <div
                          className={`mt-2 p-3 rounded-lg text-sm ${
                            flaresolverrTestResult.success
                              ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-800'
                              : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800'
                          }`}
                        >
                          {flaresolverrTestResult.success ? '✓ ' : '✗ '}
                          {flaresolverrTestResult.message}
                        </div>
                      )}
                    </div>
                    {!settings.ebook?.flaresolverrUrl && (
                      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                        <p className="text-sm text-amber-800 dark:text-amber-200">
                          <strong>Note:</strong> Without FlareSolverr, e-book downloads may fail if Anna's Archive
                          has Cloudflare protection enabled. Success rates are typically lower without it.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Info Box */}
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-2">
                    How it works
                  </h3>
                  <ul className="space-y-2 text-sm text-blue-800 dark:text-blue-200">
                    <li>• Searches Anna's Archive in two ways:</li>
                    <li className="ml-4">1. First tries ASIN (exact match - most accurate)</li>
                    <li className="ml-4">2. Falls back to title + author (with book/language filters)</li>
                    <li>• Downloads matching e-book in your preferred format</li>
                    <li>• Places e-book file in the same folder as the audiobook</li>
                    <li>• If no match is found or download fails, audiobook download continues normally</li>
                    <li>• Completely optional and non-blocking</li>
                  </ul>
                </div>

                {/* Warning Box */}
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-yellow-900 dark:text-yellow-100 mb-2">
                    ⚠️ Important Note
                  </h3>
                  <p className="text-sm text-yellow-800 dark:text-yellow-200">
                    Anna's Archive is a shadow library. Use of this feature is at your own discretion and responsibility.
                    Ensure compliance with your local laws and regulations.
                  </p>
                </div>

                {/* Save Button */}
                <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
                  <Button
                    onClick={handleSaveEbookSettings}
                    loading={saving}
                    className="w-full bg-blue-600 hover:bg-blue-700"
                  >
                    Save E-book Sidecar Settings
                  </Button>
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
                      setBookdateBaseUrl('');
                    }}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="openai">OpenAI</option>
                    <option value="claude">Claude (Anthropic)</option>
                    <option value="custom">Custom (OpenAI-compatible)</option>
                  </select>
                </div>

                {/* Base URL Input - Show for Custom Provider */}
                {bookdateProvider === 'custom' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Base URL <span className="text-red-500">*</span>
                    </label>
                    <Input
                      type="text"
                      value={bookdateBaseUrl}
                      onChange={(e) => {
                        setBookdateBaseUrl(e.target.value);
                        setBookdateModels([]);
                      }}
                      placeholder="http://localhost:11434/v1"
                    />
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                      Examples:
                      <br />• Ollama: <code>http://localhost:11434/v1</code>
                      <br />• LM Studio: <code>http://localhost:1234/v1</code>
                      <br />• vLLM: <code>http://localhost:8000/v1</code>
                    </p>
                  </div>
                )}

                {/* API Key */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {bookdateProvider === 'custom' ? 'API Key (Optional for local models)' : 'API Key'}
                    {bookdateProvider !== 'custom' && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  <Input
                    type="password"
                    value={bookdateApiKey}
                    onChange={(e) => {
                      setBookdateApiKey(e.target.value);
                      setBookdateModels([]);
                    }}
                    placeholder={
                      bookdateProvider === 'custom'
                        ? 'Leave blank for local models'
                        : bookdateConfigured
                          ? '••••••••••••••••'
                          : (bookdateProvider === 'openai' ? 'sk-...' : 'sk-ant-...')
                    }
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {bookdateProvider === 'custom'
                      ? 'Optional: Leave blank if your endpoint does not require authentication (e.g., Ollama, LM Studio)'
                      : 'The API key is stored securely and encrypted. Leave blank to keep existing key.'}
                  </p>
                </div>

                {/* Test Connection Button */}
                <Button
                  onClick={handleTestBookdateConnection}
                  loading={testingBookdate}
                  disabled={
                    bookdateProvider === 'custom'
                      ? !bookdateBaseUrl.trim()
                      : (!bookdateApiKey.trim() && !bookdateConfigured)
                  }
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

            {/* Authentication Tab - Only visible in ABS mode */}
            {activeTab === 'auth' && settings?.backendMode === 'audiobookshelf' && (
              <div className="space-y-8 max-w-2xl">
                {/* OIDC Settings Section */}
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                    OIDC Authentication
                  </h2>
                  <p className="text-gray-600 dark:text-gray-400 mb-6">
                    Configure OpenID Connect (OIDC) authentication for single sign-on with Authentik, Keycloak, or other providers.
                  </p>

                  <div className="space-y-4">
                    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                      <div className="flex items-start gap-4">
                        <input
                          type="checkbox"
                          id="oidc-enabled"
                          checked={settings.oidc.enabled}
                          onChange={(e) => {
                            setSettings({
                              ...settings,
                              oidc: { ...settings.oidc, enabled: e.target.checked },
                            });
                            setValidated({ ...validated, oidc: false });
                          }}
                          className="mt-1 h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <div className="flex-1">
                          <label
                            htmlFor="oidc-enabled"
                            className="block text-sm font-medium text-gray-900 dark:text-gray-100 cursor-pointer"
                          >
                            Enable OIDC Authentication
                          </label>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                            Allow users to log in using an external OIDC provider
                          </p>
                        </div>
                      </div>
                    </div>

                    {settings.oidc.enabled && (
                      <>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Provider Name
                          </label>
                          <Input
                            type="text"
                            value={settings.oidc.providerName}
                            onChange={(e) => {
                              setSettings({
                                ...settings,
                                oidc: { ...settings.oidc, providerName: e.target.value },
                              });
                              setValidated({ ...validated, oidc: false });
                            }}
                            placeholder="Authentik"
                          />
                          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            Display name for the login button
                          </p>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Issuer URL
                          </label>
                          <Input
                            type="url"
                            value={settings.oidc.issuerUrl}
                            onChange={(e) => {
                              setSettings({
                                ...settings,
                                oidc: { ...settings.oidc, issuerUrl: e.target.value },
                              });
                              setValidated({ ...validated, oidc: false });
                            }}
                            placeholder="https://auth.example.com/application/o/readmeabook/"
                          />
                          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            OIDC provider's issuer URL (must support .well-known/openid-configuration)
                          </p>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Client ID
                          </label>
                          <Input
                            type="text"
                            value={settings.oidc.clientId}
                            onChange={(e) => {
                              setSettings({
                                ...settings,
                                oidc: { ...settings.oidc, clientId: e.target.value },
                              });
                              setValidated({ ...validated, oidc: false });
                            }}
                            placeholder="readmeabook-client"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Client Secret
                          </label>
                          <Input
                            type="password"
                            value={settings.oidc.clientSecret}
                            onChange={(e) => {
                              setSettings({
                                ...settings,
                                oidc: { ...settings.oidc, clientSecret: e.target.value },
                              });
                              setValidated({ ...validated, oidc: false });
                            }}
                            placeholder="Enter client secret"
                          />
                        </div>

                        <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                          <Button
                            onClick={testOIDCConnection}
                            loading={testing}
                            disabled={!settings.oidc.issuerUrl || !settings.oidc.clientId || !settings.oidc.clientSecret}
                            variant="outline"
                            className="w-full"
                          >
                            Test OIDC Configuration
                          </Button>
                          {testResults.oidc && (
                            <div className={`mt-3 p-3 rounded-lg text-sm ${
                              testResults.oidc.success
                                ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200'
                                : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
                            }`}>
                              {testResults.oidc.message}
                            </div>
                          )}
                        </div>

                        {/* Access Control Section */}
                        <div className="border-t border-gray-200 dark:border-gray-700 pt-6 mt-6">
                          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
                            Access Control
                          </h3>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                            Control who can log in to your application. This is separate from admin permissions.
                          </p>

                          <div className="space-y-4">
                            <div>
                              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                Access Control Method
                              </label>
                              <select
                                value={settings.oidc.accessControlMethod}
                                onChange={(e) => {
                                  setSettings({
                                    ...settings,
                                    oidc: { ...settings.oidc, accessControlMethod: e.target.value },
                                  });
                                  setValidated({ ...validated, oidc: false });
                                }}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                              >
                                <option value="open">Open Access (anyone can log in)</option>
                                <option value="group_claim">Group/Claim Based</option>
                                <option value="allowed_list">Allowed List (emails/usernames)</option>
                                <option value="admin_approval">Admin Approval Required</option>
                              </select>
                              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                {settings.oidc.accessControlMethod === 'open' && 'Anyone who can authenticate with your OIDC provider will have access'}
                                {settings.oidc.accessControlMethod === 'group_claim' && 'Only users with a specific group/claim can access'}
                                {settings.oidc.accessControlMethod === 'allowed_list' && 'Only explicitly allowed users can access'}
                                {settings.oidc.accessControlMethod === 'admin_approval' && 'New users must be approved by an admin before access is granted'}
                              </p>
                            </div>

                            {settings.oidc.accessControlMethod === 'group_claim' && (
                              <>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    Group Claim Name
                                  </label>
                                  <Input
                                    type="text"
                                    value={settings.oidc.accessGroupClaim}
                                    onChange={(e) => {
                                      setSettings({
                                        ...settings,
                                        oidc: { ...settings.oidc, accessGroupClaim: e.target.value },
                                      });
                                      setValidated({ ...validated, oidc: false });
                                    }}
                                    placeholder="groups"
                                  />
                                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                    The OIDC claim field that contains group membership (usually "groups" or "roles")
                                  </p>
                                </div>

                                <div>
                                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    Required Group
                                  </label>
                                  <Input
                                    type="text"
                                    value={settings.oidc.accessGroupValue}
                                    onChange={(e) => {
                                      setSettings({
                                        ...settings,
                                        oidc: { ...settings.oidc, accessGroupValue: e.target.value },
                                      });
                                      setValidated({ ...validated, oidc: false });
                                    }}
                                    placeholder="readmeabook-users"
                                  />
                                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                    Users must be in this group to access the application
                                  </p>
                                </div>
                              </>
                            )}

                            {settings.oidc.accessControlMethod === 'allowed_list' && (
                              <>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    Allowed Emails (comma-separated)
                                  </label>
                                  <Input
                                    type="text"
                                    value={settings.oidc.allowedEmails}
                                    onChange={(e) => {
                                      setSettings({
                                        ...settings,
                                        oidc: { ...settings.oidc, allowedEmails: e.target.value },
                                      });
                                      setValidated({ ...validated, oidc: false });
                                    }}
                                    placeholder="user1@example.com, user2@example.com"
                                  />
                                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                    Enter email addresses separated by commas
                                  </p>
                                </div>

                                <div>
                                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    Allowed Usernames (comma-separated)
                                  </label>
                                  <Input
                                    type="text"
                                    value={settings.oidc.allowedUsernames}
                                    onChange={(e) => {
                                      setSettings({
                                        ...settings,
                                        oidc: { ...settings.oidc, allowedUsernames: e.target.value },
                                      });
                                      setValidated({ ...validated, oidc: false });
                                    }}
                                    placeholder="john_doe, jane_smith"
                                  />
                                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                    Enter usernames separated by commas
                                  </p>
                                </div>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Admin Role Mapping Section */}
                        <div className="border-t border-gray-200 dark:border-gray-700 pt-6 mt-6">
                          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
                            Admin Role Mapping
                          </h3>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                            Automatically grant admin permissions based on OIDC claims (e.g., group membership). The first user will always become admin.
                          </p>

                          <div className="space-y-4">
                            <div className="flex items-start gap-3">
                              <input
                                type="checkbox"
                                id="admin-claim-enabled"
                                checked={settings.oidc.adminClaimEnabled}
                                onChange={(e) => {
                                  setSettings({
                                    ...settings,
                                    oidc: { ...settings.oidc, adminClaimEnabled: e.target.checked },
                                  });
                                  setValidated({ ...validated, oidc: false });
                                }}
                                className="mt-1 h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                              />
                              <div className="flex-1">
                                <label
                                  htmlFor="admin-claim-enabled"
                                  className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer"
                                >
                                  Enable Admin Role Mapping
                                </label>
                                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                  Automatically grant admin role to users with specific OIDC claim values
                                </p>
                              </div>
                            </div>

                            {settings.oidc.adminClaimEnabled && (
                              <>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    Admin Claim Name
                                  </label>
                                  <Input
                                    type="text"
                                    value={settings.oidc.adminClaimName}
                                    onChange={(e) => {
                                      setSettings({
                                        ...settings,
                                        oidc: { ...settings.oidc, adminClaimName: e.target.value },
                                      });
                                      setValidated({ ...validated, oidc: false });
                                    }}
                                    placeholder="groups"
                                  />
                                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                    The OIDC claim field to check for admin role (usually "groups" or "roles")
                                  </p>
                                </div>

                                <div>
                                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    Admin Claim Value
                                  </label>
                                  <Input
                                    type="text"
                                    value={settings.oidc.adminClaimValue}
                                    onChange={(e) => {
                                      setSettings({
                                        ...settings,
                                        oidc: { ...settings.oidc, adminClaimValue: e.target.value },
                                      });
                                      setValidated({ ...validated, oidc: false });
                                    }}
                                    placeholder="readmeabook-admin"
                                  />
                                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                    Users with this value in their claim will be granted admin role
                                  </p>
                                </div>

                                <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4 border border-amber-200 dark:border-amber-800">
                                  <div className="flex gap-3">
                                    <svg
                                      className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5"
                                      fill="currentColor"
                                      viewBox="0 0 20 20"
                                    >
                                      <path
                                        fillRule="evenodd"
                                        d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                                        clipRule="evenodd"
                                      />
                                    </svg>
                                    <div>
                                      <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                                        Example Configuration
                                      </p>
                                      <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                                        In Authentik: Create a group called "readmeabook-admin", add users to it, and set "Admin Claim Value" to "readmeabook-admin"
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Registration Settings Section */}
                <div className="border-t border-gray-200 dark:border-gray-700 pt-8">
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                    Manual Registration
                  </h2>
                  <p className="text-gray-600 dark:text-gray-400 mb-6">
                    Configure manual user registration settings.
                  </p>

                  <div className="space-y-4">
                    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                      <div className="flex items-start gap-4">
                        <input
                          type="checkbox"
                          id="registration-enabled"
                          checked={settings.registration.enabled}
                          onChange={(e) => {
                            setSettings({
                              ...settings,
                              registration: { ...settings.registration, enabled: e.target.checked },
                            });
                            setValidated({ ...validated, registration: false });
                          }}
                          className="mt-1 h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <div className="flex-1">
                          <label
                            htmlFor="registration-enabled"
                            className="block text-sm font-medium text-gray-900 dark:text-gray-100 cursor-pointer"
                          >
                            Enable Manual Registration
                          </label>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                            Allow users to create accounts manually with username/password
                          </p>
                        </div>
                      </div>
                    </div>

                    {settings.registration.enabled && (
                      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                        <div className="flex items-start gap-4">
                          <input
                            type="checkbox"
                            id="require-approval"
                            checked={settings.registration.requireAdminApproval}
                            onChange={(e) => {
                              setSettings({
                                ...settings,
                                registration: { ...settings.registration, requireAdminApproval: e.target.checked },
                              });
                              setValidated({ ...validated, registration: false });
                            }}
                            className="mt-1 h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <div className="flex-1">
                            <label
                              htmlFor="require-approval"
                              className="block text-sm font-medium text-gray-900 dark:text-gray-100 cursor-pointer"
                            >
                              Require Admin Approval
                            </label>
                            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                              New users must be approved by an admin before they can log in
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Warning: No auth methods enabled AND no local users exist */}
                {settings.backendMode === 'audiobookshelf' && !settings.oidc.enabled && !settings.registration.enabled && !settings.hasLocalUsers && (
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                    <div className="flex gap-3">
                      <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <div>
                        <h3 className="text-sm font-semibold text-red-800 dark:text-red-200">
                          No Authentication Methods Available
                        </h3>
                        <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                          You must enable at least one authentication method (OIDC or Manual Registration) since no local users exist.
                          Saving with both disabled will lock you out of the system.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Info: Registration disabled but local users can still log in */}
                {settings.backendMode === 'audiobookshelf' && !settings.oidc.enabled && !settings.registration.enabled && settings.hasLocalUsers && (
                  <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                    <div className="flex gap-3">
                      <svg className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div>
                        <h3 className="text-sm font-semibold text-blue-800 dark:text-blue-200">
                          Manual Registration Disabled
                        </h3>
                        <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                          New user registration is disabled. Existing local users can still log in with their credentials.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Pending Users Section */}
                {settings.registration.enabled && settings.registration.requireAdminApproval && (
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-8">
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                      Pending User Approvals
                    </h2>
                    <p className="text-gray-600 dark:text-gray-400 mb-6">
                      Review and approve or reject user registration requests.
                    </p>

                    {loadingPendingUsers ? (
                      <div className="flex items-center gap-2 py-4">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                        <span className="text-sm text-gray-500">Loading pending users...</span>
                      </div>
                    ) : pendingUsers.length > 0 ? (
                      <div className="space-y-4">
                        {pendingUsers.map((user) => (
                          <div
                            key={user.id}
                            className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800"
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <h3 className="font-medium text-gray-900 dark:text-gray-100">
                                  {user.plexUsername}
                                </h3>
                                {user.plexEmail && (
                                  <p className="text-sm text-gray-600 dark:text-gray-400">
                                    {user.plexEmail}
                                  </p>
                                )}
                                <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                                  Registered: {new Date(user.createdAt).toLocaleDateString()}
                                </p>
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  onClick={() => approveUser(user.id, true)}
                                  variant="outline"
                                  className="border-green-300 text-green-600 hover:bg-green-50 dark:border-green-700 dark:text-green-400 dark:hover:bg-green-900/20"
                                >
                                  Approve
                                </Button>
                                <Button
                                  onClick={() => approveUser(user.id, false)}
                                  variant="outline"
                                  className="border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
                                >
                                  Reject
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
                        <p className="text-gray-500 dark:text-gray-400">
                          No pending user approvals
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

          </div>

          {/* Footer - Hide for BookDate and E-book tabs (they have their own save buttons) */}
          {activeTab !== 'bookdate' && activeTab !== 'ebook' && (
            <div className="bg-gray-50 dark:bg-gray-900 px-8 py-4 border-t border-gray-200 dark:border-gray-700">
              <div className="flex justify-end gap-4">
                <Button variant="outline" onClick={() => window.location.reload()}>
                  Cancel
                </Button>
                <Button
                  onClick={saveSettings}
                  loading={saving}
                  disabled={(() => {
                    // For Library tab: check validation based on backend mode
                    if (activeTab === 'library' && settings) {
                      if (settings.backendMode === 'plex') {
                        return !validated.plex;
                      } else {
                        return !validated.audiobookshelf;
                      }
                    }
                    // For Auth tab: disable if no auth methods are enabled AND no local users exist in Audiobookshelf mode
                    if (activeTab === 'auth' && settings) {
                      if (settings.backendMode === 'audiobookshelf') {
                        // Allow disabling both if local users exist (they can still log in)
                        // Prevent disabling both if no local users exist (would lock out system)
                        return !settings.oidc.enabled && !settings.registration.enabled && !settings.hasLocalUsers;
                      }
                      return false;
                    }
                    // For Prowlarr tab: allow save if validated OR if URL/API key unchanged
                    if (activeTab === 'prowlarr' && originalSettings && settings) {
                      const connectionUnchanged =
                        settings.prowlarr.url === originalSettings.prowlarr.url &&
                        settings.prowlarr.apiKey === originalSettings.prowlarr.apiKey;
                      return !validated.prowlarr && !connectionUnchanged;
                    }
                    // For other tabs: require validation
                    if (activeTab === 'download') return !validated.download;
                    if (activeTab === 'paths') return !validated.paths;

                    // Default: allow save
                    return false;
                  })()}
                >
                  Save Changes
                </Button>
              </div>
              {(() => {
                // For Library tab: check based on backend mode
                if (activeTab === 'library' && settings) {
                  if (settings.backendMode === 'plex' && !validated.plex) {
                    return (
                      <p className="text-sm text-amber-600 dark:text-amber-400 mt-2 text-right">
                        Please test your connection before saving
                      </p>
                    );
                  }
                  if (settings.backendMode === 'audiobookshelf' && !validated.audiobookshelf) {
                    return (
                      <p className="text-sm text-amber-600 dark:text-amber-400 mt-2 text-right">
                        Please test your connection before saving
                      </p>
                    );
                  }
                }
                // For Auth tab: no validation message (toggles don't need testing)
                if (activeTab === 'auth') {
                  return null;
                }
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
                if (activeTab === 'download' && !validated.download) {
                  return (
                    <p className="text-sm text-amber-600 dark:text-amber-400 mt-2 text-right">
                      Please test your connection before saving
                    </p>
                  );
                }
                if (activeTab === 'paths' && !validated.paths) {
                  return (
                    <p className="text-sm text-amber-600 dark:text-amber-400 mt-2 text-right">
                      Please test paths before saving
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
