/**
 * Component: Audiobookshelf Configuration Step
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

interface AudiobookshelfStepProps {
  absUrl: string;
  absApiToken: string;
  absLibraryId: string;
  absTriggerScanAfterImport: boolean;
  onUpdate: (field: string, value: string | boolean) => void;
  onNext: () => void;
  onBack: () => void;
}

interface Library {
  id: string;
  name: string;
  itemCount: number;
}

export function AudiobookshelfStep({
  absUrl,
  absApiToken,
  absLibraryId,
  absTriggerScanAfterImport,
  onUpdate,
  onNext,
  onBack,
}: AudiobookshelfStepProps) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message?: string;
    libraries?: Library[];
  } | null>(null);
  const [libraries, setLibraries] = useState<Library[]>([]);

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      const response = await fetch('/api/setup/test-abs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverUrl: absUrl, apiToken: absApiToken }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setTestResult({
          success: true,
          message: 'Connection successful!',
          libraries: data.libraries || [],
        });
        setLibraries(data.libraries || []);
      } else {
        setTestResult({
          success: false,
          message: data.error || 'Connection failed',
        });
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

  const handleNext = () => {
    if (!testResult?.success) {
      setTestResult({
        success: false,
        message: 'Please test the connection before proceeding',
      });
      return;
    }

    if (!absLibraryId) {
      setTestResult({
        success: false,
        message: 'Please select an audiobook library',
      });
      return;
    }

    onNext();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Configure Audiobookshelf
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          Enter your Audiobookshelf server details and API token.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Server URL
          </label>
          <Input
            type="url"
            placeholder="http://audiobookshelf:13378"
            value={absUrl}
            onChange={(e) => onUpdate('absUrl', e.target.value)}
          />
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            The URL where your Audiobookshelf server is running (include port)
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            API Token
          </label>
          <Input
            type="password"
            placeholder="Your API token"
            value={absApiToken}
            onChange={(e) => onUpdate('absApiToken', e.target.value)}
          />
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Generate this in Audiobookshelf → Settings → API Keys → Add API Key
          </p>
        </div>

        <Button
          onClick={testConnection}
          loading={testing}
          disabled={!absUrl || !absApiToken}
          variant="outline"
          className="w-full"
        >
          Test Connection
        </Button>

        {testResult && (
          <div
            className={`rounded-lg p-4 ${
              testResult.success
                ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
                : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
            }`}
          >
            <div className="flex gap-3">
              <svg
                className={`w-6 h-6 flex-shrink-0 ${
                  testResult.success
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-red-600 dark:text-red-400'
                }`}
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                {testResult.success ? (
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                ) : (
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                )}
              </svg>
              <div>
                <h3
                  className={`text-sm font-medium ${
                    testResult.success
                      ? 'text-green-800 dark:text-green-200'
                      : 'text-red-800 dark:text-red-200'
                  }`}
                >
                  {testResult.success ? 'Success' : 'Error'}
                </h3>
                <p
                  className={`text-sm mt-1 ${
                    testResult.success
                      ? 'text-green-700 dark:text-green-300'
                      : 'text-red-700 dark:text-red-300'
                  }`}
                >
                  {testResult.message}
                </p>
              </div>
            </div>
          </div>
        )}

        {libraries.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Audiobook Library
            </label>
            <select
              value={absLibraryId}
              onChange={(e) => onUpdate('absLibraryId', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            >
              <option value="">Select a library...</option>
              {libraries.map((lib) => (
                <option key={lib.id} value={lib.id}>
                  {lib.name}
                </option>
              ))}
            </select>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Select the library containing your audiobooks
            </p>
          </div>
        )}

        {libraries.length > 0 && (
          <div className="space-y-2">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={absTriggerScanAfterImport}
                onChange={(e) => onUpdate('absTriggerScanAfterImport', e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
              />
              <div className="flex-1">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Trigger library scan after import
                </span>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Only enable this if you have Audiobookshelf's filesystem watcher (automatic scanning) disabled.
                  Most users should leave this unchecked and rely on Audiobookshelf's built-in automatic detection.
                </p>
              </div>
            </label>
          </div>
        )}
      </div>

      <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
        <div className="flex gap-3">
          <svg
            className="w-6 h-6 text-blue-600 dark:text-blue-400 flex-shrink-0"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
              clipRule="evenodd"
            />
          </svg>
          <div>
            <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
              About API Token
            </p>
            <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
              Generate an API key in Audiobookshelf by navigating to Settings → API Keys → Add API Key.
              Give it a descriptive name and copy the generated key to use here.
            </p>
          </div>
        </div>
      </div>

      <div className="flex justify-between pt-4">
        <Button onClick={onBack} variant="outline">
          Back
        </Button>
        <Button onClick={handleNext}>Next</Button>
      </div>
    </div>
  );
}
