/**
 * Component: BookDate Settings Tab - Custom Hook
 * Documentation: documentation/settings-pages.md
 */

'use client';

import { useState, useEffect } from 'react';
import { fetchWithAuth } from '@/lib/utils/api';
import type { BookDateModel } from '../../lib/types';

export function useBookDateSettings() {
  const [provider, setProvider] = useState<string>('openai');
  const [apiKey, setApiKey] = useState<string>('');
  // Custom provider only: save with no API key, clearing any saved one
  const [clearApiKey, setClearApiKey] = useState<boolean>(false);
  const [model, setModel] = useState<string>('');
  const [baseUrl, setBaseUrl] = useState<string>('');
  const [enabled, setEnabled] = useState<boolean>(true);
  const [configured, setConfigured] = useState<boolean>(false);
  const [models, setModels] = useState<BookDateModel[]>([]);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearingSwipes, setClearingSwipes] = useState(false);

  /**
   * Fetch BookDate configuration
   */
  const fetchConfig = async () => {
    try {
      const response = await fetchWithAuth('/api/bookdate/config');
      const data = await response.json();

      if (data.config) {
        setProvider(data.config.provider || 'openai');
        setModel(data.config.model || '');
        setBaseUrl(data.config.baseUrl || '');
        setEnabled(data.config.isEnabled !== false);
        setConfigured(data.config.isVerified || false);
      }
    } catch (error) {
      console.error('Failed to load BookDate config:', error);
    }
  };

  /**
   * Test connection and fetch available models
   */
  const testConnection = async (onSuccess: (msg: string) => void, onError: (msg: string) => void) => {
    const hasApiKey = apiKey.trim().length > 0;

    // Validation
    if (provider === 'custom') {
      if (!baseUrl.trim()) {
        onError('Please enter a base URL for custom provider');
        return;
      }
    } else {
      if (!hasApiKey && !configured) {
        onError('Please enter an API key');
        return;
      }
    }

    setTesting(true);

    try {
      const payload: any = {
        provider,
      };

      if (hasApiKey) {
        payload.apiKey = apiKey;
      } else if (provider !== 'custom') {
        payload.useSavedKey = true;
      }

      if (provider === 'custom') {
        payload.baseUrl = baseUrl;
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

      setModels(data.models || []);
      onSuccess('Connection successful! Please select a model.');

      // Auto-select first model if none selected
      if (!model && data.models?.length > 0) {
        setModel(data.models[0].id);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Connection test failed');
    } finally {
      setTesting(false);
    }
  };

  /**
   * Save BookDate configuration
   */
  const saveConfig = async (onSuccess: (msg: string) => void, onError: (msg: string) => void) => {
    // Validate: model is required
    if (!model) {
      onError('Please select a model');
      return;
    }

    // Validate: baseUrl required for custom provider
    if (provider === 'custom') {
      if (!baseUrl.trim()) {
        onError('Please enter a base URL for custom provider');
        return;
      }
    } else {
      const hasApiKey = apiKey.trim().length > 0;
      if (!configured && !hasApiKey) {
        onError('Please enter an API key for initial setup');
        return;
      }
    }

    setSaving(true);

    try {
      const hasApiKey = apiKey.trim().length > 0;
      const payload: any = {
        provider,
        model,
        isEnabled: enabled,
      };

      if (hasApiKey) {
        payload.apiKey = apiKey;
      }

      if (provider === 'custom') {
        payload.baseUrl = baseUrl;
        if (clearApiKey && !hasApiKey) payload.clearApiKey = true;
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

      onSuccess('BookDate configuration saved successfully!');
      setConfigured(true);
      setApiKey(''); // Clear API key from UI after save
      setClearApiKey(false);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  /**
   * Clear all swipe history
   */
  const clearSwipes = async (onSuccess: (msg: string) => void, onError: (msg: string) => void) => {
    if (!confirm('This will clear all swipe history. Continue?')) {
      return;
    }

    setClearingSwipes(true);

    try {
      const response = await fetchWithAuth('/api/bookdate/swipes', {
        method: 'DELETE',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to clear swipe history');
      }

      onSuccess('Swipe history cleared successfully!');
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to clear swipe history');
    } finally {
      setClearingSwipes(false);
    }
  };

  /**
   * Handle provider change
   */
  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider);
    setModels([]);
    setBaseUrl('');
    setClearApiKey(false);
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  return {
    provider,
    apiKey,
    clearApiKey,
    model,
    baseUrl,
    enabled,
    configured,
    models,
    testing,
    saving,
    clearingSwipes,
    setProvider: handleProviderChange,
    setApiKey,
    setClearApiKey,
    setModel,
    setBaseUrl,
    setEnabled,
    setModels,
    testConnection,
    saveConfig,
    clearSwipes,
  };
}
