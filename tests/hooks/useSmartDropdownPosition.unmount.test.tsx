/**
 * Component: useSmartDropdownPosition Hook Tests - unmount
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSmartDropdownPosition } from '@/hooks/useSmartDropdownPosition';

describe('useSmartDropdownPosition', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('drops a pending debounced recalculation when unmounted', () => {
    const { unmount } = renderHook(() => useSmartDropdownPosition(true));
    vi.runOnlyPendingTimers(); // the initial requestAnimationFrame measurement

    window.dispatchEvent(new Event('resize'));
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
