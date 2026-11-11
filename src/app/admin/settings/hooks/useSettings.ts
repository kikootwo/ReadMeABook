/**
 * Component: Admin Settings - Global Settings Hook
 * Documentation: documentation/settings-pages.md
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { fetchWithAuth } from '@/lib/utils/api';
import type { Settings, Message, ValidationState, TestResult } from '../lib/types';

/**
 * Global settings hook for managing settings state across all tabs
 * Provides centralized settings fetch/update logic
 */
export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [originalSettings, setOriginalSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [validated, setValidated] = useState<ValidationState>({
    plex: false,
    audiobookshelf: false,
    audiosilo: false,
    oidc: false,
    registration: false,
    prowlarr: false,
    download: false,
    paths: false,
  });
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});

  /**
   * Fetch settings from API
   */
  const fetchSettings = useCallback(async () => {
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
  }, []);

  /**
   * Update settings (local state only, call saveSettings to persist)
   */
  const updateSettings = useCallback((updates: Partial<Settings> | ((prev: Settings) => Settings)) => {
    setSettings((prev) => {
      if (!prev) return prev;
      if (typeof updates === 'function') {
        return updates(prev);
      }
      return { ...prev, ...updates };
    });
  }, []);

  /**
   * Reset settings to original values
   */
  const resetSettings = useCallback(() => {
    if (originalSettings) {
      setSettings(JSON.parse(JSON.stringify(originalSettings)));
    }
  }, [originalSettings]);

  /**
   * Check if settings have been modified
   */
  const hasUnsavedChanges = useCallback(() => {
    if (!settings || !originalSettings) return false;
    return JSON.stringify(settings) !== JSON.stringify(originalSettings);
  }, [settings, originalSettings]);

  /**
   * Update validation state for a specific section
   */
  const updateValidation = useCallback((section: keyof ValidationState, isValid: boolean) => {
    setValidated((prev) => ({ ...prev, [section]: isValid }));
  }, []);

  /**
   * Update test results for a specific section
   */
  const updateTestResults = useCallback((section: string, result: TestResult) => {
    setTestResults((prev) => ({ ...prev, [section]: result }));
  }, []);

  /**
   * Show a message banner
   */
  const showMessage = useCallback((msg: Message) => {
    setMessage(msg);
  }, []);

  /**
   * Clear message banner
   */
  const clearMessage = useCallback(() => {
    setMessage(null);
  }, []);

  /**
   * Mark settings as saved (update original settings)
   */
  const markAsSaved = useCallback(() => {
    if (settings) {
      setOriginalSettings(JSON.parse(JSON.stringify(settings)));
    }
  }, [settings]);

  // Fetch settings on mount
  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  return {
    // State
    settings,
    originalSettings,
    loading,
    saving,
    testing,
    message,
    validated,
    testResults,

    // Setters
    setSettings,
    setSaving,
    setTesting,

    // Methods
    fetchSettings,
    updateSettings,
    resetSettings,
    hasUnsavedChanges,
    updateValidation,
    updateTestResults,
    showMessage,
    clearMessage,
    markAsSaved,
  };
}
