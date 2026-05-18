/**
 * Component: Setup Wizard Prowlarr Step
 * Documentation: documentation/setup-wizard.md
 */

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { IndexerManagement } from '@/components/admin/indexers/IndexerManagement';

interface ProwlarrStepProps {
  prowlarrUrl: string;
  prowlarrApiKey: string;
  prowlarrIndexers: SelectedIndexer[];
  onUpdate: (field: string, value: any) => void;
  onNext: () => void;
  onBack: () => void;
}

interface SelectedIndexer {
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

export function ProwlarrStep({
  prowlarrUrl,
  prowlarrApiKey,
  prowlarrIndexers,
  onUpdate,
  onNext,
  onBack,
}: ProwlarrStepProps) {
  const [configuredIndexers, setConfiguredIndexers] = useState<SelectedIndexer[]>(prowlarrIndexers);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Update both local and parent state when indexers change
  const handleIndexersChange = (indexers: SelectedIndexer[]) => {
    setConfiguredIndexers(indexers);
    onUpdate('prowlarrIndexers', indexers);
  };

  const handleNext = () => {
    setErrorMessage(null);

    if (!prowlarrUrl || !prowlarrApiKey) {
      setErrorMessage('Please enter Prowlarr URL and API key');
      return;
    }

    if (configuredIndexers.length === 0) {
      setErrorMessage('Please add at least one indexer');
      return;
    }

    onNext();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Configure Prowlarr
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          Connect to Prowlarr to search for audiobooks across multiple indexers.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Prowlarr URL
          </label>
          <Input
            type="url"
            placeholder="http://localhost:9696"
            value={prowlarrUrl}
            onChange={(e) => onUpdate('prowlarrUrl', e.target.value)}
          />
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            The URL where Prowlarr is running (include port)
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            API Key
          </label>
          <Input
            type="password"
            placeholder="Enter your Prowlarr API key"
            value={prowlarrApiKey}
            onChange={(e) => onUpdate('prowlarrApiKey', e.target.value)}
          />
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Find this in Prowlarr Settings → General → Security → API Key
          </p>
        </div>

        {errorMessage && (
          <div className="rounded-lg p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
            <div className="flex gap-3">
              <svg
                className="w-6 h-6 flex-shrink-0 text-red-600 dark:text-red-400"
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
                <h3 className="text-sm font-medium text-red-800 dark:text-red-200">
                  Error
                </h3>
                <p className="text-sm mt-1 text-red-700 dark:text-red-300">
                  {errorMessage}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Indexer Management Component */}
        <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
          <IndexerManagement
            prowlarrUrl={prowlarrUrl}
            prowlarrApiKey={prowlarrApiKey}
            mode="wizard"
            initialIndexers={configuredIndexers}
            onIndexersChange={handleIndexersChange}
          />
        </div>
      </div>

      {/* Navigation Buttons */}
      <div className="flex justify-between pt-6 border-t border-gray-200 dark:border-gray-700">
        <Button onClick={onBack} variant="outline">
          Back
        </Button>
        <Button onClick={handleNext} variant="primary">
          Next
        </Button>
      </div>
    </div>
  );
}
