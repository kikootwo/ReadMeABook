/**
 * Component: Setup Initializing Page Tests
 * Documentation: documentation/setup-wizard.md
 */

// @vitest-environment jsdom

import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetMockRouter, routerMock } from '../../helpers/mock-next-navigation';

describe('InitializingPage', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
    window.location.hash = '';
    resetMockRouter();
  });

  it('redirects to login when auth data is missing', async () => {
    window.location.hash = '';
    const { default: InitializingPage } = await import('@/app/setup/initializing/page');

    render(<InitializingPage />);

    await waitFor(() => {
      expect(routerMock.push).toHaveBeenCalledWith(
        '/login?error=Authentication%20data%20missing'
      );
    });
  });

  it('processes auth data and completes job monitoring', async () => {
    vi.useFakeTimers();
    const authData = {
      accessToken: 'token-123',
      refreshToken: 'refresh-123',
      user: { id: 'user-1', username: 'admin' },
    };
    window.location.hash = `#authData=${encodeURIComponent(JSON.stringify(authData))}`;

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/admin/jobs') {
        return {
          ok: true,
          json: async () => ({
            jobs: [
              { id: 'job-1', type: 'audible_refresh', lastRunJobId: 'run-1' },
              { id: 'job-2', type: 'plex_library_scan', lastRunJobId: 'run-2' },
            ],
          }),
        };
      }
      if (url === '/api/admin/job-status/run-1' || url === '/api/admin/job-status/run-2') {
        return { ok: true, json: async () => ({ job: { status: 'completed' } }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { default: InitializingPage } = await import('@/app/setup/initializing/page');

    render(<InitializingPage />);

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(localStorage.getItem('accessToken')).toBe('token-123');
    expect(window.location.hash).toBe('');

    const completedMessages = screen.getAllByText('Completed successfully');
    expect(completedMessages.length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Go to Homepage' })).toBeEnabled();
  });

  it('marks jobs as error when no recent job is found', async () => {
    vi.useFakeTimers();
    const authData = {
      accessToken: 'token-123',
      refreshToken: 'refresh-123',
      user: { id: 'user-1', username: 'admin' },
    };
    window.location.hash = `#authData=${encodeURIComponent(JSON.stringify(authData))}`;

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/admin/jobs') {
        return {
          ok: true,
          json: async () => ({
            jobs: [
              { id: 'job-1', type: 'audible_refresh' },
              { id: 'job-2', type: 'plex_library_scan' },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { default: InitializingPage } = await import('@/app/setup/initializing/page');

    render(<InitializingPage />);

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(screen.getAllByText(/Job did not start/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Go to Homepage' })).toBeEnabled();
  });

  it('redirects when auth data fails to parse', async () => {
    window.location.hash = '#authData=';
    const errorMock = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { default: InitializingPage } = await import('@/app/setup/initializing/page');

    render(<InitializingPage />);

    await waitFor(() => {
      expect(routerMock.push).toHaveBeenCalledWith(
        '/login?error=Failed%20to%20process%20authentication'
      );
    });
    expect(errorMock).toHaveBeenCalledWith(
      '[Initializing] Failed to process auth data:',
      expect.any(Error)
    );
  });

  it('marks jobs as error when scheduled jobs fetch fails', async () => {
    vi.useFakeTimers();
    const authData = {
      accessToken: 'token-123',
      refreshToken: 'refresh-123',
      user: { id: 'user-1', username: 'admin' },
    };
    window.location.hash = `#authData=${encodeURIComponent(JSON.stringify(authData))}`;

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/admin/jobs') {
        return { ok: false, json: async () => ({}) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { default: InitializingPage } = await import('@/app/setup/initializing/page');

    render(<InitializingPage />);

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(screen.getAllByText(/Failed to fetch job configuration/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Go to Homepage' })).toBeEnabled();
  });

  it('marks jobs as failed when job status returns failed', async () => {
    vi.useFakeTimers();
    const authData = {
      accessToken: 'token-123',
      refreshToken: 'refresh-123',
      user: { id: 'user-1', username: 'admin' },
    };
    window.location.hash = `#authData=${encodeURIComponent(JSON.stringify(authData))}`;

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/admin/jobs') {
        return {
          ok: true,
          json: async () => ({
            jobs: [
              { id: 'job-1', type: 'audible_refresh', lastRunJobId: 'run-1' },
              { id: 'job-2', type: 'plex_library_scan', lastRunJobId: 'run-2' },
            ],
          }),
        };
      }
      if (url === '/api/admin/job-status/run-1' || url === '/api/admin/job-status/run-2') {
        return { ok: true, json: async () => ({ job: { status: 'failed' } }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { default: InitializingPage } = await import('@/app/setup/initializing/page');

    render(<InitializingPage />);

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(screen.getAllByText(/Job failed to complete/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Go to Homepage' })).toBeEnabled();
  });
});
