/**
 * Component: Library page view (states, admin-only controls, groups, chips, detail snapshot)
 * Documentation: documentation/features/library-view.md
 */

// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMockRouter, routerMock, setMockPathname, setMockSearchParams } from '../../helpers/mock-next-navigation';
import { PreferencesProvider } from '@/contexts/PreferencesContext';
import { ToastProvider } from '@/components/ui/Toast';
import type { LibraryResponse } from '@/lib/library-view/types';
import { item, response, scanItem } from './fixtures';

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/utils/api', () => ({ fetchWithAuth: (url: string, init?: RequestInit) => fetchMock(url, init) }));
const auth = vi.hoisted(() => ({ user: { id: 'admin-1', role: 'admin', username: 'admin' } as Record<string, unknown> | null }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ accessToken: 'token', user: auth.user }) }));
vi.mock('next/image', () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ fill, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean }) => <img alt={alt ?? ''} data-fill={fill ? 'true' : undefined} {...props} />,
}));
vi.mock('@/components/requests/InteractiveTorrentSearchModal', () => ({ InteractiveTorrentSearchModal: () => null }));

import { LibraryView } from '@/components/library/LibraryView';

const ok = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
const BASE = '/api/library?limit=60';
const ADMIN = { viewer: { isAdmin: true, canFetchEbook: false } };

let pages: Record<string, unknown>;
let live: { items: unknown[]; refreshMs: number };
/** GET /api/requests/request-1 (the detail's history): the request's own status and error. */
let requestDetail: () => ReturnType<typeof ok>;

function serve() {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes('live=1')) return ok(live);
    if (url === '/api/requests/request-1') return requestDetail();
    if (url.startsWith('/api/requests/')) return ok({ success: true, request: { id: 'request-1' } });
    if (url === '/api/admin/jobs') return ok({ jobs: [{ id: 'job-9', type: 'plex_library_scan' }] });
    if (url.startsWith('/api/admin/jobs/')) return ok({ success: true });
    const page = pages[url];
    if (page instanceof Function) return page();
    return ok(page ?? response([]));
  });
}

function renderView() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <PreferencesProvider>
        <ToastProvider>
          <LibraryView />
        </ToastProvider>
      </PreferencesProvider>
    </SWRConfig>
  );
}

const withStats = (r: LibraryResponse, total: number): LibraryResponse => ({ ...r, stats: { ...r.stats, total } });

beforeEach(() => {
  fetchMock.mockReset();
  resetMockRouter();
  setMockPathname('/library');
  localStorage.clear();
  auth.user = { id: 'admin-1', role: 'admin', username: 'admin' };
  pages = {};
  live = { items: [], refreshMs: 0 };
  requestDetail = () => ok({ success: true, request: { id: 'request-1' } });
  serve();
});

describe('LibraryView states', () => {
  it('empty library: Find a book, and Scan library now for an admin (the scheduled job)', async () => {
    pages[BASE] = response([], ADMIN);
    renderView();
    await screen.findByText('Nothing here yet');
    expect(screen.getByRole('link', { name: 'Find a book' })).toHaveAttribute('href', '/search');
    // Nothing to filter or sort: no rail, toolbar or Filters button around the empty state
    expect(screen.queryByRole('complementary', { name: 'Filters' })).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Group by' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Scan library now' }));
    // Says only what happened: the page does not reload by itself when the scan ends
    expect(await screen.findByText('Library scan started.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/jobs/job-9/trigger', { method: 'POST' });
  });

  it('empty library for a non-admin: no scan button, no not-configured notice', async () => {
    pages[BASE] = response([], { libraryConfigured: false });
    renderView();
    await screen.findByText('Nothing here yet');
    expect(screen.queryByRole('button', { name: 'Scan library now' })).toBeNull();
    expect(screen.queryByText(/No library is selected/)).toBeNull();
  });

  it('not configured: the notice is admin-only and links the library settings', async () => {
    pages[BASE] = response([item()], { ...ADMIN, libraryConfigured: false });
    renderView();
    await screen.findByRole('link', { name: 'Choose a library in Settings' });
    expect(screen.getByRole('link', { name: 'Choose a library in Settings' })).toHaveAttribute('href', '/admin/settings?tab=library');
  });

  it('hide available on a fully available library is "no matches", not "empty"', async () => {
    localStorage.setItem('preferences', JSON.stringify({ hideAvailable: true }));
    pages['/api/library?hideAvailable=true&limit=60'] = withStats(response([], { matched: 0 }), 12);
    renderView();
    await screen.findByText('No books match');
    // The first load already carried hideAvailable: no call with the default
    expect(fetchMock.mock.calls.some((c) => c[0] === BASE)).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Clear search and filters' }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === BASE)).toBe(true));
    expect(JSON.parse(localStorage.getItem('preferences')!).hideAvailable).toBe(false);
  });

  it('a failed first load shows the error with Retry', async () => {
    pages[BASE] = () => ok({ error: 'Forbidden', message: 'nope' }, 403);
    renderView();
    await screen.findByText("Couldn't load the library");
    pages[BASE] = response([item()]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('button', { name: /Dune by Frank Herbert/ });
  });

  it('shows the Live pill while live polling runs', async () => {
    pages[BASE] = response([item({ id: 'req_a', status: 'downloading', statusGroup: 'on_the_way', progress: 30 })]);
    live = { items: [{ id: 'req_a', status: 'downloading', progress: 30, updatedAt: '' }], refreshMs: 5000 };
    renderView();
    await screen.findByText('Live');
  });
});

describe('LibraryView grid, chips and query', () => {
  it('an author split across pages gets one header', async () => {
    const authorKey = 'frank herbert';
    const group = [{ key: authorKey, label: 'Frank Herbert', count: 2 }];
    const grouped = '/api/library?group=author&limit=60';
    pages[grouped] = { ...response([item({ id: 'req_1', title: 'Dune' })], { groups: group }), nextCursor: 'c1' };
    pages[`${grouped}&cursor=c1`] = response([item({ id: 'req_2', title: 'Dune Messiah' })], { groups: group });
    setMockSearchParams('group=author');
    renderView();
    await screen.findByRole('button', { name: /^Dune by/ });
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByRole('button', { name: /^Dune Messiah by/ });
    expect(screen.getAllByRole('heading', { name: /Frank Herbert/ })).toHaveLength(1);
    expect(screen.getByText('· 2 books')).toBeInTheDocument();
    // Grouped: the sort select reads Author A to Z and is disabled
    const sort = screen.getByRole('combobox');
    expect(sort).toBeDisabled();
    expect((sort as HTMLSelectElement).value).toBe('author');
  });

  it('Clear all clears search, filters and Hide available', async () => {
    localStorage.setItem('preferences', JSON.stringify({ hideAvailable: true }));
    setMockSearchParams('q=dune&status=problem');
    pages['/api/library?q=dune&status=problem&hideAvailable=true&limit=60'] = response([item()]);
    renderView();
    const chips = await screen.findByLabelText('Active filters');
    expect(within(chips).getByText('Search: dune')).toBeInTheDocument();
    expect(within(chips).getByText('Problem')).toBeInTheDocument();
    expect(within(chips).getByText('Hiding available')).toBeInTheDocument();
    fireEvent.click(within(chips).getByRole('button', { name: 'Clear all' }));
    await waitFor(() => expect(screen.queryByLabelText('Active filters')).toBeNull());
    expect(JSON.parse(localStorage.getItem('preferences')!).hideAvailable).toBe(false);
    expect(routerMock.replace).toHaveBeenLastCalledWith('/library', { scroll: false });
  });

  it('drops requester ids the server does not know from the query and the URL', async () => {
    const known = '0b6c7b1e-3c55-4f4e-9d1b-2f1f6f0f5a11';
    const unknown = '9f9f9f9f-3c55-4f4e-9d1b-2f1f6f0f5a11';
    setMockSearchParams(`requestedBy=${known},${unknown}`);
    const facets = { ...response([]).facets, requestedBy: [{ userId: known, username: 'alice', count: 1 }] };
    pages[`/api/library?requestedBy=${encodeURIComponent(`${known},${unknown}`)}&limit=60`] = response([item()], { facets });
    pages[`/api/library?requestedBy=${known}&limit=60`] = response([item()], { facets });
    renderView();
    await waitFor(() => expect(routerMock.replace).toHaveBeenLastCalledWith(`/library?requestedBy=${known}`, { scroll: false }));
    expect(await screen.findByText('Requested by alice')).toBeInTheDocument();
  });

  it('the rail and the sheet list the same facets', async () => {
    pages[BASE] = response([item()], {
      facets: { ...response([]).facets, requestedBy: [{ userId: 'u1', username: 'alice', count: 1 }, { userId: 'u2', username: 'bob', count: 2, deleted: true }] },
    });
    renderView();
    await screen.findByRole('button', { name: /Dune by/ });
    const railText = screen.getByRole('complementary', { name: 'Filters' }).textContent;
    fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    const sheet = screen.getByRole('dialog', { name: 'Filters' });
    expect(railText).toContain('bob (deleted)');
    expect(sheet.textContent).toContain(railText!);
  });
});

describe('LibraryView detail snapshot', () => {
  it('stays open when an action moves its book out of the current filter', async () => {
    setMockSearchParams('status=problem');
    const key = '/api/library?status=problem&limit=60';
    const failed = item({ id: 'req_a', status: 'failed', statusGroup: 'problem', canSeeRequestDetails: true, request: { ...item().request!, errorMessage: 'x' } });
    pages[key] = response([failed], ADMIN);
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: /Dune by Frank Herbert/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Dune' });
    pages[key] = withStats(response([], { ...ADMIN, matched: 0 }), 1); // after Search again the book is pending
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Search again' }));
    });
    await screen.findByText('Searching again for Dune');
    await screen.findByText('No books match');
    expect(screen.getByRole('dialog', { name: 'Dune' })).toBeInTheDocument();
  });

  it('follows its book off the pages: live status without the old error, then the request itself, never an older status', async () => {
    setMockSearchParams('status=problem');
    const key = '/api/library?status=problem&limit=60';
    const failed = item({ id: 'req_a', status: 'failed', statusGroup: 'problem', canSeeRequestDetails: true, request: { ...item().request!, errorMessage: 'No release matched' } });
    pages[key] = response([failed], ADMIN);
    requestDetail = () => ok({ success: true, request: { id: 'request-1', status: 'failed', errorMessage: 'No release matched' } });
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: /Dune by Frank Herbert/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Dune' });
    expect(within(dialog).getByText('No release matched')).toBeInTheDocument();

    // Search again: the route clears the error and the book is pending (live), off the Problem filter
    pages[key] = withStats(response([], { ...ADMIN, matched: 0 }), 1);
    live = { items: [{ id: 'req_a', status: 'pending', progress: 0, updatedAt: '' }], refreshMs: 40 };
    requestDetail = () => ok({ success: true, request: { id: 'request-1', status: 'pending', errorMessage: null } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Search again' }));
    });
    await screen.findByText('No books match');
    await waitFor(() => expect(within(dialog).getByText('Pending')).toBeInTheDocument());
    expect(within(dialog).queryByText('No release matched')).toBeNull(); // never the old error under a new badge

    // It downloads, then leaves live: the history fetch fails, so the last status seen stays (not "Failed")
    live = { items: [{ id: 'req_a', status: 'downloading', progress: 40, updatedAt: '' }], refreshMs: 40 };
    await waitFor(() => expect(within(dialog).getByText('Downloading')).toBeInTheDocument());
    requestDetail = () => ok({ message: 'Bad gateway' }, 502);
    live = { items: [], refreshMs: 40 };
    await waitFor(() => expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/requests/request-1').length).toBeGreaterThanOrEqual(3));
    await new Promise((r) => setTimeout(r, 100));
    expect(within(dialog).getByText('Downloading')).toBeInTheDocument();
    expect(within(dialog).queryByText('Failed')).toBeNull();

    // In live once more, then out with the request answering: its own status and error now
    live = { items: [{ id: 'req_a', status: 'searching', progress: 0, updatedAt: '' }], refreshMs: 40 };
    await waitFor(() => expect(within(dialog).getByText('Searching...')).toBeInTheDocument());
    requestDetail = () => ok({ success: true, request: { id: 'request-1', status: 'failed', errorMessage: 'Still nothing on the indexers' } });
    live = { items: [], refreshMs: 40 };
    await waitFor(() => expect(within(dialog).getByText('Still nothing on the indexers')).toBeInTheDocument());
    expect(within(dialog).getByText('Failed')).toBeInTheDocument();
    expect(within(dialog).queryByText('No release matched')).toBeNull();
  });

  it('a scan-only book opens with no actions', async () => {
    pages[BASE] = response([scanItem()], ADMIN);
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: /Hyperion by Dan Simmons/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Hyperion' });
    expect(within(dialog).queryByText('Actions')).toBeNull();
  });
});
