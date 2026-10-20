/**
 * Component: Authentication Context Tests - unmount
 * Documentation: documentation/backend/services/auth.md
 */

// @vitest-environment jsdom

import React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/contexts/AuthContext';

const isTokenExpiredMock = vi.hoisted(() => vi.fn());
const getRefreshTimeMsMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/utils/jwt-client', () => ({
  isTokenExpired: isTokenExpiredMock,
  getRefreshTimeMs: getRefreshTimeMsMock,
}));

describe('AuthProvider unmount', () => {
  beforeEach(() => {
    localStorage.clear();
    isTokenExpiredMock.mockImplementation((token: string) => token.startsWith('expired'));
    getRefreshTimeMsMock.mockReturnValue(300_000);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not arm a refresh timer when a refresh resolves after unmount', async () => {
    localStorage.setItem('accessToken', 'expired-access');
    localStorage.setItem('refreshToken', 'refresh-token');
    localStorage.setItem('user', JSON.stringify({ id: 'user-1' }));
    let resolveRefresh!: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { resolveRefresh = resolve; })));

    const { unmount } = render(<AuthProvider><div /></AuthProvider>);
    unmount();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    await act(async () => {
      resolveRefresh({ ok: true, json: async () => ({ accessToken: 'new-access' }) });
    });

    // The refresh timer is the one armed for getRefreshTimeMs (300 000 ms)
    expect(setTimeoutSpy.mock.calls.some((call) => call[1] === 300_000)).toBe(false);
  });
});
