/**
 * Component: Indexer Management Container
 * Documentation: documentation/frontend/components.md
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { IndexerCard } from './IndexerCard';
import { IndexerConfigModal } from './IndexerConfigModal';
import { AvailableIndexerRow } from './AvailableIndexerRow';
import { DeleteConfirmModal } from './DeleteConfirmModal';
import { fetchWithAuth } from '@/lib/utils/api';

interface ProwlarrIndexer {
  id: number;
  name: string;
  protocol: string;
  supportsRss: boolean;
}

interface SavedIndexerConfig {
  id: number;
  name: string;
  protocol: string;
  priority: number;
  seedingTimeMinutes?: number; // Torrents only
  ratioLimit?: number; // Torrents only (0 = no ratio requirement)
  removeAfterProcessing?: boolean; // Usenet only
  rssEnabled: boolean;
  audiobookCategories: number[]; // Categories for audiobook searches
  ebookCategories: number[]; // Categories for ebook searches
}

interface IndexerManagementProps {
  prowlarrUrl: string;
  prowlarrApiKey: string;
  mode: 'wizard' | 'settings';
  initialIndexers?: SavedIndexerConfig[];
  onIndexersChange?: (indexers: SavedIndexerConfig[]) => void;
}

export function IndexerManagement({
  prowlarrUrl,
  prowlarrApiKey,
  mode,
  initialIndexers = [],
  onIndexersChange,
}: IndexerManagementProps) {
  const [fetchedIndexers, setFetchedIndexers] = useState<ProwlarrIndexer[]>([]);
  const [configuredIndexers, setConfiguredIndexers] = useState<SavedIndexerConfig[]>(initialIndexers);
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    mode: 'add' | 'edit';
    indexer?: ProwlarrIndexer;
    currentConfig?: SavedIndexerConfig;
  }>({ isOpen: false, mode: 'add' });
  const [deleteModalState, setDeleteModalState] = useState<{
    isOpen: boolean;
    indexerId?: number;
    indexerName?: string;
  }>({ isOpen: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // In settings mode, the parent fetches indexers asynchronously and passes them
  // as initialIndexers after mount. This effect picks up that late-arriving data.
  // Wizard mode doesn't need this — it initializes correctly via useState above.
  useEffect(() => {
    if (mode === 'settings') {
      setConfiguredIndexers(initialIndexers);
    }
  }, [initialIndexers, mode]);

  const fetchIndexers = async () => {
    setLoading(true);
    setError(null);

    try {
      const endpoint = mode === 'wizard'
        ? '/api/setup/test-prowlarr'
        : '/api/admin/settings/test-prowlarr';

      // Use fetchWithAuth for settings mode (requires authentication)
      // Use plain fetch for wizard mode (no auth required)
      const response = mode === 'settings'
        ? await fetchWithAuth(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: prowlarrUrl,
              apiKey: prowlarrApiKey,
            }),
          })
        : await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: prowlarrUrl,
              apiKey: prowlarrApiKey,
            }),
          });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to fetch indexers');
      }

      setFetchedIndexers(data.indexers || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch indexers');
      setFetchedIndexers([]);
    } finally {
      setLoading(false);
    }
  };

  const openAddModal = (indexer: ProwlarrIndexer) => {
    setModalState({
      isOpen: true,
      mode: 'add',
      indexer,
    });
  };

  const openEditModal = (config: SavedIndexerConfig) => {
    // Find the full indexer info from fetched list
    const indexer = fetchedIndexers.find((idx) => idx.id === config.id);

    setModalState({
      isOpen: true,
      mode: 'edit',
      indexer: indexer || {
        id: config.id,
        name: config.name,
        protocol: config.protocol,
        supportsRss: config.rssEnabled,
      },
      currentConfig: config,
    });
  };

  const closeModal = () => {
    setModalState({ isOpen: false, mode: 'add' });
  };

  const handleSave = (config: SavedIndexerConfig) => {
    let updated: SavedIndexerConfig[];
    if (modalState.mode === 'add') {
      updated = [...configuredIndexers, config];
    } else {
      updated = configuredIndexers.map((idx) =>
        idx.id === config.id ? config : idx
      );
    }
    setConfiguredIndexers(updated);
    onIndexersChange?.(updated);
  };

  const handleDelete = (id: number) => {
    const indexer = configuredIndexers.find((idx) => idx.id === id);
    if (!indexer) return;

    setDeleteModalState({
      isOpen: true,
      indexerId: id,
      indexerName: indexer.name,
    });
  };

  const confirmDelete = () => {
    if (deleteModalState.indexerId) {
      const updated = configuredIndexers.filter((idx) => idx.id !== deleteModalState.indexerId);
      setConfiguredIndexers(updated);
      onIndexersChange?.(updated);
    }
  };

  const isIndexerAdded = (id: number) => {
    return configuredIndexers.some((idx) => idx.id === id);
  };

  return (
    <div className="space-y-6">
      {/* Section 1: Available Indexers */}
      <div className="border-b border-gray-200 dark:border-gray-700 pb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
            Available Indexers
          </h3>
          <Button
            onClick={fetchIndexers}
            loading={loading}
            variant="outline"
            disabled={!prowlarrUrl || !prowlarrApiKey}
          >
            {configuredIndexers.length > 0 || fetchedIndexers.length > 0
              ? 'Refresh Indexers'
              : 'Fetch Indexers'}
          </Button>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-800 dark:text-red-200">
            {error}
          </div>
        )}

        {fetchedIndexers.length > 0 && (
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
            {fetchedIndexers.map((indexer) => (
              <AvailableIndexerRow
                key={indexer.id}
                indexer={indexer}
                isAdded={isIndexerAdded(indexer.id)}
                onAdd={() => openAddModal(indexer)}
              />
            ))}
          </div>
        )}

        {!loading && fetchedIndexers.length === 0 && !error && (
          <div className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center border border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
            {prowlarrUrl && prowlarrApiKey
              ? 'Click "Fetch Indexers" to load available indexers from Prowlarr.'
              : 'Enter Prowlarr URL and API key above, then fetch indexers.'}
          </div>
        )}
      </div>

      {/* Section 2: Configured Indexers */}
      <div>
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
          Configured Indexers ({configuredIndexers.length})
        </h3>

        {configuredIndexers.length === 0 ? (
          <div className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center border border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
            <p className="mb-2">No indexers configured yet</p>
            <p className="text-xs">
              Fetch indexers from Prowlarr and click "Add" to configure them.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {configuredIndexers.map((config) => (
              <IndexerCard
                key={config.id}
                indexer={{
                  id: config.id,
                  name: config.name,
                  protocol: config.protocol,
                }}
                onEdit={() => openEditModal(config)}
                onDelete={() => handleDelete(config.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Config Modal */}
      {modalState.isOpen && modalState.indexer && (
        <IndexerConfigModal
          isOpen={modalState.isOpen}
          onClose={closeModal}
          mode={modalState.mode}
          indexer={modalState.indexer}
          initialConfig={modalState.currentConfig}
          onSave={handleSave}
        />
      )}

      {/* Delete Confirmation Modal */}
      <DeleteConfirmModal
        isOpen={deleteModalState.isOpen}
        onClose={() => setDeleteModalState({ isOpen: false })}
        onConfirm={confirmDelete}
        indexerName={deleteModalState.indexerName || ''}
      />
    </div>
  );
}
