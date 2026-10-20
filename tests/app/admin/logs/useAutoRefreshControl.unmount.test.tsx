/**
 * Component: useAutoRefreshControl Hook Tests - timers and unmount
 * Documentation: documentation/admin-dashboard.md
 */

// @vitest-environment jsdom

import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AutoRefreshControlProvider,
  useAutoRefreshControl,
  useRegisterPauseReason,
} from '@/app/admin/logs/hooks/useAutoRefreshControl';

function PauseWhile({ active }: { active: boolean }) {
  useRegisterPauseReason('Filter open', active);
  return null;
}

function Status() {
  const { isPaused, pauseReasons } = useAutoRefreshControl();
  return <div data-testid="status">{isPaused ? `paused: ${pauseReasons.join(',')}` : 'running'}</div>;
}

describe('useAutoRefreshControl timers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces leaving the paused state by 250 ms', () => {
    const { rerender } = render(
      <AutoRefreshControlProvider>
        <PauseWhile active />
        <Status />
      </AutoRefreshControlProvider>
    );
    expect(screen.getByTestId('status')).toHaveTextContent('paused: Filter open');

    rerender(
      <AutoRefreshControlProvider>
        <PauseWhile active={false} />
        <Status />
      </AutoRefreshControlProvider>
    );
    expect(screen.getByTestId('status')).toHaveTextContent('paused: Filter open');

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.getByTestId('status')).toHaveTextContent('running');
  });

  it('leaves no timer behind when the page unmounts with a pause reason registered', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = render(
      <AutoRefreshControlProvider>
        <PauseWhile active />
        <Status />
      </AutoRefreshControlProvider>
    );

    unmount();

    // The child's unmount cleanup unregisters its reason; nothing may be scheduled after teardown
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('cancels a pending debounce when unmounted mid-timer', () => {
    const { rerender, unmount } = render(
      <AutoRefreshControlProvider>
        <PauseWhile active />
      </AutoRefreshControlProvider>
    );
    rerender(
      <AutoRefreshControlProvider>
        <PauseWhile active={false} />
      </AutoRefreshControlProvider>
    );
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
