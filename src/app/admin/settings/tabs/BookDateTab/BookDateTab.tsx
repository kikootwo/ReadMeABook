/**
 * Component: BookDate Settings Tab
 * Documentation: documentation/settings-pages.md
 */

'use client';

import React from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useBookDateSettings } from './useBookDateSettings';

interface BookDateTabProps {
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

export function BookDateTab({ onSuccess, onError }: BookDateTabProps) {
  const {
    provider,
    apiKey,
    model,
    baseUrl,
    enabled,
    configured,
    models,
    testing,
    saving,
    clearingSwipes,
    setProvider,
    setApiKey,
    setModel,
    setBaseUrl,
    setEnabled,
    setModels,
    testConnection,
    saveConfig,
    clearSwipes,
  } = useBookDateSettings();

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
          BookDate Configuration
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          Configure global AI-powered audiobook recommendations. All users share this API key, but receive personalized recommendations based on their individual library and ratings.
        </p>
      </div>

      {/* Enable/Disable Toggle */}
      {configured && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-gray-900 dark:text-white mb-1">
                BookDate Feature
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {enabled ? 'Feature is currently enabled' : 'Feature is currently disabled'}
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
            </label>
          </div>
        </div>
      )}

      {/* AI Provider */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          AI Provider
        </label>
        <select
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value);
            setModels([]);
            setBaseUrl('');
          }}
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
        >
          <option value="openai">OpenAI</option>
          <option value="claude">Claude (Anthropic)</option>
          <option value="gemini">Google Gemini</option>
          <option value="custom">Custom (OpenAI-compatible)</option>
        </select>
      </div>

      {/* Base URL Input - Show for Custom Provider */}
      {provider === 'custom' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Base URL <span className="text-red-500">*</span>
          </label>
          <Input
            type="text"
            value={baseUrl}
            onChange={(e) => {
              setBaseUrl(e.target.value);
              setModels([]);
            }}
            placeholder="http://localhost:11434/v1"
          />
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            Examples:
            <br />• Ollama: <code>http://localhost:11434/v1</code>
            <br />• LM Studio: <code>http://localhost:1234/v1</code>
            <br />• vLLM: <code>http://localhost:8000/v1</code>
          </p>
        </div>
      )}

      {/* API Key */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          {provider === 'custom' ? 'API Key (Optional for local models)' : 'API Key'}
          {provider !== 'custom' && <span className="text-red-500 ml-1">*</span>}
        </label>
        <Input
          type="password"
          value={apiKey}
          onChange={(e) => {
            setApiKey(e.target.value);
            setModels([]);
          }}
          placeholder={
            provider === 'custom'
              ? 'Leave blank for local models'
              : configured
                ? '••••••••••••••••'
                : (provider === 'openai' ? 'sk-...' : provider === 'gemini' ? 'AIza...' : 'sk-ant-...')
          }
        />
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {provider === 'custom'
            ? 'Optional: Leave blank if your endpoint does not require authentication (e.g., Ollama, LM Studio)'
            : 'The API key is stored securely and encrypted. Leave blank to keep existing key.'}
        </p>
      </div>

      {/* Test Connection Button */}
      <Button
        onClick={() => testConnection(onSuccess, onError)}
        loading={testing}
        disabled={
          provider === 'custom'
            ? !baseUrl.trim()
            : (!apiKey.trim() && !configured)
        }
        variant="outline"
        className="w-full"
      >
        {configured && !apiKey.trim()
          ? 'Test Connection & Fetch Models (using saved API key)'
          : 'Test Connection & Fetch Models'}
      </Button>

      {/* Model Selection */}
      {models.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Select Model
          </label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
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

      {/* Note about per-user settings */}
      {(models.length > 0 || configured) && model && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <p className="text-sm text-blue-800 dark:text-blue-300">
            <strong>Note:</strong> Library scope and custom prompt preferences are now configured per-user.
            Users can adjust these settings in their BookDate preferences (settings icon on the BookDate page).
          </p>
        </div>
      )}

      {/* Save Button */}
      {model && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
          <Button
            onClick={() => saveConfig(onSuccess, onError)}
            loading={saving}
            disabled={!model}
            className="w-full"
          >
            Save BookDate Configuration
          </Button>
        </div>
      )}

      {/* Clear Swipe History */}
      {configured && (
        <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            Clear All Swipe History
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Remove all swipe history and cached recommendations for ALL users. This will reset everyone's BookDate recommendations.
          </p>
          <Button
            onClick={() => clearSwipes(onSuccess, onError)}
            loading={clearingSwipes}
            variant="outline"
            className="border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            Clear Swipe History
          </Button>
        </div>
      )}
    </div>
  );
}
