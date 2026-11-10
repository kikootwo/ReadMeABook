/**
 * Component: Library detail action predicate (full viewer x status matrix)
 * Documentation: documentation/features/library-view.md
 */

import { describe, expect, it } from 'vitest';
import { hasAnyAction, libraryActions } from '@/components/library/library-actions';
import { ADMIN_VIEWER, USER_VIEWER, item, scanItem } from './fixtures';

const STATUSES = [
  'pending', 'awaiting_search', 'searching', 'downloading', 'processing', 'downloaded', 'awaiting_import',
  'awaiting_approval', 'awaiting_release', 'failed', 'warn', 'denied', 'available',
];
const SEARCHABLE = ['pending', 'failed', 'awaiting_search', 'awaiting_release'];
const INTERACTIVE = ['pending', 'failed', 'awaiting_search', 'awaiting_release'];
const EBOOK = ['downloaded', 'available'];

type Viewer = 'admin' | 'requester' | 'other';

function setup(viewer: Viewer, status: string, opts: { canFetchEbook?: boolean; interactive?: boolean } = {}) {
  const isAdmin = viewer === 'admin';
  const base = item({ status });
  const it = {
    ...base,
    request: { ...base.request!, isMine: viewer === 'requester' },
    canSeeRequestDetails: viewer !== 'other',
  };
  const v = isAdmin ? { isAdmin: true, canFetchEbook: opts.canFetchEbook ?? true } : USER_VIEWER;
  const user = opts.interactive === undefined ? {} : { permissions: { interactiveSearch: opts.interactive } };
  return libraryActions(it, v, user);
}

describe('libraryActions', () => {
  for (const status of STATUSES) {
    it(`admin on ${status}`, () => {
      const a = setup('admin', status);
      expect(a.searchAgain).toBe(SEARCHABLE.includes(status));
      expect(a.interactiveSearch).toBe(INTERACTIVE.includes(status));
      expect(a.fetchEbook).toBe(EBOOK.includes(status));
      expect(a.viewRequestHref).toBe('/admin?search=Dune&type=audiobook');
    });

    it(`requester on own ${status}: never Search again or Fetch ebook`, () => {
      const a = setup('requester', status);
      expect(a.searchAgain).toBe(false);
      expect(a.fetchEbook).toBe(false);
      expect(a.interactiveSearch).toBe(INTERACTIVE.includes(status));
      expect(a.viewRequestHref).toBe('/requests');
    });

    it(`other user on ${status}: nothing`, () => {
      const a = setup('other', status);
      expect(a).toEqual({ searchAgain: false, interactiveSearch: false, fetchEbook: false, viewRequestHref: null });
      expect(hasAnyAction(a)).toBe(false);
    });
  }

  it('Fetch ebook needs canFetchEbook', () => {
    expect(setup('admin', 'available', { canFetchEbook: false }).fetchEbook).toBe(false);
    expect(setup('admin', 'available', { canFetchEbook: true }).fetchEbook).toBe(true);
  });

  it('a requester with interactive search turned off gets no Interactive search; an admin always does', () => {
    expect(setup('requester', 'failed', { interactive: false }).interactiveSearch).toBe(false);
    expect(setup('requester', 'failed', { interactive: true }).interactiveSearch).toBe(true);
    expect(setup('admin', 'failed', { interactive: false }).interactiveSearch).toBe(true);
  });

  it('a scan-only book has no actions for anyone', () => {
    for (const viewer of [ADMIN_VIEWER, USER_VIEWER]) {
      expect(hasAnyAction(libraryActions(scanItem(), viewer, {}))).toBe(false);
    }
  });

  it('an in-library book gets only Fetch ebook and View request', () => {
    const lib = { ...item({ status: 'available', inLibrary: true }), canSeeRequestDetails: true };
    expect(libraryActions(lib, ADMIN_VIEWER, {})).toEqual({
      searchAgain: false,
      interactiveSearch: false,
      fetchEbook: true,
      viewRequestHref: '/admin?search=Dune&type=audiobook',
    });
  });

  it('encodes the title in the admin link', () => {
    const odd = { ...item({ title: 'A & B / C?#' }), canSeeRequestDetails: true };
    expect(libraryActions(odd, ADMIN_VIEWER, {}).viewRequestHref).toBe('/admin?search=A%20%26%20B%20%2F%20C%3F%23&type=audiobook');
  });
});
