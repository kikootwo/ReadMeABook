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
});
