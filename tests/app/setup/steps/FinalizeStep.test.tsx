/**
 * Component: Finalize Step Tests
 * Documentation: documentation/setup-wizard.md
 */

// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('FinalizeStep', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('shows OIDC-only instructions and completes setup', async () => {
    const onComplete = vi.fn();
    const onBack = vi.fn();
    const { FinalizeStep } = await import('@/app/setup/steps/FinalizeStep');

    render(
      <FinalizeStep hasAdminTokens={false} onComplete={onComplete} onBack={onBack} />
    );

    expect(screen.getByText('Setup Complete!')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish Setup' }));

    expect(onBack).toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalled();
  });

  it('marks jobs as error when no access token is available', async () => {
    const onComplete = vi.fn();
    const onBack = vi.fn();
    const { FinalizeStep } = await import('@/app/setup/steps/FinalizeStep');

    render(
      <FinalizeStep hasAdminTokens={true} onComplete={onComplete} onBack={onBack} />
    );

    await waitFor(() => {
      expect(screen.getAllByText(/Authentication required/).length).toBeGreaterThan(0);
    });
  });

  it('runs initial jobs and enables completion on success', async () => {
    vi.useFakeTimers();
    localStorage.setItem('accessToken', 'token');

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
      if (url === '/api/admin/jobs/job-1/trigger') {
        return { ok: true, json: async () => ({ jobId: 'run-1' }) };
      }
      if (url === '/api/admin/jobs/job-2/trigger') {
        return { ok: true, json: async () => ({ jobId: 'run-2' }) };
      }
      if (url === '/api/admin/job-status/run-1' || url === '/api/admin/job-status/run-2') {
        return { ok: true, json: async () => ({ job: { status: 'completed' } }) };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const onComplete = vi.fn();
    const onBack = vi.fn();
    const { FinalizeStep } = await import('@/app/setup/steps/FinalizeStep');

    render(
      <FinalizeStep hasAdminTokens={true} onComplete={onComplete} onBack={onBack} />
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(screen.getAllByText('Completed successfully').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Finish Setup' })).toBeEnabled();
  });

  it('marks missing job configuration as an error', async () => {
    vi.useFakeTimers();
    localStorage.setItem('accessToken', 'token');

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/admin/jobs') {
        return {
          ok: true,
          json: async () => ({
            jobs: [
              { id: 'job-1', type: 'audible_refresh' },
            ],
          }),
        };
      }
      if (url === '/api/admin/jobs/job-1/trigger') {
        return { ok: true, json: async () => ({ jobId: 'run-1' }) };
      }
      if (url === '/api/admin/job-status/run-1') {
        return { ok: true, json: async () => ({ job: { status: 'completed' } }) };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { FinalizeStep } = await import('@/app/setup/steps/FinalizeStep');

    render(
      <FinalizeStep hasAdminTokens={true} onComplete={vi.fn()} onBack={vi.fn()} />
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(screen.getAllByText(/Job configuration not found/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Finish Setup' })).toBeEnabled();
  });
});
