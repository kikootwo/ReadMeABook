/**
 * Component: Authentication Context Tests - StrictMode and unmount
 * Documentation: documentation/backend/services/auth.md
 */

// @vitest-environment jsdom

import React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';

const isTokenExpiredMock = vi.hoisted(() => vi.fn());
const getRefreshTimeMsMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/utils/jwt-client', () => ({
  isTokenExpired: isTokenExpiredMock,
  getRefreshTimeMs: getRefreshTimeMsMock,
}));

const refreshCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([url]) => url === '/api/auth/refresh').length;

describe('AuthProvider timers', () => {
  let locationStub: { href: string; pathname: string };

  beforeEach(() => {
    localStorage.clear();
    isTokenExpiredMock.mockImplementation((token: string) => token.startsWith('expired'));
    getRefreshTimeMsMock.mockReturnValue(300_000);
    locationStub = { href: 'http://localhost/', pathname: '/' };
    vi.stubGlobal('location', locationStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('schedules and fires the token refresh under StrictMode', async () => {
    vi.useFakeTimers();
    localStorage.setItem('accessToken', 'access-token');
    localStorage.setItem('refreshToken', 'refresh-token');
    localStorage.setItem('user', JSON.stringify({ id: 'user-1' }));
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (url === '/api/auth/refresh' ? { accessToken: 'next-token' } : {}),
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(<React.StrictMode><AuthProvider><div /></AuthProvider></React.StrictMode>);
    expect(refreshCalls(fetchMock)).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000);
    });

    expect(refreshCalls(fetchMock)).toBe(1);
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

  it('does not log out or redirect when a refresh fails after unmount', async () => {
    localStorage.setItem('accessToken', 'expired-access');
    localStorage.setItem('refreshToken', 'refresh-token');
    localStorage.setItem('user', JSON.stringify({ id: 'user-1' }));
    let resolveRefresh!: (value: unknown) => void;
    const fetchMock = vi.fn((url: string) =>
      url === '/api/auth/refresh' ? new Promise((resolve) => { resolveRefresh = resolve; }) : Promise.resolve({ ok: true })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { unmount } = render(<AuthProvider><div /></AuthProvider>);
    unmount();
    await act(async () => {
      resolveRefresh({ ok: false, json: async () => ({}) });
    });

    expect(locationStub.href).toBe('http://localhost/');
    expect(fetchMock).not.toHaveBeenCalledWith('/api/auth/logout', expect.anything());
  });

  it('stops polling the login callback after unmount', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ({ ok: false, status: 202, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);
    let login!: (pinId: number) => Promise<unknown>;
    function Capture() {
      login = useAuth().login;
      return null;
    }

    const { unmount } = render(<AuthProvider><Capture /></AuthProvider>);
    let outcome: unknown;
    const pending = login(42).catch((error: Error) => { outcome = error.message; });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const callsBeforeUnmount = fetchMock.mock.calls.length;

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await pending;

    expect(fetchMock.mock.calls.length).toBe(callsBeforeUnmount);
    expect(outcome).toBe('Login cancelled');
    expect(vi.getTimerCount()).toBe(0);
  });
});
