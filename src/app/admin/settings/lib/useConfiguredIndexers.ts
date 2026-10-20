/**
 * Component: Admin Settings - Configured Indexers State
 * Documentation: documentation/settings-pages.md
 *
 * Holds the Indexers tab's saved-indexer list and flag configs, and decides
 * whether a save may replace what is stored. The list may replace the saved
 * one only after it was loaded from the server (or cleared on purpose after a
 * confirmed Prowlarr connection change); otherwise an empty list left by a
 * failed load would wipe every saved indexer.
 */

'use client';

import { useCallback, useState } from 'react';
import { fetchWithAuth } from '@/lib/utils/api';
import { toSavedIndexerConfig } from '@/lib/utils/indexer-config';
import type { IndexerFlagConfig } from '@/lib/utils/ranking-algorithm';
import type { IndexerConfig, Message, SavedIndexerConfig } from './types';

export interface IndexerSavePlan {
  /** PUT the indexer list and flags (only when loaded and something changed). */
  saveIndexers: boolean;
  /** The list may be empty on purpose (explicit clear, or the admin removed every indexer). */
  allowEmpty: boolean;
}

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

export function useConfiguredIndexers(setMessage: (message: Message) => void) {
  const [configuredIndexers, setConfiguredIndexers] = useState<SavedIndexerConfig[]>([]);
  const [originalConfiguredIndexers, setOriginalConfiguredIndexers] = useState<SavedIndexerConfig[]>([]);
  const [flagConfigs, setFlagConfigs] = useState<IndexerFlagConfig[]>([]);
  const [originalFlagConfigs, setOriginalFlagConfigs] = useState<IndexerFlagConfig[]>([]);
  // Once true it stays true: a later failed refresh keeps the loaded list and its edits
  const [indexersLoaded, setIndexersLoaded] = useState(false);
  const [indexersCleared, setIndexersCleared] = useState(false);

  /** Load the saved list from the server. Returns true when it loaded. */
  const fetchIndexers = useCallback(async (force = false): Promise<boolean> => {
    try {
      const response = await fetchWithAuth('/api/admin/settings/prowlarr/indexers');
      if (!response.ok) {
        console.error('Failed to fetch indexers:', response.status);
        if (force) setMessage({ type: 'error', text: 'Failed to load indexers. Check your Prowlarr settings.' });
        return false;
      }
      const data = await response.json();
      const flags = data.flagConfigs || [];
      // Shared mapping keeps every per-indexer field (e.g. ratioLimit) so saving cannot reset it
      const configured: SavedIndexerConfig[] = (data.indexers || [])
        .filter((idx: IndexerConfig) => idx.enabled)
        .map((idx: IndexerConfig) => toSavedIndexerConfig(idx));
      setFlagConfigs(flags);
      setOriginalFlagConfigs(copy(flags));
      setConfiguredIndexers(configured);
      setOriginalConfiguredIndexers(copy(configured));
      setIndexersLoaded(true);
      setIndexersCleared(false);
      return true;
    } catch (error) {
      console.error('Failed to fetch indexers:', error);
      if (force) {
        setMessage({ type: 'error', text: 'Failed to load Prowlarr indexers. Check your Prowlarr URL and API key.' });
      }
      return false;
    }
  }, [setMessage]);

  /** Prowlarr connection changed and the admin confirmed: an empty list is intended. */
  const clearIndexers = useCallback(() => {
    setConfiguredIndexers([]);
    setIndexersLoaded(true);
    setIndexersCleared(true);
  }, []);

  const indexersChanged = JSON.stringify(configuredIndexers) !== JSON.stringify(originalConfiguredIndexers);
  const flagConfigsChanged = JSON.stringify(flagConfigs) !== JSON.stringify(originalFlagConfigs);

  const savePlan: IndexerSavePlan = {
    saveIndexers: indexersLoaded && (indexersCleared || indexersChanged || flagConfigsChanged),
    allowEmpty: indexersCleared || (originalConfiguredIndexers.length > 0 && configuredIndexers.length === 0),
  };

  /** After a successful save of the plan: what is shown is now what is stored. */
  const markSaved = useCallback(() => {
    setOriginalConfiguredIndexers(copy(configuredIndexers));
    setOriginalFlagConfigs(copy(flagConfigs));
    setIndexersCleared(false);
  }, [configuredIndexers, flagConfigs]);

  return {
    configuredIndexers,
    setConfiguredIndexers,
    flagConfigs,
    setFlagConfigs,
    indexersLoaded,
    hasIndexerChanges: indexersChanged || flagConfigsChanged,
    savePlan,
    fetchIndexers,
    clearIndexers,
    markSaved,
  };
}
