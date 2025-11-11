/**
 * Component: Setup Wizard Prowlarr Step
 * Documentation: documentation/setup-wizard.md
 */

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

interface ProwlarrStepProps {
  prowlarrUrl: string;
  prowlarrApiKey: string;
  onUpdate: (field: string, value: any) => void;
  onNext: () => void;
  onBack: () => void;
}

interface IndexerInfo {
  id: number;
  name: string;
  protocol: string;
}

interface SelectedIndexer {
  id: number;
  name: string;
  priority: number;
}

export function ProwlarrStep({
  prowlarrUrl,
  prowlarrApiKey,
  onUpdate,
  onNext,
  onBack,
}: ProwlarrStepProps) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    indexerCount?: number;
  } | null>(null);
  const [availableIndexers, setAvailableIndexers] = useState<IndexerInfo[]>([]);
  const [selectedIndexers, setSelectedIndexers] = useState<Record<number, SelectedIndexer>>({});

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      const response = await fetch('/api/setup/test-prowlarr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: prowlarrUrl, apiKey: prowlarrApiKey }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setTestResult({
          success: true,
          message: `Connected successfully! Found ${data.indexerCount || 0} configured indexers.`,
          indexerCount: data.indexerCount,
        });
        setAvailableIndexers(data.indexers || []);

        // Auto-select all indexers with default priority of 10
        const autoSelected: Record<number, SelectedIndexer> = {};
        data.indexers.forEach((indexer: IndexerInfo) => {
          autoSelected[indexer.id] = {
            id: indexer.id,
            name: indexer.name,
            priority: 10,
          };
        });
        setSelectedIndexers(autoSelected);
        onUpdate('prowlarrIndexers', Object.values(autoSelected));
      } else {
        setTestResult({
          success: false,
          message: data.error || 'Connection failed',
        });
      }
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : 'Connection test failed',
      });
    } finally {
      setTesting(false);
    }
  };

  const toggleIndexer = (indexer: IndexerInfo) => {
    setSelectedIndexers((prev) => {
      const newSelected = { ...prev };
      if (newSelected[indexer.id]) {
        delete newSelected[indexer.id];
      } else {
        newSelected[indexer.id] = {
          id: indexer.id,
          name: indexer.name,
          priority: 10, // Default priority
        };
      }
      onUpdate('prowlarrIndexers', Object.values(newSelected));
      return newSelected;
    });
  };

  const updatePriority = (indexerId: number, priority: number) => {
    setSelectedIndexers((prev) => {
      const newSelected = { ...prev };
      if (newSelected[indexerId]) {
        newSelected[indexerId] = {
          ...newSelected[indexerId],
          priority: Math.max(1, Math.min(25, priority)), // Clamp between 1-25
        };
      }
      onUpdate('prowlarrIndexers', Object.values(newSelected));
      return newSelected;
    });
  };

  const handleNext = () => {
    if (!testResult?.success) {
      setTestResult({
        success: false,
        message: 'Please test the connection before proceeding',
      });
      return;
    }

    if (Object.keys(selectedIndexers).length === 0) {
      setTestResult({
        success: false,
        message: 'Please select at least one indexer',
      });
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

        <Button
          onClick={testConnection}
          loading={testing}
          disabled={!prowlarrUrl || !prowlarrApiKey}
          variant="outline"
          className="w-full"
        >
          Test Connection
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

        {/* Indexer Selection */}
        {availableIndexers.length > 0 && (
          <div className="space-y-3">
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">
                Select Indexers & Set Priorities (1-25)
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                Higher priority indexers (closer to 25) will be preferred when ranking search results.
                Indexers with equal priority will compete on a level playing field.
              </p>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {availableIndexers.map((indexer) => (
                  <div
                    key={indexer.id}
                    className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
                  >
                    <input
                      type="checkbox"
                      id={`indexer-${indexer.id}`}
                      checked={!!selectedIndexers[indexer.id]}
                      onChange={() => toggleIndexer(indexer)}
                      className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <label
                      htmlFor={`indexer-${indexer.id}`}
                      className="flex-1 text-sm font-medium text-gray-900 dark:text-gray-100 cursor-pointer"
                    >
                      {indexer.name}
                      <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                        ({indexer.protocol})
                      </span>
                    </label>
                    {selectedIndexers[indexer.id] && (
                      <div className="flex items-center gap-2">
                        <label
                          htmlFor={`priority-${indexer.id}`}
                          className="text-xs text-gray-600 dark:text-gray-400"
                        >
                          Priority:
                        </label>
                        <input
                          id={`priority-${indexer.id}`}
                          type="number"
                          min="1"
                          max="25"
                          value={selectedIndexers[indexer.id].priority}
                          onChange={(e) =>
                            updatePriority(indexer.id, parseInt(e.target.value) || 10)
                          }
                          className="w-16 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                Selected: {Object.keys(selectedIndexers).length} of {availableIndexers.length} indexers
              </p>
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
              About Prowlarr Indexers
            </p>
            <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
              Prowlarr searches across multiple torrent indexers. Select which indexers to use and assign priorities to control
              how search results are ranked. Make sure you have at least one indexer configured in Prowlarr before proceeding.
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
