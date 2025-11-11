/**
 * Component: Setup Wizard Plex Step
 * Documentation: documentation/setup-wizard.md
 */

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

interface PlexStepProps {
  plexUrl: string;
  plexToken: string;
  plexLibraryId: string;
  onUpdate: (field: string, value: string) => void;
  onNext: () => void;
  onBack: () => void;
}

interface PlexLibrary {
  id: string;
  title: string;
  type: string;
}

export function PlexStep({
  plexUrl,
  plexToken,
  plexLibraryId,
  onUpdate,
  onNext,
  onBack,
}: PlexStepProps) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    libraries?: PlexLibrary[];
  } | null>(null);
  const [libraries, setLibraries] = useState<PlexLibrary[]>([]);

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      const response = await fetch('/api/setup/test-plex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: plexUrl, token: plexToken }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setTestResult({
          success: true,
          message: `Connected to ${data.serverName || 'Plex server'} successfully!`,
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

    if (!plexLibraryId) {
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
          Configure Plex Media Server
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          Connect to your Plex Media Server to access your audiobook library.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Plex Server URL
          </label>
          <Input
            type="url"
            placeholder="http://localhost:32400"
            value={plexUrl}
            onChange={(e) => onUpdate('plexUrl', e.target.value)}
          />
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            The URL where your Plex server is running (include port)
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Plex Token
          </label>
          <Input
            type="password"
            placeholder="Enter your Plex authentication token"
            value={plexToken}
            onChange={(e) => onUpdate('plexToken', e.target.value)}
          />
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            <a
              href="https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              How to find your Plex authentication token
            </a>
          </p>
        </div>

        <Button
          onClick={testConnection}
          loading={testing}
          disabled={!plexUrl || !plexToken}
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
              value={plexLibraryId}
              onChange={(e) => onUpdate('plexLibraryId', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            >
              <option value="">Select a library...</option>
              {libraries.map((lib) => (
                <option key={lib.id} value={lib.id}>
                  {lib.title} ({lib.type})
                </option>
              ))}
            </select>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Select the Plex library containing your audiobooks
            </p>
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
              About Plex Token
            </p>
            <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
              Your Plex authentication token is required to connect to your Plex server.
              Ensure you have access to your Plex server before proceeding.
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
