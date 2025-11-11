/**
 * Component: Setup Wizard Review Step
 * Documentation: documentation/setup-wizard.md
 */

'use client';

import { Button } from '@/components/ui/Button';

interface ReviewStepProps {
  config: {
    plexUrl: string;
    plexLibraryId: string;
    prowlarrUrl: string;
    downloadClient: 'qbittorrent' | 'transmission';
    downloadClientUrl: string;
    downloadDir: string;
    mediaDir: string;
  };
  loading: boolean;
  error: string | null;
  onComplete: () => void;
  onBack: () => void;
}

export function ReviewStep({ config, loading, error, onComplete, onBack }: ReviewStepProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Review Configuration
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          Please review your configuration before completing setup.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex gap-3">
            <svg
              className="w-6 h-6 text-red-600 dark:text-red-400 flex-shrink-0"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clipRule="evenodd"
              />
            </svg>
            <div>
              <h3 className="text-sm font-medium text-red-800 dark:text-red-200">Error</h3>
              <p className="text-sm text-red-700 dark:text-red-300 mt-1">{error}</p>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {/* Plex Configuration */}
        <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
            Plex Media Server
          </h3>
          <dl className="space-y-2">
            <div className="flex justify-between">
              <dt className="text-sm text-gray-600 dark:text-gray-400">Server URL:</dt>
              <dd className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {config.plexUrl}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-gray-600 dark:text-gray-400">Library ID:</dt>
              <dd className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {config.plexLibraryId}
              </dd>
            </div>
          </dl>
        </div>

        {/* Prowlarr Configuration */}
        <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
            Prowlarr (Indexer)
          </h3>
          <dl className="space-y-2">
            <div className="flex justify-between">
              <dt className="text-sm text-gray-600 dark:text-gray-400">Server URL:</dt>
              <dd className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {config.prowlarrUrl}
              </dd>
            </div>
          </dl>
        </div>

        {/* Download Client Configuration */}
        <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
            Download Client
          </h3>
          <dl className="space-y-2">
            <div className="flex justify-between">
              <dt className="text-sm text-gray-600 dark:text-gray-400">Type:</dt>
              <dd className="text-sm font-medium text-gray-900 dark:text-gray-100 capitalize">
                {config.downloadClient}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-gray-600 dark:text-gray-400">Server URL:</dt>
              <dd className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {config.downloadClientUrl}
              </dd>
            </div>
          </dl>
        </div>

        {/* Paths Configuration */}
        <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
            Directory Paths
          </h3>
          <dl className="space-y-2">
            <div className="flex justify-between">
              <dt className="text-sm text-gray-600 dark:text-gray-400">Download Directory:</dt>
              <dd className="text-sm font-medium text-gray-900 dark:text-gray-100 font-mono">
                {config.downloadDir}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-gray-600 dark:text-gray-400">Media Directory:</dt>
              <dd className="text-sm font-medium text-gray-900 dark:text-gray-100 font-mono">
                {config.mediaDir}
              </dd>
            </div>
          </dl>
        </div>
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
              Ready to complete setup
            </p>
            <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
              Click "Complete Setup" to save your configuration and start using ReadMeABook.
            </p>
          </div>
        </div>
      </div>

      <div className="flex justify-between pt-4">
        <Button onClick={onBack} variant="outline" disabled={loading}>
          Back
        </Button>
        <Button onClick={onComplete} loading={loading} size="lg">
          Complete Setup
        </Button>
      </div>
    </div>
  );
}
