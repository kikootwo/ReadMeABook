/**
 * Component: User Preferences Context Provider
 * Documentation: Manages user preferences (card size, etc.) with localStorage persistence
 */

'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface Preferences {
  cardSize: number; // 1-9, default 5
  squareCovers: boolean; // true = square (1:1), false = rectangle (2:3)
  hideAvailable: boolean; // true = hide "In Your Library" titles
}

interface PreferencesContextType {
  cardSize: number;
  setCardSize: (size: number) => void;
  squareCovers: boolean;
  setSquareCovers: (enabled: boolean) => void;
  hideAvailable: boolean;
  setHideAvailable: (enabled: boolean) => void;
}

const PreferencesContext = createContext<PreferencesContextType | undefined>(undefined);

const DEFAULT_PREFERENCES: Preferences = {
  cardSize: 5,
  squareCovers: true,
  hideAvailable: false,
};

const STORAGE_KEY = 'preferences';

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [cardSize, setCardSizeState] = useState<number>(DEFAULT_PREFERENCES.cardSize);
  const [squareCovers, setSquareCoversState] = useState<boolean>(DEFAULT_PREFERENCES.squareCovers);
  const [hideAvailable, setHideAvailableState] = useState<boolean>(DEFAULT_PREFERENCES.hideAvailable);

  // Load preferences from localStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const preferences: Preferences = JSON.parse(stored);
        // Validate cardSize is within range 1-9
        if (preferences.cardSize >= 1 && preferences.cardSize <= 9) {
          setCardSizeState(preferences.cardSize);
        } else {
          // Invalid size, reset to default
          setCardSizeState(DEFAULT_PREFERENCES.cardSize);
        }
        // Load squareCovers preference (defaults to false if not set)
        setSquareCoversState(preferences.squareCovers ?? DEFAULT_PREFERENCES.squareCovers);
        // Load hideAvailable preference
        setHideAvailableState(preferences.hideAvailable ?? DEFAULT_PREFERENCES.hideAvailable);
      }
    } catch (error) {
      console.error('Failed to load preferences from localStorage:', error);
      setCardSizeState(DEFAULT_PREFERENCES.cardSize);
      setSquareCoversState(DEFAULT_PREFERENCES.squareCovers);
      setHideAvailableState(DEFAULT_PREFERENCES.hideAvailable);
    }
  }, []);

  // Update card size in state and localStorage
  const setCardSize = (size: number) => {
    if (typeof window === 'undefined') return;

    // Validate size is within range 1-9
    const validSize = Math.max(1, Math.min(9, size));

    setCardSizeState(validSize);

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const preferences: Preferences = stored ? JSON.parse(stored) : { ...DEFAULT_PREFERENCES };
      preferences.cardSize = validSize;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch (error) {
      console.error('Failed to save preferences to localStorage:', error);
    }
  };

  // Update square covers preference in state and localStorage
  const setSquareCovers = (enabled: boolean) => {
    if (typeof window === 'undefined') return;

    setSquareCoversState(enabled);

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const preferences: Preferences = stored ? JSON.parse(stored) : { ...DEFAULT_PREFERENCES };
      preferences.squareCovers = enabled;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch (error) {
      console.error('Failed to save preferences to localStorage:', error);
    }
  };

  // Update hideAvailable preference in state and localStorage
  const setHideAvailable = (enabled: boolean) => {
    if (typeof window === 'undefined') return;

    setHideAvailableState(enabled);

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const preferences: Preferences = stored ? JSON.parse(stored) : { ...DEFAULT_PREFERENCES };
      preferences.hideAvailable = enabled;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch (error) {
      console.error('Failed to save preferences to localStorage:', error);
    }
  };

  // Listen for storage changes in other tabs (cross-tab sync)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          const preferences: Preferences = JSON.parse(e.newValue);
          // Validate cardSize is within range 1-9
          if (preferences.cardSize >= 1 && preferences.cardSize <= 9) {
            setCardSizeState(preferences.cardSize);
          }
          // Sync squareCovers preference
          setSquareCoversState(preferences.squareCovers ?? DEFAULT_PREFERENCES.squareCovers);
          // Sync hideAvailable preference
          setHideAvailableState(preferences.hideAvailable ?? DEFAULT_PREFERENCES.hideAvailable);
        } catch (error) {
          console.error('Failed to parse preferences from storage event:', error);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  return (
    <PreferencesContext.Provider value={{ cardSize, setCardSize, squareCovers, setSquareCovers, hideAvailable, setHideAvailable }}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (context === undefined) {
    throw new Error('usePreferences must be used within a PreferencesProvider');
  }
  return context;
}
