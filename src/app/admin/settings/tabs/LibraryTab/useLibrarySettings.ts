/**
 * Component: Library Settings Hook
 * Documentation: documentation/settings-pages.md
 */

import { useState, useCallback } from 'react';
import { fetchWithAuth } from '@/lib/utils/api';
import { PlexLibrary, ABSLibrary } from '../../lib/types';

interface UseLibrarySettingsReturn {
  // Plex state
  plexLibraries: PlexLibrary[];
  setPlexLibraries: (libraries: PlexLibrary[]) => void;
  testingPlex: boolean;
  plexTestResult: { success: boolean; message: string } | null;
  testPlexConnection: (url: string, token: string) => Promise<boolean>;

  // ABS state
  absLibraries: ABSLibrary[];
  setAbsLibraries: (libraries: ABSLibrary[]) => void;
  testingAbs: boolean;
  absTestResult: { success: boolean; message: string } | null;
  testABSConnection: (serverUrl: string, apiToken: string) => Promise<boolean>;

  // AudioSilo state
  siloLibraries: ABSLibrary[];
  setSiloLibraries: (libraries: ABSLibrary[]) => void;
  testingSilo: boolean;
  siloTestResult: { success: boolean; message: string } | null;
  testAudioSiloConnection: (serverUrl: string, apiToken: string) => Promise<boolean>;

  // Shared state
  loadingLibraries: boolean;
}

export function useLibrarySettings(
  onSuccess: (message: string) => void,
  onError: (message: string) => void,
  onValidationChange: (section: string, isValid: boolean) => void
): UseLibrarySettingsReturn {
  // Plex state
  const [plexLibraries, setPlexLibraries] = useState<PlexLibrary[]>([]);
  const [testingPlex, setTestingPlex] = useState(false);
  const [plexTestResult, setPlexTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // ABS state
  const [absLibraries, setAbsLibraries] = useState<ABSLibrary[]>([]);
  const [testingAbs, setTestingAbs] = useState(false);
  const [absTestResult, setAbsTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // AudioSilo state
  const [siloLibraries, setSiloLibraries] = useState<ABSLibrary[]>([]);
  const [testingSilo, setTestingSilo] = useState(false);
  const [siloTestResult, setSiloTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Shared state
  const [loadingLibraries, setLoadingLibraries] = useState(false);

  const testPlexConnection = useCallback(async (url: string, token: string): Promise<boolean> => {
    setTestingPlex(true);
    setPlexTestResult(null);

    try {
      const response = await fetchWithAuth('/api/admin/settings/test-plex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, token }),
      });

      const data = await response.json();

      if (data.success) {
        setPlexTestResult({ success: true, message: `Connected to ${data.serverName}` });
        onSuccess(`Connected to ${data.serverName}. You can now save.`);
        onValidationChange('plex', true);

        // Update libraries
        if (data.libraries) {
          setPlexLibraries(data.libraries);
        }

        return true;
      } else {
        const errorMsg = data.error || 'Connection failed';
        setPlexTestResult({ success: false, message: errorMsg });
        onError(errorMsg);
        onValidationChange('plex', false);
        return false;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to test connection';
      setPlexTestResult({ success: false, message: errorMsg });
      onError(errorMsg);
      onValidationChange('plex', false);
      return false;
    } finally {
      setTestingPlex(false);
    }
  }, [onSuccess, onError, onValidationChange]);

  const testABSConnection = useCallback(async (serverUrl: string, apiToken: string): Promise<boolean> => {
    setTestingAbs(true);
    setAbsTestResult(null);

    try {
      const response = await fetchWithAuth('/api/setup/test-abs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverUrl, apiToken }),
      });

      const data = await response.json();

      if (data.success) {
        setAbsTestResult({ success: true, message: 'Connected to Audiobookshelf' });
        onSuccess('Connected to Audiobookshelf. You can now save.');
        onValidationChange('audiobookshelf', true);

        // Update libraries
        if (data.libraries) {
          setAbsLibraries(data.libraries);
        }

        return true;
      } else {
        const errorMsg = data.error || 'Connection failed';
        setAbsTestResult({ success: false, message: errorMsg });
        onError(errorMsg);
        onValidationChange('audiobookshelf', false);
        return false;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to test connection';
      setAbsTestResult({ success: false, message: errorMsg });
      onError(errorMsg);
      onValidationChange('audiobookshelf', false);
      return false;
    } finally {
      setTestingAbs(false);
    }
  }, [onSuccess, onError, onValidationChange]);

  const testAudioSiloConnection = useCallback(async (serverUrl: string, apiToken: string): Promise<boolean> => {
    setTestingSilo(true);
    setSiloTestResult(null);

    try {
      const response = await fetchWithAuth('/api/setup/test-audiosilo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverUrl, apiToken }),
      });

      const data = await response.json();

      if (data.success) {
        setSiloTestResult({ success: true, message: 'Connected to AudioSilo' });
        onSuccess('Connected to AudioSilo. You can now save.');
        onValidationChange('audiosilo', true);

        if (data.libraries) {
          setSiloLibraries(data.libraries);
        }

        return true;
      } else {
        const errorMsg = data.error || 'Connection failed';
        setSiloTestResult({ success: false, message: errorMsg });
        onError(errorMsg);
        onValidationChange('audiosilo', false);
        return false;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to test connection';
      setSiloTestResult({ success: false, message: errorMsg });
      onError(errorMsg);
      onValidationChange('audiosilo', false);
      return false;
    } finally {
      setTestingSilo(false);
    }
  }, [onSuccess, onError, onValidationChange]);

  return {
    plexLibraries,
    setPlexLibraries,
    testingPlex,
    plexTestResult,
    testPlexConnection,

    absLibraries,
    setAbsLibraries,
    testingAbs,
    absTestResult,
    testABSConnection,

    siloLibraries,
    setSiloLibraries,
    testingSilo,
    siloTestResult,
    testAudioSiloConnection,

    loadingLibraries,
  };
}
