/**
 * Component: Setup Wizard Paths Step
 * Documentation: documentation/setup-wizard.md
 */

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

interface PathsStepProps {
  downloadDir: string;
  mediaDir: string;
  metadataTaggingEnabled: boolean;
  onUpdate: (field: string, value: string | boolean) => void;
  onNext: () => void;
  onBack: () => void;
}

export function PathsStep({
  downloadDir,
  mediaDir,
  metadataTaggingEnabled,
  onUpdate,
  onNext,
  onBack,
}: PathsStepProps) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    downloadDirValid?: boolean;
    mediaDirValid?: boolean;
  } | null>(null);

  const testPaths = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      const response = await fetch('/api/setup/test-paths', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          downloadDir,
          mediaDir,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setTestResult({
          success: true,
          message: data.message || 'Directories are ready and writable!',
          downloadDirValid: data.downloadDirValid,
          mediaDirValid: data.mediaDirValid,
        });
      } else {
        setTestResult({
          success: false,
          message: data.error || 'Path validation failed',
          downloadDirValid: data.downloadDirValid,
          mediaDirValid: data.mediaDirValid,
        });
      }
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : 'Path validation failed',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleNext = () => {
    if (!testResult?.success) {
      setTestResult({
        success: false,
        message: 'Please validate the paths before proceeding',
      });
      return;
    }

    onNext();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Configure Directory Paths
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          Set up the directories for downloads and your media library.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Download Directory
          </label>
          <Input
            type="text"
            placeholder="/downloads"
            value={downloadDir}
            onChange={(e) => onUpdate('downloadDir', e.target.value)}
            className="font-mono"
          />
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Where torrent files will be downloaded (will be created if it doesn't exist)
          </p>
          {testResult && typeof testResult.downloadDirValid !== 'undefined' && (
            <div className="flex items-center gap-2 mt-2">
              {testResult.downloadDirValid ? (
                <>
                  <svg
                    className="w-5 h-5 text-green-600 dark:text-green-400"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="text-sm text-green-700 dark:text-green-300">
                    Directory is ready and writable
                  </span>
                </>
              ) : (
                <>
                  <svg
                    className="w-5 h-5 text-red-600 dark:text-red-400"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="text-sm text-red-700 dark:text-red-300">
                    Path invalid or parent mount not writable
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Media Directory
          </label>
          <Input
            type="text"
            placeholder="/media/audiobooks"
            value={mediaDir}
            onChange={(e) => onUpdate('mediaDir', e.target.value)}
            className="font-mono"
          />
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Where organized audiobooks will be stored (will be created if it doesn't exist)
          </p>
          {testResult && typeof testResult.mediaDirValid !== 'undefined' && (
            <div className="flex items-center gap-2 mt-2">
              {testResult.mediaDirValid ? (
                <>
                  <svg
                    className="w-5 h-5 text-green-600 dark:text-green-400"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="text-sm text-green-700 dark:text-green-300">
                    Directory is ready and writable
                  </span>
                </>
              ) : (
                <>
                  <svg
                    className="w-5 h-5 text-red-600 dark:text-red-400"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="text-sm text-red-700 dark:text-red-300">
                    Path invalid or parent mount not writable
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Metadata Tagging Toggle */}
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
          <div className="flex items-start gap-4">
            <input
              type="checkbox"
              id="metadata-tagging"
              checked={metadataTaggingEnabled}
              onChange={(e) => onUpdate('metadataTaggingEnabled', e.target.checked)}
              className="mt-1 h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div className="flex-1">
              <label
                htmlFor="metadata-tagging"
                className="block text-sm font-medium text-gray-900 dark:text-gray-100 cursor-pointer"
              >
                Auto-tag audio files with metadata
              </label>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                Automatically write correct title, author, and narrator metadata to m4b and mp3 files
                during file organization. This significantly improves Plex matching accuracy for audiobooks
                with missing or incorrect metadata. Recommended: enabled.
              </p>
            </div>
          </div>
        </div>

        <Button
          onClick={testPaths}
          loading={testing}
          disabled={!downloadDir || !mediaDir}
          variant="outline"
          className="w-full"
        >
          Validate Paths
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
              About directory structure
            </p>
            <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
              Audiobooks will be organized as: Media Directory / Author / Title / files.
              Directories will be created automatically if they don't exist. Validation ensures
              the parent mount is accessible and writable.
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
