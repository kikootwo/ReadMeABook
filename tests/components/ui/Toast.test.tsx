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

  it('gives every toast type a solid dark background so the page does not show through', () => {
    const types = ['success', 'error', 'warning', 'info'] as const;
    const AllTypes = () => {
      const toast = useToast();
      return (
        <button type="button" onClick={() => types.forEach((t) => toast[t](`msg-${t}`, 0))}>
          Add All
        </button>
      );
    };

    render(
      <ToastProvider>
        <AllTypes />
      </ToastProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add All' }));

    for (const type of types) {
      const toastEl = screen.getByText(`msg-${type}`).parentElement as HTMLElement;
      const darkBgs = toastEl.className.split(/\s+/).filter((c) => c.startsWith('dark:bg-'));
      expect(darkBgs, type).toHaveLength(1);
      expect(darkBgs[0], type).not.toMatch(/\//);
    }
  });
});
