/**
 * Component: Ebook Settings Hook Tests
 * Documentation: documentation/settings-pages.md
 */

// @vitest-environment jsdom

import React from 'react';
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchWithAuthMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/utils/api', () => ({
  fetchWithAuth: fetchWithAuthMock,
}));

const renderHook = <T,>(hook: () => T) => {
  const result = { current: undefined as T };
  function Probe() {
    result.current = hook();
    return null;
  }
  render(<Probe />);
  return result;
};

const baseEbook = {
  enabled: true,
  preferredFormat: 'epub',
  baseUrl: 'https://annas-archive.gl',
  flaresolverrUrl: 'http://flare',
};

describe('useEbookSettings', () => {
  const onChange = vi.fn();
  const onSuccess = vi.fn();
  const onError = vi.fn();
  const markAsSaved = vi.fn();

  beforeEach(() => {
    fetchWithAuthMock.mockReset();
    onChange.mockReset();
    onSuccess.mockReset();
    onError.mockReset();
    markAsSaved.mockReset();
    vi.useRealTimers();
  });

  it('updates ebook settings and clears flaresolverr test results when URL changes', async () => {
    const { useEbookSettings } = await import('@/app/admin/settings/tabs/EbookTab/useEbookSettings');
    const result = renderHook(() =>
      useEbookSettings({ ebook: baseEbook, onChange, onSuccess, onError, markAsSaved })
    );

    act(() => {
      result.current.updateEbook('flaresolverrUrl', 'http://new');
    });

    expect(onChange).toHaveBeenCalledWith({ ...baseEbook, flaresolverrUrl: 'http://new' });
    expect(result.current.flaresolverrTestResult).toBeNull();
  });

  it('returns an error when testing FlareSolverr without a URL', async () => {
    const { useEbookSettings } = await import('@/app/admin/settings/tabs/EbookTab/useEbookSettings');
    const result = renderHook(() =>
      useEbookSettings({ ebook: { ...baseEbook, flaresolverrUrl: '' }, onChange, onSuccess, onError, markAsSaved })
    );

    await act(async () => {
      await result.current.testFlaresolverrConnection();
    });

    expect(result.current.flaresolverrTestResult?.success).toBe(false);
    expect(result.current.flaresolverrTestResult?.message).toContain('Please enter a FlareSolverr URL');
  });

  it('tests FlareSolverr connection successfully and sends baseUrl', async () => {
    fetchWithAuthMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, message: 'OK' }),
    });

    const { useEbookSettings } = await import('@/app/admin/settings/tabs/EbookTab/useEbookSettings');
    const result = renderHook(() =>
      useEbookSettings({ ebook: baseEbook, onChange, onSuccess, onError, markAsSaved })
    );

    await act(async () => {
      await result.current.testFlaresolverrConnection();
    });

    expect(result.current.flaresolverrTestResult?.success).toBe(true);
    // Verify baseUrl is included in the request body
    const callBody = JSON.parse(fetchWithAuthMock.mock.calls[0][1].body);
    expect(callBody.baseUrl).toBe('https://annas-archive.gl');
    expect(callBody.url).toBe('http://flare');
  });

  it('handles FlareSolverr test failures', async () => {
    fetchWithAuthMock.mockRejectedValueOnce(new Error('flare down'));

    const { useEbookSettings } = await import('@/app/admin/settings/tabs/EbookTab/useEbookSettings');
    const result = renderHook(() =>
      useEbookSettings({ ebook: baseEbook, onChange, onSuccess, onError, markAsSaved })
    );

    await act(async () => {
      await result.current.testFlaresolverrConnection();
    });

    expect(result.current.flaresolverrTestResult?.message).toBe('flare down');
  });

  it('saves ebook settings and clears success banner after delay', async () => {
    vi.useFakeTimers();
    fetchWithAuthMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const { useEbookSettings } = await import('@/app/admin/settings/tabs/EbookTab/useEbookSettings');
    const result = renderHook(() =>
      useEbookSettings({ ebook: baseEbook, onChange, onSuccess, onError, markAsSaved })
    );

    await act(async () => {
      await result.current.saveSettings();
    });

    expect(onSuccess).toHaveBeenCalledWith('E-book sidecar settings saved successfully!');
    expect(markAsSaved).toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(onSuccess).toHaveBeenCalledWith('');
    vi.useRealTimers();
  });

  it('surfaces save errors', async () => {
    fetchWithAuthMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });

    const { useEbookSettings } = await import('@/app/admin/settings/tabs/EbookTab/useEbookSettings');
    const result = renderHook(() =>
      useEbookSettings({ ebook: baseEbook, onChange, onSuccess, onError, markAsSaved })
    );

    await act(async () => {
      await result.current.saveSettings();
    });

    expect(onError).toHaveBeenCalledWith('Failed to save e-book settings');
  });
});
