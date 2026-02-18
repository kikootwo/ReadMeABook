/**
 * Component: Download Client Configuration Modal
 * Documentation: documentation/phase3/download-clients.md
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { fetchWithAuth } from '@/lib/utils/api';
import { DownloadClientType, getClientDisplayName, CLIENT_PROTOCOL_MAP } from '@/lib/interfaces/download-client.interface';

interface DownloadClientModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'add' | 'edit';
  clientType?: DownloadClientType;
  initialClient?: {
    id: string;
    type: DownloadClientType;
    name: string;
    url: string;
    username?: string;
    password: string;
    enabled: boolean;
    disableSSLVerify: boolean;
    remotePathMappingEnabled: boolean;
    remotePath?: string;
    localPath?: string;
    category?: string;
    customPath?: string;
    postImportCategory?: string;
  };
  onSave: (client: any) => Promise<void>;
  apiMode: 'wizard' | 'settings';
  downloadDir?: string;
}

export function DownloadClientModal({
  isOpen,
  onClose,
  mode,
  clientType,
  initialClient,
  onSave,
  apiMode,
  downloadDir = '/downloads',
}: DownloadClientModalProps) {
  const type = mode === 'edit' ? initialClient?.type : clientType;
  const typeName = type ? getClientDisplayName(type) : '';

  // Form state
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [disableSSLVerify, setDisableSSLVerify] = useState(false);
  const [remotePathMappingEnabled, setRemotePathMappingEnabled] = useState(false);
  const [remotePath, setRemotePath] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [category, setCategory] = useState('readmeabook');
  const [customPath, setCustomPath] = useState('');
  const [postImportCategory, setPostImportCategory] = useState('');
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [fetchingCategories, setFetchingCategories] = useState(false);

  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      if (mode === 'edit' && initialClient) {
        setName(initialClient.name);
        setUrl(initialClient.url);
        setUsername(initialClient.username || '');
        // In wizard mode, use actual password from local state
        // In settings mode, mask password (server doesn't send real passwords)
        setPassword(apiMode === 'wizard' ? initialClient.password : '********');
        setEnabled(initialClient.enabled);
        setDisableSSLVerify(initialClient.disableSSLVerify);
        setRemotePathMappingEnabled(initialClient.remotePathMappingEnabled);
        setRemotePath(initialClient.remotePath || '');
        setLocalPath(initialClient.localPath || '');
        setCategory(initialClient.category || 'readmeabook');
        setCustomPath(initialClient.customPath || '');
        setPostImportCategory(initialClient.postImportCategory || '');
      } else {
        // Add mode defaults
        setName(typeName);
        setUrl('');
        setUsername('');
        setPassword('');
        setEnabled(true);
        setDisableSSLVerify(false);
        setRemotePathMappingEnabled(false);
        setRemotePath('');
        setLocalPath('');
        setCategory('readmeabook');
        setCustomPath('');
        setPostImportCategory('');
      }
      setTestResult(null);
      setErrors({});
      setAvailableCategories([]);
      setFetchingCategories(false);
    }
  }, [isOpen, mode, initialClient, type]);

  const validate = () => {
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
      newErrors.name = 'Name is required';
    }

    if (!url.trim()) {
      newErrors.url = 'URL is required';
    }

    // SABnzbd always requires API key; qBittorrent credentials are optional (supports IP whitelist auth)
    if (type === 'sabnzbd' && (!password.trim() || (mode === 'add' && password === '********'))) {
      newErrors.password = 'API key is required';
    }

    if (customPath.includes('..')) {
      newErrors.customPath = 'Path cannot contain ".."';
    }

    if (remotePathMappingEnabled) {
      if (!remotePath.trim()) {
        newErrors.remotePath = 'Remote path is required when path mapping is enabled';
      }
      if (!localPath.trim()) {
        newErrors.localPath = 'Local path is required when path mapping is enabled';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const fetchCategories = async () => {
    setFetchingCategories(true);
    try {
      const isPasswordMasked = password === '********';
      const categoryData = {
        type,
        name,
        url,
        username: username || undefined,
        password: isPasswordMasked ? undefined : password,
        ...(mode === 'edit' && initialClient && isPasswordMasked ? { clientId: initialClient.id } : {}),
        disableSSLVerify,
        remotePathMappingEnabled,
        remotePath: remotePathMappingEnabled ? remotePath : undefined,
        localPath: remotePathMappingEnabled ? localPath : undefined,
      };

      const endpoint = apiMode === 'wizard'
        ? '/api/setup/download-client-categories'
        : '/api/admin/settings/download-clients/categories';

      const response = apiMode === 'wizard'
        ? await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(categoryData),
          })
        : await fetchWithAuth(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(categoryData),
          });

      const data = await response.json();
      if (response.ok && data.success) {
        setAvailableCategories(data.categories || []);
      }
    } catch {
      // Non-critical — categories are optional
    } finally {
      setFetchingCategories(false);
    }
  };

  const handleTestConnection = async () => {
    if (!validate()) {
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      // If editing and password is masked, send clientId so server uses stored password
      const isPasswordMasked = password === '********';

      const testData = {
        type,
        name,
        url,
        username: username || undefined,
        password: isPasswordMasked ? undefined : password,
        // Include clientId when editing so server can use stored password
        ...(mode === 'edit' && initialClient && isPasswordMasked ? { clientId: initialClient.id } : {}),
        disableSSLVerify,
        remotePathMappingEnabled,
        remotePath: remotePathMappingEnabled ? remotePath : undefined,
        localPath: remotePathMappingEnabled ? localPath : undefined,
      };

      const endpoint = apiMode === 'wizard'
        ? '/api/setup/test-download-client'
        : '/api/admin/settings/download-clients/test';

      // Wizard mode: no auth required (public endpoint during setup)
      // Settings mode: use fetchWithAuth to include JWT token
      const response = apiMode === 'wizard'
        ? await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testData),
          })
        : await fetchWithAuth(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testData),
          });

      const data = await response.json();

      if (response.ok && data.success) {
        // Handle both endpoint response formats (settings returns message, wizard returns version)
        const message = data.message || (data.version ? `Connected successfully (v${data.version})` : 'Connection successful');
        setTestResult({ success: true, message });

        // Fetch categories for torrent clients after successful connection
        if (type && CLIENT_PROTOCOL_MAP[type] === 'torrent') {
          fetchCategories();
        }
      } else {
        setTestResult({ success: false, message: data.error || 'Connection test failed' });
      }
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : 'Connection test failed',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!validate()) {
      return;
    }

    // Skip connection test requirement when disabling the client
    if (!testResult?.success && enabled) {
      setErrors({ ...errors, test: 'Please test the connection before saving' });
      return;
    }

    setSaving(true);

    try {
      // Strip leading/trailing slashes from customPath
      const sanitizedCustomPath = customPath.replace(/^\/+|\/+$/g, '').trim();

      const clientData: any = {
        type,
        name,
        url,
        username: type !== 'sabnzbd' ? username : undefined,
        password: password === '********' ? undefined : password, // Don't send masked password on edit
        enabled,
        disableSSLVerify,
        remotePathMappingEnabled,
        remotePath: remotePathMappingEnabled ? remotePath : undefined,
        localPath: remotePathMappingEnabled ? localPath : undefined,
        category,
        customPath: sanitizedCustomPath,
        postImportCategory,
      };

      if (mode === 'edit' && initialClient) {
        clientData.id = initialClient.id;
      }

      await onSave(clientData);
      onClose();
    } catch (error) {
      setErrors({
        ...errors,
        save: error instanceof Error ? error.message : 'Failed to save client',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${mode === 'add' ? 'Add' : 'Edit'} ${typeName}`}
      size="lg"
    >
      <div className="space-y-4">
        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Name
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`My ${typeName}`}
            error={errors.name}
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Friendly name to identify this client
          </p>
        </div>

        {/* URL */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            URL
          </label>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={type === 'rdtclient' ? 'http://localhost:6500' : type === 'transmission' ? 'http://localhost:9091' : type === 'qbittorrent' ? 'http://localhost:8080' : type === 'nzbget' ? 'http://localhost:6789' : 'http://localhost:8081'}
            error={errors.url}
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Web UI URL (e.g., http://localhost:8080)
          </p>
        </div>

        {/* Username (qBittorrent and Transmission) */}
        {type !== 'sabnzbd' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Username
            </label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              error={errors.username}
            />
          </div>
        )}

        {/* Password / API Key */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {type === 'sabnzbd' ? 'API Key' : 'Password'}
          </label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={type === 'sabnzbd' ? 'API Key from SABnzbd Config > General' : 'Password'}
            error={errors.password}
          />
          {type === 'sabnzbd' && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Found in SABnzbd under Config → General → API Key
            </p>
          )}
          {type === 'nzbget' && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Configured in NZBGet under Settings → Security → ControlPassword
            </p>
          )}
        </div>

        {/* SSL Verification */}
        {url.startsWith('https://') && (
          <div className="flex items-start">
            <input
              type="checkbox"
              id="disableSSLVerify"
              checked={disableSSLVerify}
              onChange={(e) => setDisableSSLVerify(e.target.checked)}
              className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="disableSSLVerify" className="ml-2 block text-sm text-gray-700 dark:text-gray-300">
              Disable SSL certificate verification
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Use for self-signed certificates (not recommended for production)
              </p>
            </label>
          </div>
        )}

        {/* Enabled Toggle */}
        <div className="flex items-start">
          <input
            type="checkbox"
            id="enabled"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
          />
          <label htmlFor="enabled" className="ml-2 block text-sm text-gray-700 dark:text-gray-300">
            Enabled
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Use this client for downloads
            </p>
          </label>
        </div>

        {/* Custom Download Path */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Custom Download Path
          </label>
          <Input
            value={customPath}
            onChange={(e) => setCustomPath(e.target.value)}
            placeholder="e.g. torrents or usenet/books"
            error={errors.customPath}
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Optional relative sub-path appended to the base download directory
          </p>
          <p className="mt-1 text-xs font-medium text-blue-600 dark:text-blue-400">
            Downloads to: {customPath.replace(/^\/+|\/+$/g, '').trim()
              ? `${downloadDir}/${customPath.replace(/^\/+|\/+$/g, '').trim()}`
              : downloadDir}
          </p>
        </div>

        {/* Post-Import Category (torrent clients only) */}
        {type && CLIENT_PROTOCOL_MAP[type] === 'torrent' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Post-Import Category
            </label>
            {type === 'qbittorrent' && availableCategories.length > 0 ? (
              <select
                value={postImportCategory}
                onChange={(e) => setPostImportCategory(e.target.value)}
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">None (keep original)</option>
                {availableCategories.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            ) : (
              <Input
                value={postImportCategory}
                onChange={(e) => setPostImportCategory(e.target.value)}
                placeholder="e.g. completed"
                disabled={fetchingCategories}
              />
            )}
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              After import, change the download&apos;s category/label in the client. Leave empty to skip.
            </p>
          </div>
        )}

        {/* Remote Path Mapping */}
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
          <div className="flex items-start mb-3">
            <input
              type="checkbox"
              id="remotePathMapping"
              checked={remotePathMappingEnabled}
              onChange={(e) => setRemotePathMappingEnabled(e.target.checked)}
              className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="remotePathMapping" className="ml-2 block text-sm text-gray-700 dark:text-gray-300">
              Enable Remote Path Mapping
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Use when download client sees a different filesystem than ReadMeABook
              </p>
            </label>
          </div>

          {remotePathMappingEnabled && (
            <div className="space-y-3 ml-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Remote Path ({typeName})
                </label>
                <Input
                  value={remotePath}
                  onChange={(e) => setRemotePath(e.target.value)}
                  placeholder="F:\Docker\downloads\completed\books"
                  error={errors.remotePath}
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Path as seen by {typeName}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Local Path (ReadMeABook)
                </label>
                <Input
                  value={localPath}
                  onChange={(e) => setLocalPath(e.target.value)}
                  placeholder="/downloads"
                  error={errors.localPath}
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Path as seen by ReadMeABook
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Test Result */}
        {testResult && (
          <div
            className={`p-3 rounded-md ${
              testResult.success
                ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300'
            }`}
          >
            <p className="text-sm">{testResult.message}</p>
          </div>
        )}

        {/* Errors */}
        {errors.test && (
          <div className="p-3 rounded-md bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-300">
            <p className="text-sm">{errors.test}</p>
          </div>
        )}

        {errors.save && (
          <div className="p-3 rounded-md bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300">
            <p className="text-sm">{errors.save}</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
          <Button
            onClick={handleTestConnection}
            disabled={testing}
            variant="secondary"
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </Button>

          <div className="flex gap-2">
            <Button onClick={onClose} variant="secondary" disabled={saving}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || (!testResult?.success && enabled)}
            >
              {saving ? 'Saving...' : mode === 'add' ? 'Add Client' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
