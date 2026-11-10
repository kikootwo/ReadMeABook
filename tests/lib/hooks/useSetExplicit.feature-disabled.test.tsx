/**
 * Component: useSetExplicit after the setting was turned off elsewhere (#542)
 * Documentation: documentation/features/explicit-flag.md
 *
 * A page loaded while the Explicit mark was on keeps its controls until the providers answer is
 * fetched again. When a set call gets 403 FeatureDisabled, the hook revalidates that answer, so the
 * controls on that page disappear; any other refusal leaves it alone. Real: both hooks and SWR (its
 * default cache, as in the app: the hook revalidates through the global mutate).
 */

// @vitest-environment jsdom

import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { useExplicitMarkEnabled, useSetExplicit } = await import('@/lib/hooks/useExplicitMark');

const state = vi.hoisted(() => ({ explicitMarkEnabled: true, put: { status: 403, body: {} as unknown } }));
const fetchMock = vi.fn(async (url: string) => {
  if (url === '/api/auth/providers') {
    return { ok: true, status: 200, json: async () => ({ backendMode: 'audiobookshelf', explicitMarkEnabled: state.explicitMarkEnabled }) };
  }
  return { ok: state.put.status < 300, status: state.put.status, json: async () => state.put.body };
});
const providerCalls = () => fetchMock.mock.calls.filter(([url]) => url === '/api/auth/providers').length;

const wrapper = ({ children }: { children: React.ReactNode }) => <SWRConfig value={{ dedupingInterval: 0 }}>{children}</SWRConfig>;
const mount = () => renderHook(() => ({ on: useExplicitMarkEnabled(), ...useSetExplicit() }), { wrapper }).result;

beforeEach(() => {
  state.explicitMarkEnabled = true;
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.unstubAllGlobals());

describe('useSetExplicit and the providers answer', () => {
  it('a 403 FeatureDisabled answer revalidates it: the controls on this page disappear', async () => {
    const hook = mount();
    await waitFor(() => expect(hook.current.on).toBe(true));
    expect(providerCalls()).toBe(1);

    state.explicitMarkEnabled = false; // turned off in Settings by another admin
    state.put = { status: 403, body: { error: 'FeatureDisabled', message: 'The Explicit mark is turned off in Settings' } };
    let thrown: unknown;
    await act(async () => { await hook.current.setExplicit('req-1', true).catch((e) => { thrown = e; }); });

    expect((thrown as Error).message).toBe('The Explicit mark is turned off in Settings');
    await waitFor(() => expect(hook.current.on).toBe(false));
    expect(providerCalls()).toBe(2);
  });

  it('another refusal (403 Forbidden) leaves it alone', async () => {
    const hook = mount();
    await waitFor(() => expect(hook.current.on).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    const before = providerCalls();

    state.put = { status: 403, body: { error: 'Forbidden', message: 'Only an admin can remove the explicit mark' } };
    await act(async () => { await hook.current.setExplicit('req-1', false).catch(() => {}); });
    await new Promise((r) => setTimeout(r, 20));

    expect(providerCalls()).toBe(before);
    expect(hook.current.on).toBe(true);
  });
});
