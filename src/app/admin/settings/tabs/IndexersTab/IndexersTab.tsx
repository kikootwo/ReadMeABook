/**
 * Component: Indexers Settings Tab
 * Documentation: documentation/settings-pages.md
 */

'use client';

import React, { useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { Input } from '@/components/ui/Input';
import { IndexerManagement } from '@/components/admin/indexers/IndexerManagement';
import { FlagConfigRow } from '@/components/admin/FlagConfigRow';
import { IndexerFlagConfig } from '@/lib/utils/ranking-algorithm';
import { useIndexersSettings } from './useIndexersSettings';
import type { Settings, SavedIndexerConfig } from '../../lib/types';

interface IndexersTabProps {
  settings: Settings;
  originalSettings: Settings | null;
  indexers: SavedIndexerConfig[];
  flagConfigs: IndexerFlagConfig[];
  onChange: (settings: Settings) => void;
  onIndexersChange: (indexers: SavedIndexerConfig[]) => void;
  onFlagConfigsChange: (configs: IndexerFlagConfig[]) => void;
  onValidationChange: (isValid: boolean) => void;
  onRefreshIndexers?: () => Promise<void>;
  /** Clear the list on purpose (Prowlarr connection changed); defaults to onIndexersChange([]). */
  onClearIndexers?: () => void;
  /** False when the saved list could not be loaded: editing is locked until it loads. Default true. */
  indexersLoaded?: boolean;
  /** False until the saved flag rules loaded (a connection-change clear does not load them). Default true. */
  flagsLoaded?: boolean;
}

const LOCKED_NOTE =
  'Your saved indexers could not be loaded from Prowlarr, so they cannot be edited yet (saving now would overwrite them). ' +
  'Click "Test Connection" once Prowlarr is reachable to load them.';

export function IndexersTab({
  settings,
  originalSettings,
  indexers,
  flagConfigs,
  onChange,
  onIndexersChange,
  onFlagConfigsChange,
  onValidationChange,
  onRefreshIndexers,
  onClearIndexers,
  indexersLoaded = true,
  flagsLoaded = true,
}: IndexersTabProps) {
  const {
    testing,
    testResult,
    testConnection,
    showConnectionChangeConfirm,
    confirmConnectionChange,
    keepIndexersOnConnectionChange,
    cancelConnectionChange,
    configuredIndexersCount,
  } = useIndexersSettings({
    prowlarrUrl: settings.prowlarr.url,
    prowlarrApiKey: settings.prowlarr.apiKey,
    originalProwlarrUrl: originalSettings?.prowlarr.url ?? '',
    originalProwlarrApiKey: originalSettings?.prowlarr.apiKey ?? '',
    configuredIndexersCount: indexers.length,
    indexersLoaded,
    onValidationChange,
    onRefreshIndexers,
    onClearIndexers: onClearIndexers ?? (() => onIndexersChange([])),
  });

  // Auto-load indexers when component mounts if prowlarr is configured
  useEffect(() => {
    if (settings.prowlarr.url && settings.prowlarr.apiKey && onRefreshIndexers) {
      onRefreshIndexers();
    }
    // Only run on mount, not when settings change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Indexer Configuration
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          Configure your Prowlarr connection and manage which indexers to use with priority and seeding time.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Prowlarr Server URL
        </label>
        <Input
          type="url"
          value={settings.prowlarr.url}
          onChange={(e) => {
            onChange({
              ...settings,
              prowlarr: { ...settings.prowlarr, url: e.target.value },
            });
            onValidationChange(false);
          }}
          placeholder="http://localhost:9696"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Prowlarr API Key
        </label>
        <Input
          type="password"
          value={settings.prowlarr.apiKey}
          onChange={(e) => {
            onChange({
              ...settings,
              prowlarr: { ...settings.prowlarr, apiKey: e.target.value },
            });
            onValidationChange(false);
          }}
          placeholder="Enter API key"
        />
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Found in Prowlarr Settings &rarr; General &rarr; Security &rarr; API Key
        </p>
      </div>

      <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
        <Button
          onClick={testConnection}
          loading={testing}
          disabled={!settings.prowlarr.url || !settings.prowlarr.apiKey}
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

      <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
        <div className="mb-4">
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
            Auto-Search Behavior
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Control how ReadMeABook performs automatic background searches across your indexers.
          </p>
        </div>

        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
          <div className="flex items-start gap-4">
            <input
              type="checkbox"
              id="indexer-skip-unreleased"
              checked={settings.indexerOptions.skipUnreleased}
              onChange={(e) =>
                onChange({
                  ...settings,
                  indexerOptions: {
                    ...settings.indexerOptions,
                    skipUnreleased: e.target.checked,
                  },
                })
              }
              className="mt-1 h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div className="flex-1">
              <label
                htmlFor="indexer-skip-unreleased"
                className="block text-sm font-medium text-gray-900 dark:text-gray-100 cursor-pointer"
              >
                Skip unreleased books in automatic searches
              </label>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                When ON, ReadMeABook will not search indexers for books whose release date is in the future. These requests will automatically begin searching once the book is released. Manual searches are not affected.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
        <IndexerManagement
          prowlarrUrl={settings.prowlarr.url}
          prowlarrApiKey={settings.prowlarr.apiKey}
          mode="settings"
          initialIndexers={indexers}
          onIndexersChange={onIndexersChange}
          lockedReason={indexersLoaded ? undefined : LOCKED_NOTE}
          onIndexersFetched={() => {
            // Prowlarr answered: try loading the saved list too, which unlocks editing
            if (!indexersLoaded) void onRefreshIndexers?.();
          }}
        />
      </div>

      {/* Flag Configuration Section */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
        <div className="mb-4">
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
            Indexer Flag Configuration (Optional)
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Configure score bonuses or penalties for indexer flags like "Freeleech".
            These modifiers apply universally across all indexers and affect final torrent ranking.
          </p>
        </div>

        {indexersLoaded && !flagsLoaded && (
          <p role="status" className="text-sm text-amber-700 dark:text-amber-300 mb-3">
            Your saved flag rules are kept. Click &quot;Test Connection&quot; after saving to load and edit them.
          </p>
        )}
        <fieldset disabled={!indexersLoaded || !flagsLoaded} className="m-0 min-w-0 border-0 p-0">
        {flagConfigs.length > 0 && (
          <div className="space-y-3 mb-4">
            {flagConfigs.map((config, index) => (
              <FlagConfigRow
                key={index}
                config={config}
                onChange={(updated) => {
                  const newConfigs = [...flagConfigs];
                  newConfigs[index] = updated;
                  onFlagConfigsChange(newConfigs);
                }}
                onRemove={() => {
                  onFlagConfigsChange(flagConfigs.filter((_, i) => i !== index));
                }}
              />
            ))}
          </div>
        )}

        <Button
          onClick={() => {
            onFlagConfigsChange([...flagConfigs, { name: '', modifier: 0 }]);
          }}
          variant="outline"
          size="sm"
        >
          + Add Flag Rule
        </Button>

        {flagConfigs.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-3 italic">
            No flag rules configured. Flag bonuses/penalties are optional.
          </p>
        )}
        </fieldset>
      </div>

      {/* Confirmation modal for Prowlarr connection change */}
      <ConfirmModal
        isOpen={showConnectionChangeConfirm}
        onClose={cancelConnectionChange}
        onConfirm={confirmConnectionChange}
        title="Prowlarr Connection Change"
        // The list could not be loaded: most often Prowlarr just moved, so offer to keep it
        secondaryText={indexersLoaded ? undefined : 'Keep saved indexers'}
        onSecondary={indexersLoaded ? undefined : keepIndexersOnConnectionChange}
        message={indexersLoaded
          ? `Changing your Prowlarr connection will remove your ${configuredIndexersCount} configured indexer${configuredIndexersCount === 1 ? '' : 's'}. Indexer IDs are specific to each Prowlarr instance, so existing configurations cannot be preserved. You will need to re-add indexers from the new instance after saving.`
          : 'Your saved indexers could not be loaded, so they are not shown. If this is the same Prowlarr at a new address, '
            + 'choose "Keep saved indexers": they are loaded from the new address after you save. If it is a different '
            + 'Prowlarr instance, choose "Continue" to remove them (indexer IDs are specific to each instance) and re-add '
            + 'indexers from the new instance. Flag rules are kept either way.'}
        confirmText="Continue"
        cancelText="Cancel"
        variant="danger"
        isLoading={testing}
      />
    </div>
  );
}
