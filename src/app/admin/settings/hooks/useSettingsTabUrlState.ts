/**
 * Component: useSettingsTabUrlState Hook
 * Documentation: documentation/settings-pages.md
 *
 * Active Settings tab <-> `?tab=`. The URL is the source of truth:
 * - read on every render; an unknown tab, or one this backend mode does not show, reads as the
 *   default and the URL is left alone (no write, so no redirect loop and no flash of another tab)
 * - a click pushes a history entry, so back/forward move between tabs. It uses the native History
 *   API, which Next.js syncs into useSearchParams without a server round trip: the switch stays as
 *   instant as it was with local state, and the page keeps its unsaved edits (no remount)
 * - the default tab is omitted from the URL (short links, like the other admin URL-state hooks)
 */

'use client';

import { useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import type { SettingsTab } from '../lib/types';

export const SETTINGS_TAB_PARAM = 'tab';
export const DEFAULT_SETTINGS_TAB: SettingsTab = 'library';

/** The requested tab if this backend mode shows it, else the default */
export function resolveSettingsTab(requested: string | null, available: readonly SettingsTab[]): SettingsTab {
  return available.find((tab) => tab === requested) ?? DEFAULT_SETTINGS_TAB;
}

export interface UseSettingsTabUrlStateResult {
  activeTab: SettingsTab;
  /** Opens a tab: pushes `?tab=<id>` (no param for the default tab); a no-op when the URL already says so */
  selectTab: (tab: SettingsTab) => void;
}

/** @param available tab ids the current backend mode shows (`getTabs(backendMode)`); empty while settings load */
export function useSettingsTabUrlState(available: readonly SettingsTab[]): UseSettingsTabUrlStateResult {
  const searchParams = useSearchParams();
  const activeTab = resolveSettingsTab(searchParams?.get(SETTINGS_TAB_PARAM) ?? null, available);

  const selectTab = useCallback(
    (tab: SettingsTab) => {
      const current = searchParams?.toString() ?? '';
      const params = new URLSearchParams(current);
      if (tab === DEFAULT_SETTINGS_TAB) params.delete(SETTINGS_TAB_PARAM);
      else params.set(SETTINGS_TAB_PARAM, tab);
      const next = params.toString();
      if (next === current) return;
      window.history.pushState(null, '', `${window.location.pathname}${next ? `?${next}` : ''}`);
    },
    [searchParams]
  );

  return { activeTab, selectTab };
}
