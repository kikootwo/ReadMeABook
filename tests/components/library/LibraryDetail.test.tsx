/**
 * Component: Library detail and actions (gating, owner-payload canaries, endpoints, revalidation)
 * Documentation: documentation/features/library-view.md
 */

// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui/Toast';
import type { LibraryItem } from '@/lib/library-view/types';
import { ADMIN_VIEWER, USER_VIEWER, item, scanItem } from './fixtures';

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/utils/api', () => ({ fetchWithAuth: (url: string, init?: RequestInit) => fetchMock(url, init) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ accessToken: 'token', user: null }) }));
vi.mock('next/image', () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ fill, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean }) => <img alt={alt ?? ''} data-fill={fill ? 'true' : undefined} {...props} />,
}));
type ModalProps = { requestId: string; audiobook: { title: string; author: string }; customSearchTerms: string | null; onSuccess: () => void };
const modalProps = vi.hoisted(() => ({ current: null as null | ModalProps }));
vi.mock('@/components/requests/InteractiveTorrentSearchModal', () => ({
  InteractiveTorrentSearchModal: (props: ModalProps) => {
    modalProps.current = props;
    return <div role="dialog" aria-label="Interactive search" />;
  },
}));

import { LibraryDetail } from '@/components/library/LibraryDetail';

const ok = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

/** The owner payload of GET /api/requests/[id], with fields the detail must never show. */
const OWNER_PAYLOAD = {
  success: true,
  request: {
    id: 'request-1',
    createdAt: '2026-11-01T10:00:00.000Z',
    completedAt: null,
    customSearchTerms: 'dune herbert unabridged',
    type: 'audiobook-canary-type',
    parentRequestId: 'parent-canary',
    ebookAutoRetryCount: 987654,
    audiobook: { fileFormat: 'epub', filePath: '/media/canary/path', title: 'Dune' },
    downloadHistory: [{ indexerName: 'IndexerOne', torrentName: 'Dune.2019.m4b', downloadClient: 'qbittorrent', startedAt: '2026-11-01T11:00:00.000Z', completedAt: null }],
    jobs: [{ id: 'j1', type: 'search_indexers', status: 'completed', createdAt: '2026-11-01T10:01:00.000Z', completedAt: null }],
  },
};

let changed: ReturnType<typeof vi.fn>;

function renderDetail(it: LibraryItem, viewer = ADMIN_VIEWER as { isAdmin: boolean; canFetchEbook?: boolean }, opts: { live?: boolean; user?: object } = {}) {
  changed = vi.fn();
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>
        <LibraryDetail item={it} viewer={viewer} user={opts.user ?? null} live={opts.live ?? false} onClose={vi.fn()} onChanged={changed} />
      </ToastProvider>
    </SWRConfig>
  );
}

const gated = (overrides: Partial<LibraryItem> = {}, mine = false) =>
  item({
    canSeeRequestDetails: true,
    request: { ...item().request!, isMine: mine, errorMessage: 'No release found', downloadSizeBytes: '1288490188', completedAt: null },
    ...overrides,
  });

const detailCalls = () => fetchMock.mock.calls.filter((c) => c[0] === '/api/requests/request-1').length;

beforeEach(() => {
  fetchMock.mockReset();
  modalProps.current = null;
  fetchMock.mockImplementation(async (url: string) => (url === '/api/requests/request-1' ? ok(OWNER_PAYLOAD) : ok({ success: true })));
});

describe('LibraryDetail: what each viewer sees', () => {
  it('admin: error, size, path, history; owner-payload canaries never render', async () => {
    renderDetail(gated({ path: '/media/audiobooks/Frank Herbert/Dune' }));
    expect(screen.getByRole('dialog', { name: 'Dune' })).toBeInTheDocument();
    expect(screen.getByText('No release found')).toBeInTheDocument();
    expect(screen.getByText('1.2 GB')).toBeInTheDocument();
    expect(screen.getByText('/media/audiobooks/Frank Herbert/Dune')).toBeInTheDocument();
    await screen.findByText('Found on IndexerOne');
    expect(screen.getByText('Dune.2019.m4b')).toBeInTheDocument();
    expect(screen.getByText('Search Indexers')).toBeInTheDocument();
    const html = document.body.innerHTML;
    for (const canary of ['epub', '/media/canary/path', '987654', 'audiobook-canary-type', 'parent-canary', 'Format']) {
      expect(html).not.toContain(canary);
    }
  });

  it('the path row comes only from item.path: a dash when null, absent without the key', () => {
    const { unmount } = renderDetail(gated({ path: null }));
    expect(screen.getByText('Path').nextElementSibling?.textContent).toBe('—');
    unmount();
    renderDetail(gated(), { isAdmin: false }, {});
    expect(screen.queryByText('Path')).toBeNull();
  });

  it('another user: public fields only, no sections, no actions and no request detail call', async () => {
    renderDetail(item({ canSeeRequestDetails: false }), USER_VIEWER);
    expect(screen.getByText('Frank Herbert')).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();
    for (const title of ['Files', 'Request history', 'Actions']) expect(screen.queryByText(title)).toBeNull();
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a requester sees their own error and history, "You", Interactive search but no Search again or path', async () => {
    renderDetail(gated({}, true), USER_VIEWER);
    expect(screen.getByText('No release found')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
    await screen.findByText('Found on IndexerOne');
    expect(screen.queryByRole('button', { name: 'Search again' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Interactive search' })).toBeEnabled();
    expect(screen.getByRole('link', { name: 'View request' })).toHaveAttribute('href', '/requests');
    expect(screen.queryByText('Path')).toBeNull();
  });

  it('a scan-only book has no actions', () => {
    renderDetail(scanItem({ path: null }));
    expect(screen.queryByText('Actions')).toBeNull();
  });

  it('polls the history only while the book is live', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { rerender } = renderDetail(gated(), ADMIN_VIEWER, { live: false });
      await waitFor(() => expect(detailCalls()).toBe(1));
      await act(async () => vi.advanceTimersByTime(11_000));
      expect(detailCalls()).toBe(1);
      rerender(
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <ToastProvider>
            <LibraryDetail item={gated()} viewer={ADMIN_VIEWER} user={null} live onClose={vi.fn()} onChanged={changed} />
          </ToastProvider>
        </SWRConfig>
      );
      await act(async () => vi.advanceTimersByTime(11_000));
      expect(detailCalls()).toBeGreaterThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('LibraryActions', () => {
  it('Search again calls manual-search, toasts, and revalidates', async () => {
    renderDetail(gated());
    fireEvent.click(screen.getByRole('button', { name: 'Search again' }));
    await screen.findByText('Searching again for Dune');
    expect(fetchMock).toHaveBeenCalledWith('/api/requests/request-1/manual-search', { method: 'POST' });
    expect(changed).toHaveBeenCalled();
  });

  it('a refused action shows the route message as an error toast', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/manual-search') ? ok({ message: 'Request is not in a searchable state' }, 400) : ok(OWNER_PAYLOAD)
    );
    renderDetail(gated());
    fireEvent.click(screen.getByRole('button', { name: 'Search again' }));
    await screen.findByText('Request is not in a searchable state');
  });

  it('Fetch ebook posts to the request route; success:false is a warning; a 4xx error body is an error', async () => {
    const lib = gated({ status: 'available', statusGroup: 'available', inLibrary: true });
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/fetch-ebook') ? ok({ success: false, message: 'No ebook found' }) : ok(OWNER_PAYLOAD)
    );
    const { unmount } = renderDetail(lib);
    fireEvent.click(screen.getByRole('button', { name: 'Fetch ebook' }));
    await screen.findByText('Ebook fetch failed: No ebook found');
    expect(fetchMock.mock.calls.find((c) => c[0] === '/api/requests/request-1/fetch-ebook')?.[1]).toMatchObject({ method: 'POST' });
    expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith('/api/audiobooks/'))).toBe(false);
    expect(changed).toHaveBeenCalled();
    unmount();

    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/fetch-ebook') ? ok({ error: 'Ebook sources are off' }, 400) : ok(OWNER_PAYLOAD)
    );
    renderDetail(lib);
    fireEvent.click(screen.getByRole('button', { name: 'Fetch ebook' }));
    await screen.findByText('Failed to fetch the ebook: Ebook sources are off');
  });

  it('Interactive search waits for the request detail, then passes customSearchTerms; success revalidates', async () => {
    let release!: () => void;
    fetchMock.mockImplementation(
      (url: string) =>
        new Promise((resolve) => {
          release = () => resolve(ok(url === '/api/requests/request-1' ? OWNER_PAYLOAD : { success: true }));
        })
    );
    renderDetail(gated());
    const button = screen.getByRole('button', { name: 'Interactive search' });
    expect(button).toBeDisabled();
    await act(async () => release());
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(modalProps.current).toMatchObject({
      requestId: 'request-1',
      audiobook: { title: 'Dune', author: 'Frank Herbert' },
      customSearchTerms: 'dune herbert unabridged',
    });
    await act(async () => modalProps.current!.onSuccess());
    expect(changed).toHaveBeenCalled();
    await screen.findByText('Download started for Dune');
  });
});
