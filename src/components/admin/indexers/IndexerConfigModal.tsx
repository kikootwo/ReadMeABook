/**
 * Component: Indexer Configuration Modal
 * Documentation: documentation/frontend/components.md
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { CategoryTreeView } from './CategoryTreeView';
import { TorrentSeedingFields } from './IndexerConfigModalTorrentFields';
import { DEFAULT_AUDIOBOOK_CATEGORIES, DEFAULT_EBOOK_CATEGORIES } from '@/lib/utils/torrent-categories';

type CategoryTab = 'audiobook' | 'ebook';

interface IndexerConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'add' | 'edit';
  indexer: {
    id: number;
    name: string;
    protocol: string;
    supportsRss: boolean;
  };
  initialConfig?: {
    priority: number;
    seedingTimeMinutes?: number;
    ratioLimit?: number;
    removeAfterProcessing?: boolean;
    rssEnabled: boolean;
    audiobookCategories: number[];
    ebookCategories: number[];
  };
  onSave: (config: {
    id: number;
    name: string;
    protocol: string;
    priority: number;
    seedingTimeMinutes?: number;
    ratioLimit?: number;
    removeAfterProcessing?: boolean;
    rssEnabled: boolean;
    audiobookCategories: number[];
    ebookCategories: number[];
  }) => void;
}

export function IndexerConfigModal({
  isOpen,
  onClose,
  mode,
  indexer,
  initialConfig,
  onSave,
}: IndexerConfigModalProps) {
  // Default values for Add mode
  const isTorrent = indexer.protocol?.toLowerCase() === 'torrent';
  const defaults = {
    priority: 10,
    seedingTimeMinutes: 0,
    ratioLimit: 0,
    removeAfterProcessing: true, // Default to true for Usenet
    rssEnabled: indexer.supportsRss,
    audiobookCategories: DEFAULT_AUDIOBOOK_CATEGORIES,
    ebookCategories: DEFAULT_EBOOK_CATEGORIES,
  };

  // Form state
  const [priority, setPriority] = useState(
    initialConfig?.priority ?? defaults.priority
  );
  const [seedingTimeMinutes, setSeedingTimeMinutes] = useState(
    initialConfig?.seedingTimeMinutes ?? defaults.seedingTimeMinutes
  );
  const [ratioLimit, setRatioLimit] = useState(
    initialConfig?.ratioLimit ?? defaults.ratioLimit
  );
  const [removeAfterProcessing, setRemoveAfterProcessing] = useState(
    initialConfig?.removeAfterProcessing ?? defaults.removeAfterProcessing
  );
  const [rssEnabled, setRssEnabled] = useState(
    initialConfig?.rssEnabled ?? defaults.rssEnabled
  );

  // Dual category state
  const [audiobookCategories, setAudiobookCategories] = useState<number[]>(
    initialConfig?.audiobookCategories ?? defaults.audiobookCategories
  );
  const [ebookCategories, setEbookCategories] = useState<number[]>(
    initialConfig?.ebookCategories ?? defaults.ebookCategories
  );

  const [activeTab, setActiveTab] = useState<CategoryTab>('audiobook');

  const [errors, setErrors] = useState<{
    priority?: string;
    seedingTimeMinutes?: string;
    ratioLimit?: string;
  }>({});

  useEffect(() => {
    if (isOpen) {
      if (mode === 'add') {
        setPriority(defaults.priority);
        setSeedingTimeMinutes(defaults.seedingTimeMinutes);
        setRatioLimit(defaults.ratioLimit);
        setRemoveAfterProcessing(defaults.removeAfterProcessing);
        setRssEnabled(defaults.rssEnabled);
        setAudiobookCategories(defaults.audiobookCategories);
        setEbookCategories(defaults.ebookCategories);
      } else {
        setPriority(initialConfig?.priority ?? defaults.priority);
        setSeedingTimeMinutes(initialConfig?.seedingTimeMinutes ?? defaults.seedingTimeMinutes);
        setRatioLimit(initialConfig?.ratioLimit ?? defaults.ratioLimit);
        setRemoveAfterProcessing(initialConfig?.removeAfterProcessing ?? defaults.removeAfterProcessing);
        setRssEnabled(initialConfig?.rssEnabled ?? defaults.rssEnabled);
        setAudiobookCategories(initialConfig?.audiobookCategories ?? defaults.audiobookCategories);
        setEbookCategories(initialConfig?.ebookCategories ?? defaults.ebookCategories);
      }
      setActiveTab('audiobook');
      setErrors({});
    }
  }, [isOpen, mode, indexer.id]);

  const validate = () => {
    const newErrors: typeof errors = {};

    if (priority < 1 || priority > 25) {
      newErrors.priority = 'Priority must be between 1 and 25';
    }

    if (isTorrent && seedingTimeMinutes < 0) {
      newErrors.seedingTimeMinutes = 'Seeding time cannot be negative';
    }

    if (isTorrent && ratioLimit < 0) {
      newErrors.ratioLimit = 'Ratio limit cannot be negative';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (!validate()) {
      return;
    }

    const config: any = {
      id: indexer.id,
      name: indexer.name,
      protocol: indexer.protocol,
      priority,
      rssEnabled: indexer.supportsRss ? rssEnabled : false,
      audiobookCategories,
      ebookCategories,
    };

    // Add protocol-specific fields
    if (isTorrent) {
      config.seedingTimeMinutes = seedingTimeMinutes;
      config.ratioLimit = ratioLimit;
    } else {
      config.removeAfterProcessing = removeAfterProcessing;
    }

    onSave(config);
    onClose();
  };

  const handlePriorityChange = (value: string) => {
    const parsed = parseInt(value);
    if (!isNaN(parsed)) {
      // Clamp value between 1 and 25
      setPriority(Math.max(1, Math.min(25, parsed)));
    } else if (value === '') {
      setPriority(1);
    }
  };

  const handleSeedingTimeChange = (value: string) => {
    if (value === '') {
      setSeedingTimeMinutes(0);
    } else {
      const parsed = parseInt(value);
      if (!isNaN(parsed)) {
        setSeedingTimeMinutes(Math.max(0, parsed));
      }
    }
  };

  const handleRatioLimitChange = (value: string) => {
    if (value === '') {
      setRatioLimit(0);
    } else {
      const parsed = parseFloat(value);
      if (!isNaN(parsed)) {
        setRatioLimit(Math.max(0, parsed));
      }
    }
  };

  // Get the current categories based on active tab
  const currentCategories = activeTab === 'audiobook' ? audiobookCategories : ebookCategories;
  const setCurrentCategories = activeTab === 'audiobook' ? setAudiobookCategories : setEbookCategories;
  const defaultForTab = activeTab === 'audiobook' ? DEFAULT_AUDIOBOOK_CATEGORIES : DEFAULT_EBOOK_CATEGORIES;

  // Warning state: no categories means this indexer is effectively disabled for that type
  const audiobookDisabled = audiobookCategories.length === 0;
  const ebookDisabled = ebookCategories.length === 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={mode === 'add' ? 'Add Indexer' : 'Edit Indexer'}
      size="md"
    >
      <div className="space-y-6">
        {/* Indexer Info (readonly) */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Indexer
          </label>
          <div className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
            <span className="text-base font-medium text-gray-900 dark:text-gray-100">
              {indexer.name}
            </span>
            <span className="text-xs px-2 py-1 rounded bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
              {indexer.protocol}
            </span>
          </div>
        </div>

        {/* Priority */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Priority (1-25)
          </label>
          <Input
            type="number"
            min="1"
            max="25"
            value={priority}
            onChange={(e) => handlePriorityChange(e.target.value)}
            className={errors.priority ? 'border-red-500' : ''}
          />
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Higher values = preferred in ranking algorithm
          </p>
          {errors.priority && (
            <p className="text-sm text-red-600 dark:text-red-400 mt-1">
              {errors.priority}
            </p>
          )}
        </div>

        {/* Seeding Time + Ratio Limit (Torrents only) */}
        {isTorrent && (
          <TorrentSeedingFields
            seedingTimeMinutes={seedingTimeMinutes}
            ratioLimit={ratioLimit}
            errors={errors}
            onSeedingTimeChange={handleSeedingTimeChange}
            onRatioLimitChange={handleRatioLimitChange}
          />
        )}

        {/* Remove After Processing (Usenet only) */}
        {!isTorrent && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Post-Processing Cleanup
            </label>
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={removeAfterProcessing}
                onChange={(e) => setRemoveAfterProcessing(e.target.checked)}
                className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Remove download from SABnzbd after files are organized
              </span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
              Recommended: Automatically deletes completed NZB downloads to save disk space
            </p>
          </div>
        )}

        {/* RSS Monitoring */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            RSS Monitoring
          </label>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={rssEnabled}
              onChange={(e) => setRssEnabled(e.target.checked)}
              disabled={!indexer.supportsRss}
              className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <span className="text-sm text-gray-600 dark:text-gray-400">
              Auto-check RSS feeds every 15 minutes
            </span>
          </div>
          {!indexer.supportsRss && (
            <p className="text-sm text-yellow-600 dark:text-yellow-400 mt-2">
              This indexer does not support RSS monitoring
            </p>
          )}
        </div>

        {/* Categories with Tabs */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            Categories
          </label>

          {/* Tab Navigation */}
          <div className="flex border-b border-gray-200 dark:border-gray-700 mb-4">
            <button
              type="button"
              onClick={() => setActiveTab('audiobook')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'audiobook'
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300'
              }`}
            >
              AudioBook
              {audiobookDisabled && (
                <span className="ml-2 text-amber-500" title="No categories — disabled for audiobooks">!</span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('ebook')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'ebook'
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300'
              }`}
            >
              EBook
              {ebookDisabled && (
                <span className="ml-2 text-amber-500" title="No categories — disabled for ebooks">!</span>
              )}
            </button>
          </div>

          {/* Tab Content */}
          <div className="max-h-72 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <CategoryTreeView
              selectedCategories={currentCategories}
              onChange={setCurrentCategories}
              defaultCategories={defaultForTab}
            />
          </div>

          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            {currentCategories.length > 0
              ? `Will search categories: [${currentCategories.join(', ')}]`
              : activeTab === 'audiobook'
                ? 'Default: Audio/Audiobook [3030]'
                : 'Default: Books/EBook [7020]'}
          </p>

          {/* Warning when all categories are deselected for the active tab */}
          {currentCategories.length === 0 && (
            <div className="flex items-start gap-2 mt-2 p-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
              <svg className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
              <p className="text-sm text-amber-700 dark:text-amber-300">
                No categories selected. This indexer will not be searched for {activeTab === 'audiobook' ? 'audiobooks' : 'ebooks'}.
              </p>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
          <Button onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button onClick={handleSave} variant="primary">
            {mode === 'add' ? 'Add Indexer' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
