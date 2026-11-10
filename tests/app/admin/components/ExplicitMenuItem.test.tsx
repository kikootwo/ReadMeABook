/**
 * Component: Admin request menu, Mark explicit / Remove explicit mark (#542)
 * Documentation: documentation/features/explicit-flag.md
 *
 * Audiobookshelf mode and audiobook requests only; the label follows the mark; "Mark explicit" is
 * hidden on a denied request; the server's message is a toast.
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const setExplicitMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({ warning: vi.fn(), error: vi.fn(), success: vi.fn() }));

vi.mock('@/lib/hooks/useExplicitMark', () => ({ useSetExplicit: () => ({ setExplicit: setExplicitMock, isLoading: false }) }));
vi.mock('@/components/ui/Toast', () => ({ useToast: () => toastMock }));
vi.mock('@/hooks/useSmartDropdownPosition', () => ({
  useSmartDropdownPosition: () => ({ containerRef: { current: null }, dropdownRef: { current: null }, positionAbove: false, style: { position: 'fixed', top: 0, left: 0 } }),
}));
vi.mock('@/components/requests/InteractiveTorrentSearchModal', () => ({ InteractiveTorrentSearchModal: () => null }));
vi.mock('@/app/admin/components/AdjustSearchTermsModal', () => ({ AdjustSearchTermsModal: () => null }));

const { RequestActionsDropdown } = await import('@/app/admin/components/RequestActionsDropdown');

function openMenu(request: Record<string, unknown>, showExplicit = true) {
  render(
    <RequestActionsDropdown
      request={{ requestId: 'req-1', title: 'Book', author: 'A', status: 'available', ...request }}
      onManualSearch={vi.fn()}
      onCancel={vi.fn()}
      onDelete={vi.fn()}
      showExplicit={showExplicit}
    />
  );
  fireEvent.click(screen.getByTitle('Actions'));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ExplicitMenuItem in the admin request menu', () => {
  it('unmarked: "Mark explicit" sets it', async () => {
    setExplicitMock.mockResolvedValue({ explicit: true });
    openMenu({ explicit: false });

    fireEvent.click(screen.getByRole('menuitem', { name: 'Mark explicit' }));

    await waitFor(() => expect(setExplicitMock).toHaveBeenCalledWith('req-1', true));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Marked explicit'));
  });

  it('marked: "Remove explicit mark" clears it; the server message is a warning toast', async () => {
    const message = 'Mark removed. Audiobookshelf still marks this book explicit; change it there.';
    setExplicitMock.mockResolvedValue({ explicit: false, message });
    openMenu({ explicit: true });

    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove explicit mark' }));

    await waitFor(() => expect(setExplicitMock).toHaveBeenCalledWith('req-1', false));
    await waitFor(() => expect(toastMock.warning).toHaveBeenCalledWith(message, 10000));
  });

  it('a failure is an error toast', async () => {
    setExplicitMock.mockRejectedValue(new Error('Failed to update the explicit mark'));
    openMenu({ explicit: false });

    fireEvent.click(screen.getByRole('menuitem', { name: 'Mark explicit' }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Failed to update the explicit mark'));
  });

  it.each([
    ['Plex mode', { explicit: true }, false],
    ['an ebook request', { explicit: true, type: 'ebook' }, true],
  ])('no item for %s', (_label, request, showExplicit) => {
    openMenu(request, showExplicit);

    expect(screen.queryByRole('menuitem', { name: /explicit/i })).toBeNull();
  });

  it('a denied request: no "Mark explicit", but a mark can still be removed', () => {
    openMenu({ status: 'denied', explicit: false });
    expect(screen.queryByRole('menuitem', { name: /explicit/i })).toBeNull();
  });

  it('a denied, marked request offers "Remove explicit mark"', () => {
    openMenu({ status: 'denied', explicit: true });
    expect(screen.getByRole('menuitem', { name: 'Remove explicit mark' })).toBeInTheDocument();
  });
});
