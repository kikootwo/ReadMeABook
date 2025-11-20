/**
 * Component: BookDate Setup Step (Setup Wizard)
 * Documentation: documentation/features/bookdate-prd.md
 */

'use client';

import { useState } from 'react';

interface BookDateStepProps {
  bookdateProvider: string;
  bookdateApiKey: string;
  bookdateModel: string;
  bookdateConfigured: boolean;
  onUpdate: (field: string, value: any) => void;
  onNext: () => void;
  onSkip: () => void;
  onBack: () => void;
}

interface ModelOption {
  id: string;
  name: string;
}

export function BookDateStep({
  bookdateProvider,
  bookdateApiKey,
  bookdateModel,
  bookdateConfigured,
  onUpdate,
  onNext,
  onSkip,
  onBack,
}: BookDateStepProps) {
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState(bookdateConfigured);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleTestConnection = async () => {
    if (!bookdateApiKey.trim()) {
      setError('Please enter an API key');
      return;
    }

    setTesting(true);
    setError(null);

    try {
      const response = await fetch('/api/bookdate/test-connection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: bookdateProvider,
          apiKey: bookdateApiKey,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Connection test failed');
      }

      setModels(data.models || []);
      setTested(true);
      onUpdate('bookdateConfigured', true);

      // Auto-select first model if none selected
      if (!bookdateModel && data.models?.length > 0) {
        onUpdate('bookdateModel', data.models[0].id);
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection test failed');
      setTested(false);
      onUpdate('bookdateConfigured', false);
    } finally {
      setTesting(false);
    }
  };

  const handleNext = () => {
    if (tested && bookdateModel) {
      onNext();
    } else {
      setError('Please test connection and select a model');
    }
  };

  const canProceed = tested && bookdateModel;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          BookDate Setup (Optional)
        </h2>
        <p className="text-gray-600 dark:text-gray-400">
          Configure AI-powered audiobook recommendations. You can skip this step and set it up
          later in Settings.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {/* AI Provider Selection */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          AI Provider
        </label>
        <select
          value={bookdateProvider}
          onChange={(e) => {
            onUpdate('bookdateProvider', e.target.value);
            setTested(false);
            setModels([]);
            onUpdate('bookdateConfigured', false);
          }}
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
        >
          <option value="openai">OpenAI</option>
          <option value="claude">Claude (Anthropic)</option>
        </select>
      </div>

      {/* API Key Input */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          API Key
        </label>
        <input
          type="password"
          value={bookdateApiKey}
          onChange={(e) => {
            onUpdate('bookdateApiKey', e.target.value);
            setTested(false);
            setModels([]);
            onUpdate('bookdateConfigured', false);
          }}
          placeholder={bookdateProvider === 'openai' ? 'sk-...' : 'sk-ant-...'}
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
        />
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Your API key is stored securely and only used for recommendations
        </p>
      </div>

      {/* Test Connection Button */}
      <button
        onClick={handleTestConnection}
        disabled={!bookdateApiKey.trim() || testing}
        className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
      >
        {testing ? 'Testing...' : 'Test Connection & Fetch Models'}
      </button>

      {/* Model Selection (shown after successful test) */}
      {tested && models.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Select Model
          </label>
          <select
            value={bookdateModel}
            onChange={(e) => onUpdate('bookdateModel', e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
          >
            <option value="">-- Choose a model --</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Info about per-user preferences */}
      {tested && bookdateModel && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <p className="text-sm text-blue-800 dark:text-blue-300">
            <strong>Note:</strong> Library scope and custom prompt preferences can be configured per-user after setup.
            Users can adjust these in their BookDate preferences (settings icon on the BookDate page).
          </p>
        </div>
      )}

      {/* Navigation Buttons */}
      <div className="flex gap-4 pt-4">
        <button
          onClick={onBack}
          className="px-6 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          Back
        </button>
        <button
          onClick={onSkip}
          className="px-6 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          Skip for now
        </button>
        <button
          onClick={handleNext}
          disabled={!canProceed}
          className="flex-1 px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
        >
          Next
        </button>
      </div>
    </div>
  );
}
