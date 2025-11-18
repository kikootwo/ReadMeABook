/**
 * Component: Setup Wizard Welcome Step
 * Documentation: documentation/setup-wizard.md
 */

'use client';

import { Button } from '@/components/ui/Button';

interface WelcomeStepProps {
  onNext: () => void;
}

export function WelcomeStep({ onNext }: WelcomeStepProps) {
  return (
    <div className="space-y-6">
      <div className="text-center space-y-4">
        <div className="flex justify-center">
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center p-4"
            style={{ backgroundColor: '#f7f4f3' }}
          >
            <img
              src="/rmab_32x32.png"
              alt="ReadMeABook Logo"
              className="w-full h-full object-contain"
            />
          </div>
        </div>

        <h2 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
          Welcome to ReadMeABook!
        </h2>

        <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
          Let's get your audiobook automation system configured. This setup wizard will guide you
          through connecting your external services and configuring directory paths.
        </p>
      </div>

      <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-6 space-y-4">
        <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-100">
          What you'll need:
        </h3>

        <ul className="space-y-3">
          <li className="flex items-start gap-3">
            <svg
              className="w-6 h-6 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            <div>
              <strong className="text-gray-900 dark:text-gray-100">Plex Media Server</strong>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Your Plex server URL and authentication token
              </p>
            </div>
          </li>

          <li className="flex items-start gap-3">
            <svg
              className="w-6 h-6 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            <div>
              <strong className="text-gray-900 dark:text-gray-100">Prowlarr</strong>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Indexer aggregator for searching torrents (URL and API key)
              </p>
            </div>
          </li>

          <li className="flex items-start gap-3">
            <svg
              className="w-6 h-6 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            <div>
              <strong className="text-gray-900 dark:text-gray-100">
                qBittorrent or Transmission
              </strong>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Download client for managing torrent downloads (URL and credentials)
              </p>
            </div>
          </li>

          <li className="flex items-start gap-3">
            <svg
              className="w-6 h-6 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            <div>
              <strong className="text-gray-900 dark:text-gray-100">Directory Paths</strong>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Download directory and media library directory paths
              </p>
            </div>
          </li>
        </ul>
      </div>

      <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-4">
        <div className="flex gap-3">
          <svg
            className="w-6 h-6 text-yellow-600 dark:text-yellow-400 flex-shrink-0"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          <div>
            <p className="text-sm font-medium text-yellow-900 dark:text-yellow-100">
              Setup Time: 5-10 minutes
            </p>
            <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
              Make sure all external services are running and accessible before proceeding.
            </p>
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-4">
        <Button onClick={onNext} size="lg">
          Get Started
          <svg className="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Button>
      </div>
    </div>
  );
}
