/**
 * Component: Theme Choice Hook
 * Documentation: documentation/frontend/components.md
 */

'use client';

import { useSyncExternalStore } from 'react';
import { DEFAULT_THEME_CHOICE, type ThemeChoice } from '@/lib/constants/theme';
import { readAppliedThemeChoice, subscribeToThemeChoice } from '@/lib/utils/theme';

const serverSnapshot = (): ThemeChoice => DEFAULT_THEME_CHOICE;

/** The theme choice applied to <html>, kept current when it changes. */
export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribeToThemeChoice, readAppliedThemeChoice, serverSnapshot);
}
