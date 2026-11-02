/**
 * Component: Indexers Settings Tab - Custom Hook
 * Documentation: documentation/settings-pages.md
 */

'use client';

import { useState, useCallback } from 'react';
import { fetchWithAuth } from '@/lib/utils/api';
import type { TestResult } from '../../lib/types';

interface UseIndexersSettingsProps {
  prowlarrUrl: string;
  prowlarrApiKey: string;
  originalProwlarrUrl: string;
  originalProwlarrApiKey: string;
  configuredIndexersCount: number;
  /** False when the saved list could not be loaded: its size is unknown, so assume it has entries. */
  indexersLoaded?: boolean;
  onValidationChange: (isValid: boolean) => void;
  onRefreshIndexers?: () => Promise<void>;
  onClearIndexers: () => void;
}

export function useIndexersSettings({
  prowlarrUrl,
  prowlarrApiKey,
  originalProwlarrUrl,
  originalProwlarrApiKey,
  configuredIndexersCount,
  indexersLoaded = true,
  onValidationChange,
  onRefreshIndexers,
  onClearIndexers,
}: UseIndexersSettingsProps) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [showConnectionChangeConfirm, setShowConnectionChangeConfirm] = useState(false);

  /**
   * Detect if the Prowlarr URL or API key has changed from the saved values.
   * A masked API key (starting with dots) means the user hasn't touched it.
   */
  const hasConnectionChanged = useCallback((): boolean => {
    const urlChanged = prowlarrUrl.trim() !== originalProwlarrUrl.trim();
    const apiKeyChanged = !prowlarrApiKey.startsWith('••••') &&
      prowlarrApiKey !== originalProwlarrApiKey;
    return urlChanged || apiKeyChanged;
  }, [prowlarrUrl, prowlarrApiKey, originalProwlarrUrl, originalProwlarrApiKey]);

  /**
   * Execute the actual Prowlarr connection test
   */
  const executeTest = async (shouldClearIndexers: boolean) => {
    setTesting(true);
    setTestResult(null);

    try {
      const response = await fetchWithAuth('/api/admin/settings/test-prowlarr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: prowlarrUrl,
          apiKey: prowlarrApiKey,
        }),
      });

      const data = await response.json();

      if (data.success) {
        onValidationChange(true);

        if (shouldClearIndexers) {
          onClearIndexers();
          setTestResult({
            success: true,
            message: `Connected to Prowlarr. Found ${data.indexers?.length || 0} indexers. Previous indexer configurations have been removed — please re-add indexers from the new instance.`,
          });
        } else {
          // The saved list is read through the SAVED connection: with an unsaved new URL or key,
          // reloading would only hit the old address (and report a load failure)
          const connectionUnsaved = hasConnectionChanged();
          setTestResult({
            success: true,
            message: `Connected to Prowlarr. Found ${data.indexers?.length || 0} indexers`
              + (connectionUnsaved && !indexersLoaded ? '. Save to load your saved indexers from the new address.' : ''),
          });

          if (onRefreshIndexers && !connectionUnsaved) {
            await onRefreshIndexers();
          }
        }
      } else {
        onValidationChange(false);
        setTestResult({
          success: false,
          message: data.error || 'Connection failed',
        });
      }
    } catch (error) {
      onValidationChange(false);
      const errorMsg = error instanceof Error ? error.message : 'Failed to test connection';
      setTestResult({
        success: false,
        message: errorMsg,
      });
    } finally {
      setTesting(false);
    }
  };

  /**
   * Handle test connection click — shows confirmation if credentials changed
   * and there are (or may be: the list failed to load) configured indexers.
   */
  const testConnection = async () => {
    if (hasConnectionChanged() && (configuredIndexersCount > 0 || !indexersLoaded)) {
      setShowConnectionChangeConfirm(true);
      return;
    }

    await executeTest(false);
  };

  /**
   * User confirmed the credential change — proceed with test and clear indexers on success
   */
  const confirmConnectionChange = async () => {
    setShowConnectionChangeConfirm(false);
    await executeTest(true);
  };

  /**
   * Same Prowlarr at a new address: test it without clearing the saved indexers.
   * After saving, the page loads the list from the new address.
   */
  const keepIndexersOnConnectionChange = async () => {
    setShowConnectionChangeConfirm(false);
    await executeTest(false);
  };

  /**
   * User cancelled the credential change confirmation
   */
  const cancelConnectionChange = () => {
    setShowConnectionChangeConfirm(false);
  };

  return {
    testing,
    testResult,
    testConnection,
    showConnectionChangeConfirm,
    confirmConnectionChange,
    keepIndexersOnConnectionChange,
    cancelConnectionChange,
    configuredIndexersCount,
  };
}
