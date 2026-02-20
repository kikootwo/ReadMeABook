/**
 * Component: Plex Library Settings Section
 * Documentation: documentation/settings-pages.md
 */

import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Settings, PlexLibrary } from '../../lib/types';
import { AUDIBLE_REGIONS } from '@/lib/types/audible';

interface PlexSectionProps {
  settings: Settings;
  onChange: (settings: Settings) => void;
  onValidationChange: (section: string, isValid: boolean) => void;
  libraries: PlexLibrary[];
  testing: boolean;
  testResult: { success: boolean; message: string } | null;
  onTestConnection: () => void;
}

export function PlexSection({
  settings,
  onChange,
  onValidationChange,
  libraries,
  testing,
  testResult,
  onTestConnection,
}: PlexSectionProps) {
  const handleUrlChange = (url: string) => {
    onChange({
      ...settings,
      plex: { ...settings.plex, url },
    });
    onValidationChange('plex', false);
  };

  const handleTokenChange = (token: string) => {
    onChange({
      ...settings,
      plex: { ...settings.plex, token },
    });
    onValidationChange('plex', false);
  };

  const handleLibraryChange = (libraryId: string) => {
    onChange({
      ...settings,
      plex: { ...settings.plex, libraryId },
    });
    onValidationChange('plex', false);
  };

  const handleTriggerScanChange = (triggerScanAfterImport: boolean) => {
    onChange({
      ...settings,
      plex: { ...settings.plex, triggerScanAfterImport },
    });
  };

  const handleAudibleRegionChange = (audibleRegion: string) => {
    onChange({
      ...settings,
      audibleRegion,
    });
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Plex Media Server
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          Configure your Plex server connection and audiobook library.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Server URL
        </label>
        <Input
          type="url"
          value={settings.plex.url}
          onChange={(e) => handleUrlChange(e.target.value)}
          placeholder="http://localhost:32400"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Authentication Token
        </label>
        <Input
          type="password"
          value={settings.plex.token}
          onChange={(e) => handleTokenChange(e.target.value)}
          placeholder="Enter your Plex token"
        />
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Find your token in Plex settings → Network → Show Advanced
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Audiobook Library
        </label>
        {libraries.length > 0 ? (
          <select
            value={settings.plex.libraryId}
            onChange={(e) => handleLibraryChange(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          >
            <option value="">Select a library...</option>
            {libraries.map((lib) => (
              <option key={lib.id} value={lib.id}>
                {lib.title} ({lib.type})
              </option>
            ))}
          </select>
        ) : (
          <div className="text-sm text-gray-500 py-2">
            Test your connection to load libraries.
          </div>
        )}
      </div>

      <div className="space-y-2">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.plex.triggerScanAfterImport}
            onChange={(e) => handleTriggerScanChange(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
          />
          <div className="flex-1">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Trigger library scan after import
            </span>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Automatically triggers Plex to scan its filesystem after organizing downloaded files.
              Only enable this if you have Plex's filesystem watcher (automatic scanning) disabled.
              Most users should leave this disabled and rely on Plex's built-in automatic detection.
            </p>
          </div>
        </label>
      </div>

      {/* Audible Region Selection */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-6 space-y-2">
        <label
          htmlFor="audible-region"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Audible Region
        </label>
        <select
          id="audible-region"
          value={settings.audibleRegion || 'us'}
          onChange={(e) => handleAudibleRegionChange(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {Object.values(AUDIBLE_REGIONS).map((region) => (
            <option key={region.code} value={region.code}>
              {region.name}{region.language !== 'en' ? ' *' : ''}
            </option>
          ))}
        </select>
        {AUDIBLE_REGIONS[settings.audibleRegion as keyof typeof AUDIBLE_REGIONS]?.language !== 'en' && (
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
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Select the Audible region that matches your metadata engine (Audnexus/Audible Agent)
          configuration in Plex. This ensures accurate book matching and metadata.
        </p>
      </div>

      <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
        <Button
          onClick={onTestConnection}
          loading={testing}
          disabled={!settings.plex.url || !settings.plex.token}
          variant="outline"
          className="w-full"
        >
          Test Connection
        </Button>
        {testResult && (
          <div className={`mt-3 p-3 rounded-lg text-sm ${
            testResult.success
              ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200'
              : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
          }`}>
            {testResult.message}
          </div>
        )}
      </div>
    </div>
  );
}
