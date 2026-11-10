/**
 * Component: Preferences Context Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { PreferencesProvider, usePreferences } from '@/contexts/PreferencesContext';

const TestConsumer = () => {
  const { cardSize, setCardSize } = usePreferences();

  return (
    <div>
      <span data-testid="size">{cardSize}</span>
      <button type="button" onClick={() => setCardSize(12)}>
        Set Large
      </button>
    </div>
  );
};

describe('PreferencesContext', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('loads card size from localStorage when valid', async () => {
    localStorage.setItem('preferences', JSON.stringify({ cardSize: 7 }));

    render(
      <PreferencesProvider>
        <TestConsumer />
      </PreferencesProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('size')).toHaveTextContent('7');
    });
  });

  it('clamps card size updates and persists them', async () => {
    render(
      <PreferencesProvider>
        <TestConsumer />
      </PreferencesProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Set Large' }));

    await waitFor(() => {
      expect(screen.getByTestId('size')).toHaveTextContent('9');
    });

    const stored = JSON.parse(localStorage.getItem('preferences') || '{}');
    expect(stored.cardSize).toBe(9);
  });

  it('updates card size when a storage event is received', async () => {
    render(
      <PreferencesProvider>
        <TestConsumer />
      </PreferencesProvider>
    );

    await act(async () => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'preferences',
          newValue: JSON.stringify({ cardSize: 3 }),
        })
      );
    });

    expect(screen.getByTestId('size')).toHaveTextContent('3');
  });

  it('reports hydrated only after the stored preferences are read', async () => {
    localStorage.setItem('preferences', JSON.stringify({ hideAvailable: true }));
    const seen: [boolean, boolean][] = [];
    const Probe = () => {
      const { hydrated, hideAvailable } = usePreferences();
      seen.push([hydrated, hideAvailable]);
      return <span data-testid="hydrated">{String(hydrated)}</span>;
    };
    render(
      <PreferencesProvider>
        <Probe />
      </PreferencesProvider>
    );
    await waitFor(() => expect(screen.getByTestId('hydrated')).toHaveTextContent('true'));
    // Never hydrated with the default value: a fetch keyed on hideAvailable waits for the stored one
    expect(seen[0]).toEqual([false, false]);
    expect(seen.filter(([h]) => h).every(([, hide]) => hide)).toBe(true);
  });
});
