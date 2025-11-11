/**
 * Component: Setup Wizard Download Client Step
 * Documentation: documentation/setup-wizard.md
 */

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

interface DownloadClientStepProps {
  downloadClient: 'qbittorrent' | 'transmission';
  downloadClientUrl: string;
  downloadClientUsername: string;
  downloadClientPassword: string;
  onUpdate: (field: string, value: string) => void;
  onNext: () => void;
  onBack: () => void;
}

export function DownloadClientStep({
  downloadClient,
  downloadClientUrl,
  downloadClientUsername,
  downloadClientPassword,
  onUpdate,
  onNext,
  onBack,
}: DownloadClientStepProps) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    version?: string;
  } | null>(null);

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      const response = await fetch('/api/setup/test-download-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: downloadClient,
          url: downloadClientUrl,
          username: downloadClientUsername,
          password: downloadClientPassword,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setTestResult({
          success: true,
          message: `Connected successfully! ${data.version ? `Version: ${data.version}` : ''}`,
          version: data.version,
        });
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

    onNext();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Configure Download Client
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          Choose and configure your torrent download client.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Download Client
          </label>
          <div className="grid grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => onUpdate('downloadClient', 'qbittorrent')}
              className={`p-4 border-2 rounded-lg text-left transition-colors ${
                downloadClient === 'qbittorrent'
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-300 dark:border-gray-600 hover:border-gray-400'
              }`}
            >
              <div className="font-semibold text-gray-900 dark:text-gray-100">qBittorrent</div>
              <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                Recommended - Full feature support
              </div>
            </button>
            <button
              type="button"
              onClick={() => onUpdate('downloadClient', 'transmission')}
              className={`p-4 border-2 rounded-lg text-left transition-colors ${
                downloadClient === 'transmission'
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-300 dark:border-gray-600 hover:border-gray-400'
              }`}
            >
              <div className="font-semibold text-gray-900 dark:text-gray-100">Transmission</div>
              <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                Coming soon
              </div>
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {downloadClient === 'qbittorrent' ? 'qBittorrent' : 'Transmission'} URL
          </label>
          <Input
            type="url"
            placeholder={downloadClient === 'qbittorrent' ? 'http://localhost:8080' : 'http://localhost:9091'}
            value={downloadClientUrl}
            onChange={(e) => onUpdate('downloadClientUrl', e.target.value)}
          />
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            The URL where your download client is running (include port)
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Username
          </label>
          <Input
            type="text"
            placeholder="admin"
            value={downloadClientUsername}
            onChange={(e) => onUpdate('downloadClientUsername', e.target.value)}
            autoComplete="username"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Password
          </label>
          <Input
            type="password"
            placeholder="Enter password"
            value={downloadClientPassword}
            onChange={(e) => onUpdate('downloadClientPassword', e.target.value)}
            autoComplete="current-password"
          />
        </div>

        <Button
          onClick={testConnection}
          loading={testing}
          disabled={!downloadClientUrl || !downloadClientUsername || !downloadClientPassword}
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
              {downloadClient === 'qbittorrent' ? 'qBittorrent Setup' : 'Transmission Setup'}
            </p>
            <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
              {downloadClient === 'qbittorrent'
                ? 'Make sure Web UI is enabled in qBittorrent settings (Tools → Options → Web UI)'
                : 'Transmission support is coming soon. Please use qBittorrent for now.'}
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
