/**
 * Component: Backend Selection Step
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

'use client';

import { Button } from '@/components/ui/Button';
import { AudibleRegion, AUDIBLE_REGIONS } from '@/lib/types/audible';

interface BackendSelectionStepProps {
  value: 'plex' | 'audiobookshelf';
  onChange: (value: 'plex' | 'audiobookshelf') => void;
  audibleRegion: AudibleRegion;
  onAudibleRegionChange: (region: AudibleRegion) => void;
  onNext: () => void;
  onBack: () => void;
}

export function BackendSelectionStep({
  value,
  onChange,
  audibleRegion,
  onAudibleRegionChange,
  onNext,
  onBack,
}: BackendSelectionStepProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Choose Your Library Backend
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          Select which media server you'll use to manage your audiobook library.
        </p>
      </div>

      <div className="space-y-4">
        <label
          className={`block p-4 border-2 rounded-lg cursor-pointer transition ${
            value === 'plex'
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
              : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
          }`}
        >
          <input
            type="radio"
            name="backend"
            value="plex"
            checked={value === 'plex'}
            onChange={() => onChange('plex')}
            className="sr-only"
          />
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-orange-500 rounded-lg flex items-center justify-center flex-shrink-0">
              <span className="text-white text-2xl font-bold">P</span>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                Plex Media Server
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Use Plex for library management. Authentication via Plex OAuth.
              </p>
            </div>
          </div>
        </label>

        <label
          className={`block p-4 border-2 rounded-lg cursor-pointer transition ${
            value === 'audiobookshelf'
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
              : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
          }`}
        >
          <input
            type="radio"
            name="backend"
            value="audiobookshelf"
            checked={value === 'audiobookshelf'}
            onChange={() => onChange('audiobookshelf')}
            className="sr-only"
          />
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-green-500 rounded-lg flex items-center justify-center flex-shrink-0">
              <span className="text-white text-2xl font-bold">A</span>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                Audiobookshelf
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Use Audiobookshelf for library management. Choose OIDC or password
                authentication.
              </p>
            </div>
          </div>
        </label>
      </div>

      {/* Audible Region Selection */}
      <div className="space-y-2">
        <label
          htmlFor="audible-region"
          className="block text-sm font-medium text-gray-900 dark:text-gray-100"
        >
          Audible Region
        </label>
        <select
          id="audible-region"
          value={audibleRegion}
          onChange={(e) => onAudibleRegionChange(e.target.value as AudibleRegion)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {Object.values(AUDIBLE_REGIONS).map((region) => (
            <option key={region.code} value={region.code}>
              {region.name}{region.language !== 'en' ? ' *' : ''}
            </option>
          ))}
        </select>
        {AUDIBLE_REGIONS[audibleRegion]?.language !== 'en' && (
          <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4 border border-amber-200 dark:border-amber-800 mt-2">
            <div className="flex gap-3">
              <svg
                className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5"
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
                <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                  Non-English Region
                </p>
                <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                  Many features such as search, discovery, and metadata matching are not yet fully
                  supported for non-English regions. You may still proceed, but expect limited
                  functionality.
                </p>
              </div>
            </div>
          </div>
        )}
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Select the Audible region that matches your metadata engine (Audnexus/Audible Agent)
          configuration in {value === 'plex' ? 'Plex' : 'Audiobookshelf'}. This ensures accurate book matching and metadata.
        </p>
      </div>

      <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
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
              Important Note
            </p>
            <p className="text-sm text-yellow-800 dark:text-yellow-200 mt-1">
              This choice cannot be changed after setup. To switch backends, you'll need
              to reset the application.
            </p>
          </div>
        </div>
      </div>

      <div className="flex justify-between pt-4">
        <Button onClick={onBack} variant="outline">
          Back
        </Button>
        <Button onClick={onNext}>Next</Button>
      </div>
    </div>
  );
}
