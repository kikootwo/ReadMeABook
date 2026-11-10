/**
 * Component: Download Client Management Container
 * Documentation: documentation/phase3/download-clients.md
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { DownloadClientCard } from './DownloadClientCard';
import { DownloadClientModal } from './DownloadClientModal';
import { fetchWithAuth } from '@/lib/utils/api';
import { DownloadClientType, CLIENT_PROTOCOL_MAP, getClientDisplayName } from '@/lib/interfaces/download-client.interface';

interface DownloadClient {
  id: string;
  type: DownloadClientType;
  name: string;
  url: string;
  username?: string;
  password: string;
  enabled: boolean;
  disableSSLVerify: boolean;
  remotePathMappingEnabled: boolean;
  remotePath?: string;
  localPath?: string;
  category?: string;
  customPath?: string;
  postImportCategory?: string;
}

interface DownloadClientManagementProps {
  mode: 'wizard' | 'settings';
  initialClients?: DownloadClient[];
  onClientsChange?: (clients: DownloadClient[]) => void;
  downloadDir?: string;
}

export function DownloadClientManagement({
  mode,
  initialClients = [],
  onClientsChange,
  downloadDir: downloadDirProp,
}: DownloadClientManagementProps) {
  const [clients, setClients] = useState<DownloadClient[]>(initialClients);
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    mode: 'add' | 'edit';
    clientType?: DownloadClientType;
    currentClient?: DownloadClient;
  }>({ isOpen: false, mode: 'add' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    isOpen: boolean;
    clientId?: string;
    clientName?: string;
  }>({ isOpen: false });
  const [resolvedDownloadDir, setResolvedDownloadDir] = useState(downloadDirProp || '/downloads');

  // Fetch clients and download dir when in settings mode
  useEffect(() => {
    if (mode === 'settings') {
      fetchClients();
      fetchDownloadDir();
    }
  }, [mode]);

  // Sync downloadDir prop (wizard mode)
  useEffect(() => {
    if (downloadDirProp) {
      setResolvedDownloadDir(downloadDirProp);
    }
  }, [downloadDirProp]);

  const fetchClients = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetchWithAuth('/api/admin/settings/download-clients');

      if (!response.ok) {
        throw new Error('Failed to fetch download clients');
      }

      const data = await response.json();
      setClients(data.clients || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch download clients');
    } finally {
      setLoading(false);
    }
  };

  const fetchDownloadDir = async () => {
    try {
      const response = await fetchWithAuth('/api/admin/settings');
      if (response.ok) {
        const data = await response.json();
        if (data.paths?.downloadDir) {
          setResolvedDownloadDir(data.paths.downloadDir);
        }
      }
    } catch {
      // Non-critical: fall back to default
    }
  };

  const handleAddClient = (type: DownloadClientType) => {
    // Check if the protocol is already taken (regardless of enabled status)
    const protocol = CLIENT_PROTOCOL_MAP[type];
    const existingClient = clients.find(c => CLIENT_PROTOCOL_MAP[c.type] === protocol);
    if (existingClient) {
      setError(`A ${protocol} client (${getClientDisplayName(existingClient.type)}) is already configured. Remove it first to add a different ${protocol} client.`);
      return;
    }

    setModalState({
      isOpen: true,
      mode: 'add',
      clientType: type,
    });
  };

  const handleEditClient = (client: DownloadClient) => {
    setModalState({
      isOpen: true,
      mode: 'edit',
      currentClient: client,
    });
  };

  const handleDeleteClient = (client: DownloadClient) => {
    setDeleteConfirm({
      isOpen: true,
      clientId: client.id,
      clientName: client.name,
    });
  };

  const confirmDelete = async () => {
    if (!deleteConfirm.clientId) return;

    setLoading(true);
    setError(null);

    try {
      if (mode === 'settings') {
        // API call for settings mode
        const response = await fetchWithAuth(`/api/admin/settings/download-clients/${deleteConfirm.clientId}`, {
          method: 'DELETE',
        });

        if (!response.ok) {
          throw new Error('Failed to delete download client');
        }

        await fetchClients(); // Refresh list
      } else {
        // Local removal for wizard mode
        const updated = clients.filter(c => c.id !== deleteConfirm.clientId);
        setClients(updated);
        onClientsChange?.(updated);
      }

      setDeleteConfirm({ isOpen: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete download client');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveClient = async (clientData: any) => {
    setLoading(true);
    setError(null);

    try {
      if (mode === 'settings') {
        // API call for settings mode
        if (modalState.mode === 'add') {
          const response = await fetchWithAuth('/api/admin/settings/download-clients', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(clientData),
          });

          if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to add download client');
          }

          await fetchClients(); // Refresh list
        } else {
          const response = await fetchWithAuth(`/api/admin/settings/download-clients/${clientData.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(clientData),
          });

          if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to update download client');
          }

          await fetchClients(); // Refresh list
        }
      } else {
        // Local update for wizard mode
        let updated: DownloadClient[];
        if (modalState.mode === 'add') {
          const newClient = {
            ...clientData,
            id: `temp-${Date.now()}`, // Temporary ID for wizard mode
          };
          updated = [...clients, newClient];
        } else {
          updated = clients.map(c => (c.id === clientData.id ? { ...c, ...clientData } : c));
        }
        setClients(updated);
        onClientsChange?.(updated);
      }

      setModalState({ isOpen: false, mode: 'add' });
    } catch (err) {
      throw err; // Re-throw to let modal handle the error
    } finally {
      setLoading(false);
    }
  };

  const hasTorrentClient = clients.some(c => CLIENT_PROTOCOL_MAP[c.type] === 'torrent');
  const hasUsenetClient = clients.some(c => CLIENT_PROTOCOL_MAP[c.type] === 'usenet');

  return (
    <div className="space-y-6">
      {/* Error Display */}
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300 rounded-lg">
          <p className="text-sm">{error}</p>
          <button
            onClick={() => setError(null)}
            className="mt-2 text-xs underline hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Add Client Section */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
          Add Download Client
        </h3>
        {/* At most three columns: the wizard's container is too narrow for five, whatever the viewport */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* qBittorrent Card */}
          <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6${hasTorrentClient ? ' opacity-50' : ''}`}>
            <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1 mb-3">
              <div>
                <h4 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">
                  qBittorrent
                </h4>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Torrent downloads
                </p>
              </div>
              <span className="inline-block text-xs px-2 py-1 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium">
                Torrent
              </span>
            </div>
            {hasTorrentClient ? (
              <div className="text-sm text-gray-500 dark:text-gray-400">
                Protocol already configured
              </div>
            ) : (
              <Button
                onClick={() => handleAddClient('qbittorrent')}
                variant="primary"
                size="sm"
                disabled={loading}
              >
                Add qBittorrent
              </Button>
            )}
          </div>

          {/* Transmission Card */}
          <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6${hasTorrentClient ? ' opacity-50' : ''}`}>
            <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1 mb-3">
              <div>
                <h4 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">
                  Transmission
                </h4>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Torrent downloads
                </p>
              </div>
              <span className="inline-block text-xs px-2 py-1 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 font-medium">
                Torrent
              </span>
            </div>
            {hasTorrentClient ? (
              <div className="text-sm text-gray-500 dark:text-gray-400">
                Protocol already configured
              </div>
            ) : (
              <Button
                onClick={() => handleAddClient('transmission')}
                variant="primary"
                size="sm"
                disabled={loading}
              >
                Add Transmission
              </Button>
            )}
          </div>

          {/* Deluge Card */}
          <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6${hasTorrentClient ? ' opacity-50' : ''}`}>
            <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1 mb-3">
              <div>
                <h4 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">
                  Deluge
                </h4>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Torrent downloads
                </p>
              </div>
              <span className="inline-block text-xs px-2 py-1 rounded bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 font-medium">
                Torrent
              </span>
            </div>
            {hasTorrentClient ? (
              <div className="text-sm text-gray-500 dark:text-gray-400">
                Protocol already configured
              </div>
            ) : (
              <Button
                onClick={() => handleAddClient('deluge')}
                variant="primary"
                size="sm"
                disabled={loading}
              >
                Add Deluge
              </Button>
            )}
          </div>

          {/* SABnzbd Card */}
          <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6${hasUsenetClient ? ' opacity-50' : ''}`}>
            <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1 mb-3">
              <div>
                <h4 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">
                  SABnzbd
                </h4>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Usenet/NZB downloads
                </p>
              </div>
              <span className="inline-block text-xs px-2 py-1 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 font-medium">
                Usenet
              </span>
            </div>
            {hasUsenetClient ? (
              <div className="text-sm text-gray-500 dark:text-gray-400">
                Protocol already configured
              </div>
            ) : (
              <Button
                onClick={() => handleAddClient('sabnzbd')}
                variant="primary"
                size="sm"
                disabled={loading}
              >
                Add SABnzbd
              </Button>
            )}
          </div>

          {/* NZBGet Card */}
          <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6${hasUsenetClient ? ' opacity-50' : ''}`}>
            <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1 mb-3">
              <div>
                <h4 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">
                  NZBGet
                </h4>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Usenet/NZB downloads
                </p>
              </div>
              <span className="inline-block text-xs px-2 py-1 rounded bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 font-medium">
                Usenet
              </span>
            </div>
            {hasUsenetClient ? (
              <div className="text-sm text-gray-500 dark:text-gray-400">
                Protocol already configured
              </div>
            ) : (
              <Button
                onClick={() => handleAddClient('nzbget')}
                variant="primary"
                size="sm"
                disabled={loading}
              >
                Add NZBGet
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Configured Clients Section */}
      {clients.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
            Configured Clients
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {clients.map(client => (
              <DownloadClientCard
                key={client.id}
                client={client}
                onEdit={() => handleEditClient(client)}
                onDelete={() => handleDeleteClient(client)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {clients.length === 0 && !loading && (
        <div className="text-center py-12 bg-gray-50 dark:bg-gray-800/50 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700">
          <p className="text-gray-600 dark:text-gray-400 mb-2">
            No download clients configured yet
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-500">
            Add at least one client to start downloading audiobooks
          </p>
        </div>
      )}

      {/* Client Modal */}
      <DownloadClientModal
        isOpen={modalState.isOpen}
        onClose={() => setModalState({ isOpen: false, mode: 'add' })}
        mode={modalState.mode}
        clientType={modalState.clientType}
        initialClient={modalState.currentClient}
        onSave={handleSaveClient}
        apiMode={mode}
        downloadDir={resolvedDownloadDir}
      />

      {/* Delete Confirmation Modal */}
      {deleteConfirm.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
              Delete Download Client
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              Are you sure you want to delete <strong>{deleteConfirm.clientName}</strong>? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <Button
                onClick={() => setDeleteConfirm({ isOpen: false })}
                variant="secondary"
                disabled={loading}
              >
                Cancel
              </Button>
              <Button
                onClick={confirmDelete}
                variant="danger"
                disabled={loading}
              >
                {loading ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
