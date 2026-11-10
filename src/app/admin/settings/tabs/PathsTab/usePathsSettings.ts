/**
 * Component: Paths Settings Tab - Custom Hook
 * Documentation: documentation/settings-pages.md
 */

'use client';

import { useState } from 'react';
import { fetchWithAuth } from '@/lib/utils/api';
import type { PathsSettings, TestResult } from '../../lib/types';

interface UsePathsSettingsProps {
  paths: PathsSettings;
  onChange: (paths: PathsSettings) => void;
  onValidationChange: (isValid: boolean) => void;
}

export function usePathsSettings({ paths, onChange, onValidationChange }: UsePathsSettingsProps) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  /**
   * Update a single path field
   */
  const updatePath = (field: keyof PathsSettings, value: string | boolean) => {
    onChange({ ...paths, [field]: value });
    onValidationChange(false);
  };

  /** Update several fields at once (the Metadata choice sets two keys) */
  const updatePaths = (patch: Partial<PathsSettings>) => {
    onChange({ ...paths, ...patch });
    onValidationChange(false);
  };

  /**
   * Test if paths are valid and writable, including template validation
   */
  const testPaths = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      const response = await fetchWithAuth('/api/setup/test-paths', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          downloadDir: paths.downloadDir,
          mediaDir: paths.mediaDir,
          audiobookPathTemplate: paths.audiobookPathTemplate,
          ebookPathTemplate: paths.ebookPathTemplate,
        }),
      });

      const data = await response.json();

      if (data.success) {
        const result: TestResult = {
          success: true,
          message: 'All paths are valid and writable',
          templateValidation: data.template
        };
        setTestResult(result);
        onValidationChange(true);
        return result;
      } else {
        const result: TestResult = {
          success: false,
          message: data.error || 'Path validation failed',
          templateValidation: data.template
        };
        setTestResult(result);
        // Only mark as valid if paths are valid AND template is valid (if provided)
        const isValid = false;
        onValidationChange(isValid);
        return result;
      }
    } catch (error) {
      const result: TestResult = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to test paths'
      };
      setTestResult(result);
      onValidationChange(false);
      return result;
    } finally {
      setTesting(false);
    }
  };

  return {
    testing,
    testResult,
    updatePath,
    updatePaths,
    testPaths,
  };
}
