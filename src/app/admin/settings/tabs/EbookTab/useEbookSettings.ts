/**
 * Component: E-book Settings Tab - Custom Hook
 * Documentation: documentation/settings-pages.md
 */

'use client';

import { useState } from 'react';
import { fetchWithAuth } from '@/lib/utils/api';
import type { EbookSettings, TestResult } from '../../lib/types';

interface UseEbookSettingsProps {
  ebook: EbookSettings;
  onChange: (ebook: EbookSettings) => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  markAsSaved: () => void;
}

interface PathCheckResult {
  reachable: boolean;
  message: string;
}

export function useEbookSettings({ ebook, onChange, onSuccess, onError, markAsSaved }: UseEbookSettingsProps) {
  const [saving, setSaving] = useState(false);
  const [testingFlaresolverr, setTestingFlaresolverr] = useState(false);
  const [flaresolverrTestResult, setFlaresolverrTestResult] = useState<TestResult | null>(null);
  const [checkingPath, setCheckingPath] = useState(false);
  const [pathCheckResult, setPathCheckResult] = useState<PathCheckResult | null>(null);

  /**
   * Update a single ebook field
   */
  const updateEbook = (field: keyof EbookSettings, value: string | boolean) => {
    onChange({ ...ebook, [field]: value });
    if (field === 'flaresolverrUrl') {
      setFlaresolverrTestResult(null);
    }
    // Reset the destination path check whenever the path or mode changes
    if (field === 'ebookDestinationPath' || field === 'ebookDestinationMode') {
      setPathCheckResult(null);
    }
  };

  /**
   * Check whether the custom ebook destination path is reachable + writable by
   * the container. Returns the result (also stored in state) or null if skipped.
   */
  const checkDestinationPath = async (): Promise<PathCheckResult | null> => {
    const path = (ebook.ebookDestinationPath || '').trim();
    if (ebook.ebookDestinationMode !== 'custom' || !path) {
      setPathCheckResult(null);
      return null;
    }

    setCheckingPath(true);
    try {
      const response = await fetchWithAuth('/api/admin/settings/ebook/check-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      const result: PathCheckResult = await response.json();
      setPathCheckResult(result);
      return result;
    } catch (error) {
      const result: PathCheckResult = {
        reachable: false,
        message: error instanceof Error ? error.message : 'Path check failed',
      };
      setPathCheckResult(result);
      return result;
    } finally {
      setCheckingPath(false);
    }
  };

  /**
   * Test FlareSolverr connection
   */
  const testFlaresolverrConnection = async () => {
    if (!ebook.flaresolverrUrl) {
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
        body: JSON.stringify({
          url: ebook.flaresolverrUrl,
          baseUrl: ebook.baseUrl || 'https://annas-archive.gl',
        }),
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

  /**
   * Save e-book settings to API
   */
  const saveSettings = async () => {
    setSaving(true);

    // Non-blocking reachability check for a custom destination path. Saving still
    // proceeds (the organizer falls back to the default media dir safely), but the
    // warning surfaces under the path field so misconfigurations don't stay silent.
    await checkDestinationPath();

    try {
      const response = await fetchWithAuth('/api/admin/settings/ebook', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          annasArchiveEnabled: ebook.annasArchiveEnabled || false,
          indexerSearchEnabled: ebook.indexerSearchEnabled || false,
          format: ebook.preferredFormat || 'epub',
          baseUrl: ebook.baseUrl || 'https://annas-archive.gl',
          flaresolverrUrl: ebook.flaresolverrUrl || '',
          autoGrabEnabled: ebook.autoGrabEnabled ?? true,
          kindleFixEnabled: ebook.kindleFixEnabled ?? false,
          ereaderAutoSendEnabled: ebook.ereaderAutoSendEnabled ?? false,
          ebookDestinationMode: ebook.ebookDestinationMode || 'same',
          ebookDestinationLibraryId: ebook.ebookDestinationLibraryId || '',
          ebookDestinationPath: ebook.ebookDestinationPath || '',
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save e-book settings');
      }

      onSuccess('E-book sidecar settings saved successfully!');
      markAsSaved();
      setTimeout(() => onSuccess(''), 3000);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to save e-book settings');
    } finally {
      setSaving(false);
    }
  };

  /**
   * Helper to check if any ebook source is enabled
   */
  const isAnySourceEnabled = ebook.annasArchiveEnabled || ebook.indexerSearchEnabled;

  return {
    saving,
    testingFlaresolverr,
    flaresolverrTestResult,
    checkingPath,
    pathCheckResult,
    checkDestinationPath,
    updateEbook,
    testFlaresolverrConnection,
    saveSettings,
    isAnySourceEnabled,
  };
}
