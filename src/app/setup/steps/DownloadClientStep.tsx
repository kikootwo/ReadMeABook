/**
 * Component: Setup Wizard Download Client Step
 * Documentation: documentation/setup-wizard.md
 */

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { DownloadClientManagement } from '@/components/admin/download-clients/DownloadClientManagement';
import {
  DownloadClientType,
  ProtocolType,
  SUPPORTED_CLIENT_TYPES,
  CLIENT_PROTOCOL_MAP,
  getClientDisplayName,
} from '@/lib/interfaces/download-client.interface';

interface DownloadClient {
  id: string;
  type: DownloadClientType;
  name: string;
  enabled: boolean;
  url: string;
  username?: string;
  password: string;
  disableSSLVerify: boolean;
  remotePathMappingEnabled: boolean;
  remotePath?: string;
  localPath?: string;
  category?: string;
  customPath?: string;
  postImportCategory?: string;
}

interface DownloadClientStepProps {
  downloadClients: DownloadClient[];
  downloadDir?: string;
  onUpdate: (field: string, value: any) => void;
  onNext: () => void;
  onBack: () => void;
}

/** "qBittorrent, Transmission, or Deluge": every supported client of one protocol */
const clientNames = (protocol: ProtocolType) =>
  new Intl.ListFormat('en', { type: 'disjunction' }).format(
    SUPPORTED_CLIENT_TYPES.filter((type) => CLIENT_PROTOCOL_MAP[type] === protocol).map(getClientDisplayName)
  );

export function DownloadClientStep({
  downloadClients,
  downloadDir,
  onUpdate,
  onNext,
  onBack,
}: DownloadClientStepProps) {
  const [clients, setClients] = useState<DownloadClient[]>(downloadClients || []);
  const [error, setError] = useState<string | null>(null);

  // Update parent when clients change
  const handleClientsChange = (updatedClients: DownloadClient[]) => {
    setClients(updatedClients);
    onUpdate('downloadClients', updatedClients);
  };

  const handleNext = () => {
    // Validate: At least one enabled client required
    const hasEnabledClient = clients.some(c => c.enabled);

    if (!hasEnabledClient) {
      setError('Please add at least one download client before proceeding');
      return;
    }

    setError(null);
    onNext();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          Configure Download Clients
        </h2>
        <p className="text-gray-600 dark:text-gray-400">
          Add at least one download client. You can configure a torrent client ({clientNames('torrent')}) and/or a usenet client ({clientNames('usenet')}) to search across all indexer types.
        </p>
      </div>

      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300 rounded-lg">
          <p className="text-sm">{error}</p>
        </div>
      )}

      <DownloadClientManagement
        mode="wizard"
        initialClients={clients}
        onClientsChange={handleClientsChange}
        downloadDir={downloadDir}
      />

      <div className="flex justify-between pt-6 border-t border-gray-200 dark:border-gray-700">
        <Button onClick={onBack} variant="secondary">
          Back
        </Button>
        <Button onClick={handleNext} variant="primary">
          Next
        </Button>
      </div>
    </div>
  );
}
