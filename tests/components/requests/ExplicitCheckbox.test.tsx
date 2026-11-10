/**
 * Component: Explicit checkbox and its placements (#542)
 * Documentation: documentation/features/explicit-flag.md
 *
 * A non-admin's tick asks first with one sentence; once checked, a non-admin sees it disabled with
 * the reason as visible text (not only a tooltip); admins toggle without a confirm. My Requests
 * shows it on audiobook requests in Audiobookshelf mode only, never on a denied request, and saves
 * through the mark route with the server's message as a toast.
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ isABS: true, role: 'user' }));
const setExplicitMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({ warning: vi.fn(), error: vi.fn(), success: vi.fn() }));

vi.mock('@/lib/hooks/useExplicitMark', () => ({
  useIsAudiobookshelf: () => state.isABS,
  useSetExplicit: () => ({ setExplicit: setExplicitMock, isLoading: false }),
}));
vi.mock('@/components/ui/Toast', () => ({ useToast: () => toastMock }));
vi.mock('@/lib/hooks/useRequests', () => ({ useCancelRequest: () => ({ cancelRequest: vi.fn(), isLoading: false }) }));
vi.mock('@/components/audiobooks/AudiobookDetailsModal', () => ({ AudiobookDetailsModal: () => null }));
vi.mock('next/image', () => ({ __esModule: true, default: (props: Record<string, unknown>) => <img alt="" {...props} /> }));
vi.mock('@/contexts/PreferencesContext', () => ({ usePreferences: () => ({ squareCovers: false }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1', role: state.role } }) }));

const { ExplicitCheckbox, EXPLICIT_CONFIRM_MESSAGE, EXPLICIT_LOCKED_REASON } = await import('@/components/requests/ExplicitCheckbox');
const { RequestCard } = await import('@/components/requests/RequestCard');

const box = () => screen.getByRole('checkbox', { name: /Explicit/ });

beforeEach(() => {
  vi.clearAllMocks();
  state.isABS = true;
  state.role = 'user';
  setExplicitMock.mockResolvedValue({ explicit: true });
});

describe('ExplicitCheckbox', () => {
  it("a non-admin's tick asks first, in one sentence; Cancel changes nothing", () => {
    const onChange = vi.fn();
    render(<ExplicitCheckbox checked={false} onChange={onChange} isAdmin={false} />);

    fireEvent.click(box());

    expect(screen.getByText(EXPLICIT_CONFIRM_MESSAGE)).toBeInTheDocument();
    expect(EXPLICIT_CONFIRM_MESSAGE.split(/[.!?](\s|$)/).filter((s) => s && s.trim()).length).toBe(1);
    expect(EXPLICIT_CONFIRM_MESSAGE).toContain('Audiobookshelf');
    expect(EXPLICIT_CONFIRM_MESSAGE).toContain('only an admin can remove');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('confirming marks it', () => {
    const onChange = vi.fn();
    render(<ExplicitCheckbox checked={false} onChange={onChange} isAdmin={false} />);

    fireEvent.click(box());
    fireEvent.click(screen.getByRole('button', { name: 'Mark explicit' }));

    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('checked for a non-admin: disabled, with the reason as visible text tied to the box', () => {
    render(<ExplicitCheckbox checked={true} onChange={vi.fn()} isAdmin={false} />);

    const reason = screen.getByText(EXPLICIT_LOCKED_REASON);
    expect(box()).toBeDisabled();
    expect(box()).toBeChecked();
    expect(reason).toBeVisible();
    expect(box().getAttribute('aria-describedby')).toBe(reason.id);
    expect(box().closest('label')?.getAttribute('title')).toBeNull();
  });

  it('an admin toggles both ways without a confirm', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ExplicitCheckbox checked={false} onChange={onChange} isAdmin={true} />);

    fireEvent.click(box());
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(screen.queryByText(EXPLICIT_CONFIRM_MESSAGE)).toBeNull();

    rerender(<ExplicitCheckbox checked={true} onChange={onChange} isAdmin={true} />);
    expect(box()).not.toBeDisabled();
    fireEvent.click(box());
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByText(EXPLICIT_LOCKED_REASON)).toBeNull();
  });

  it('has a 44px touch target', () => {
    render(<ExplicitCheckbox checked={false} onChange={vi.fn()} isAdmin={false} />);

    expect(box().closest('label')?.className).toContain('min-h-[44px]');
  });
});

describe('RequestCard Explicit control', () => {
  const request = (over: Record<string, unknown> = {}) => ({
    id: 'req-1', status: 'available', progress: 100, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    audiobook: { id: 'b1', title: 'Book', author: 'Author' }, ...over,
  });

  it('shown on an audiobook request in Audiobookshelf mode', () => {
    render(<RequestCard request={request()} />);

    expect(box()).toBeInTheDocument();
  });

  it.each([
    ['Plex mode (or still loading)', () => { state.isABS = false; }, {}],
    ['a denied request', () => {}, { status: 'denied' }],
    ['an ebook request', () => {}, { type: 'ebook' }],
  ])('hidden for %s', (_label, arrange, over) => {
    arrange();
    render(<RequestCard request={request(over)} />);

    expect(screen.queryByRole('checkbox', { name: /Explicit/ })).toBeNull();
  });

  it.each(['failed', 'cancelled', 'warn', 'pending'])('shown on a %s request (the mark carries over on re-request)', (status) => {
    render(<RequestCard request={request({ status })} />);

    expect(box()).toBeInTheDocument();
  });

  it('hidden on read-only cards (showActions false)', () => {
    render(<RequestCard request={request()} showActions={false} />);

    expect(screen.queryByRole('checkbox', { name: /Explicit/ })).toBeNull();
  });

  it('a marked request: checked and disabled for its requester', () => {
    render(<RequestCard request={request({ explicit: true })} />);

    expect(box()).toBeChecked();
    expect(box()).toBeDisabled();
    expect(screen.getByText(EXPLICIT_LOCKED_REASON)).toBeVisible();
  });

  it('confirming saves through the mark route; a server message becomes a toast', async () => {
    setExplicitMock.mockResolvedValue({ explicit: true, message: "Saved. Audiobookshelf wasn't updated: x." });
    render(<RequestCard request={request()} />);

    fireEvent.click(box());
    fireEvent.click(screen.getByRole('button', { name: 'Mark explicit' }));

    await waitFor(() => expect(setExplicitMock).toHaveBeenCalledWith('req-1', true));
    await waitFor(() => expect(toastMock.warning).toHaveBeenCalledWith("Saved. Audiobookshelf wasn't updated: x.", 10000));
    expect(box()).toBeChecked();
  });

  it('a failed save puts the box back and says why', async () => {
    setExplicitMock.mockRejectedValue(new Error('Only an admin can remove the explicit mark'));
    state.role = 'admin';
    render(<RequestCard request={request({ explicit: true })} />);

    fireEvent.click(box());

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Only an admin can remove the explicit mark'));
    expect(box()).toBeChecked();
  });
});
