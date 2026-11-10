/**
 * Component: Library detail with the real Interactive search modal (the page behind never scrolls)
 * Documentation: documentation/features/library-view.md
 *
 * No stand-in: the real modal locks the body in its own effect, and the detail learns it is open one
 * commit later (LibraryActions reports it through an effect). The lock must hold all along.
 */

// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui/Toast';
import { USER_VIEWER, item } from './fixtures';

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/utils/api', () => ({ fetchWithAuth: (url: string, init?: RequestInit) => fetchMock(url, init) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ accessToken: 'token', user: null }) }));
vi.mock('next/image', () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ fill, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean }) => <img alt={alt ?? ''} data-fill={fill ? 'true' : undefined} {...props} />,
}));

import { LibraryDetail } from '@/components/library/LibraryDetail';

const ok = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
const mine = item({
  canSeeRequestDetails: true,
  request: { ...item().request!, isMine: true, errorMessage: 'No release found' },
});

beforeEach(() => {
  fetchMock.mockReset();
  document.body.style.overflow = '';
  fetchMock.mockImplementation(async (url: string) =>
    url === '/api/requests/request-1'
      ? ok({ success: true, request: { id: 'request-1', customSearchTerms: null, jobs: [] } })
      : ok({ success: true, results: [] })
  );
});

describe('LibraryDetail + InteractiveTorrentSearchModal', () => {
  it('the body stays locked while Interactive search is open, after it closes, and unlocks with the detail', async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ToastProvider>
          <LibraryDetail item={mine} viewer={USER_VIEWER} user={null} live={false} onClose={onClose} onChanged={vi.fn()} />
        </ToastProvider>
      </SWRConfig>
    );
    expect(document.body.style.overflow).toBe('hidden');
    const detail = screen.getByRole('dialog', { name: 'Dune' });
    const button = within(detail).getByRole('button', { name: 'Interactive search' });
    await waitFor(() => expect(button).toBeEnabled());

    await act(async () => {
      fireEvent.click(button);
    });
    await screen.findByRole('button', { name: 'Close' }); // the real modal's own close button
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    expect(document.body.style.overflow).toBe('hidden');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Close' })).toBeNull());
    expect(document.body.style.overflow).toBe('hidden'); // the modal's cleanup cleared it; set again

    rerender(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ToastProvider>
          <LibraryDetail item={null} viewer={USER_VIEWER} user={null} live={false} onClose={onClose} onChanged={vi.fn()} />
        </ToastProvider>
      </SWRConfig>
    );
    expect(document.body.style.overflow).toBe('');
  });
});
