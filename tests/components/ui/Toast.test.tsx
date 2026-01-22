/**
 * Component: Toast Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from '@/components/ui/Toast';

const ToastHarness = () => {
  const { success, error } = useToast();

  return (
    <div>
      <button type="button" onClick={() => success('Saved', 1000)}>
        Add Success
      </button>
      <button type="button" onClick={() => error('Failed', 0)}>
        Add Error
      </button>
    </div>
  );
};

describe('ToastProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds and auto-removes toasts after the duration', async () => {
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add Success' }));
    expect(screen.getByText('Saved')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('removes a toast when the close button is clicked', () => {
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add Error' }));
    expect(screen.getByText('Failed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('Failed')).toBeNull();
  });
});
