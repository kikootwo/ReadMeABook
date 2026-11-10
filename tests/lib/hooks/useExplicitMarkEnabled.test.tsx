/**
 * Component: useExplicitMarkEnabled and the My Requests card (#542)
 * Documentation: documentation/features/explicit-flag.md
 *
 * The real hook over a faked public /api/auth/providers: true only for Audiobookshelf mode with the
 * setting on; false while loading (no control flashes before the answer), on error, in Plex mode
 * and with the setting off or absent. One request however many cards render. Real: the hook, SWR,
 * RequestCard, ExplicitCheckbox.
 */

// @vitest-environment jsdom

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ warning: vi.fn(), error: vi.fn(), success: vi.fn() }) }));
vi.mock('@/lib/hooks/useRequests', () => ({ useCancelRequest: () => ({ cancelRequest: vi.fn(), isLoading: false }) }));
vi.mock('@/components/audiobooks/AudiobookDetailsModal', () => ({ AudiobookDetailsModal: () => null }));
vi.mock('next/image', () => ({ __esModule: true, default: () => null }));
vi.mock('@/contexts/PreferencesContext', () => ({ usePreferences: () => ({ squareCovers: false }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1', role: 'user' } }) }));

const { useExplicitMarkEnabled } = await import('@/lib/hooks/useExplicitMark');
const { RequestCard } = await import('@/components/requests/RequestCard');

const fetchMock = vi.fn();
const respond = (body: unknown, ok = true) => fetchMock.mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => body });

const Probe = () => <div data-testid="flag">{String(useExplicitMarkEnabled())}</div>;
const fresh = (children: React.ReactNode) => render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>);

const request = (id: string) => ({
  id, status: 'available', progress: 100, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  audiobook: { id: `b-${id}`, title: `Book ${id}`, author: 'Author' },
});

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('useExplicitMarkEnabled', () => {
  it.each([
    ['Audiobookshelf, setting on', { backendMode: 'audiobookshelf', explicitMarkEnabled: true }, 'true'],
    ['Audiobookshelf, setting off', { backendMode: 'audiobookshelf', explicitMarkEnabled: false }, 'false'],
    ['Audiobookshelf, flag absent', { backendMode: 'audiobookshelf' }, 'false'],
    ['Plex, flag true', { backendMode: 'plex', explicitMarkEnabled: true }, 'false'],
  ])('%s → %s', async (_label, body, expected) => {
    respond(body);
    fresh(<Probe />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/providers'));
    await waitFor(() => expect(screen.getByTestId('flag').textContent).toBe(expected));
  });

  it('false while loading and on an error', async () => {
    let fail: (reason: Error) => void = () => {};
    fetchMock.mockReturnValue(new Promise((_resolve, reject) => { fail = reject; }));
    fresh(<Probe />);

    expect(screen.getByTestId('flag').textContent).toBe('false');
    fail(new Error('offline'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByTestId('flag').textContent).toBe('false');
  });
});

describe('My Requests cards and the setting', () => {
  it('on: each card shows the Explicit box, from one providers request', async () => {
    respond({ backendMode: 'audiobookshelf', explicitMarkEnabled: true });
    fresh(<>{['r1', 'r2', 'r3'].map((id) => <RequestCard key={id} request={request(id)} />)}</>);

    await waitFor(() => expect(screen.getAllByRole('checkbox', { name: /Explicit/ })).toHaveLength(3));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('off: no box and not the word, before or after the answer arrives', async () => {
    respond({ backendMode: 'audiobookshelf', explicitMarkEnabled: false });
    fresh(<RequestCard request={request('r1')} />);

    expect(screen.queryByRole('checkbox', { name: /Explicit/ })).toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('checkbox', { name: /Explicit/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(/explicit/i);
  });
});
