/**
 * Component: Library detail actions (pure): which buttons the detail shows for this viewer
 * Documentation: documentation/features/library-view.md
 *
 * Built only from what GET /api/library returned (viewer.isAdmin, canFetchEbook, request.isMine,
 * canSeeRequestDetails) and the server-resolved interactive search permission. A hint for the UI:
 * every action's endpoint runs its own check.
 */

import {
  ADVANCEABLE_FROM_INTERACTIVE_SEARCH,
  EBOOK_FETCHABLE_STATUSES,
  SEARCHABLE_STATUSES,
} from '@/lib/constants/request-statuses';
import type { LibraryItem, LibraryResponse } from '@/lib/library-view/types';

export interface LibraryActionSet {
  searchAgain: boolean;
  interactiveSearch: boolean;
  fetchEbook: boolean;
  viewRequestHref: string | null;
}

export interface ActionUser {
  permissions?: { interactiveSearch?: boolean };
}

const NONE: LibraryActionSet = { searchAgain: false, interactiveSearch: false, fetchEbook: false, viewRequestHref: null };

const has = (set: readonly string[], status: string) => set.includes(status);

export function libraryActions(
  item: Pick<LibraryItem, 'status' | 'title' | 'request' | 'canSeeRequestDetails'>,
  viewer: LibraryResponse['viewer'],
  user: ActionUser | null | undefined
): LibraryActionSet {
  const request = item.request;
  if (!request) return NONE; // a scan-only book: nothing to act on
  const isAdmin = viewer.isAdmin;
  const mayInteractive = isAdmin || user?.permissions?.interactiveSearch !== false;
  return {
    searchAgain: isAdmin && has(SEARCHABLE_STATUSES, item.status),
    interactiveSearch:
      (isAdmin || request.isMine) && has(ADVANCEABLE_FROM_INTERACTIVE_SEARCH, item.status) && mayInteractive,
    fetchEbook: isAdmin && viewer.canFetchEbook === true && has(EBOOK_FETCHABLE_STATUSES, item.status),
    viewRequestHref: item.canSeeRequestDetails
      ? isAdmin
        ? `/admin?search=${encodeURIComponent(item.title)}&type=audiobook`
        : '/requests'
      : null,
  };
}

export function hasAnyAction(actions: LibraryActionSet): boolean {
  return actions.searchAgain || actions.interactiveSearch || actions.fetchEbook || actions.viewRequestHref !== null;
}
