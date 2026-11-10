/**
 * Component: Library detail request history (GET /api/requests/[id], admin or requester only)
 * Documentation: documentation/features/library-view.md
 *
 * Fetched only when the list said the viewer may see the request (canSeeRequestDetails); other
 * viewers make no call. Polls every 5 s only while the book is in the latest live response (a failed
 * poll is retried quietly meanwhile). Returns a whitelist: the owner payload's fileFormat,
 * ebookAutoRetryCount, type, parentRequestId and audiobook file data never leave this hook.
 *
 * `stale`: the open book is on no loaded page and not live, so nothing else follows it. Each time
 * it turns true the history is fetched again under a new key; `current` is that fetch (or a later
 * one), never an older copy, so the detail can take the request's status and error from it.
 */

'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { STATUS_GROUP_OF } from '@/lib/library-view/constants';
import type { LibraryItem } from '@/lib/library-view/types';
import { fetchWithAuth } from '@/lib/utils/api';

export const DETAIL_POLL_MS = 5000;

export interface RequestHistoryJob {
  id: string;
  type: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
}

export interface RequestHistory {
  /** The request's own status and error (both already in the list item for this viewer). */
  status: string | null;
  errorMessage: string | null;
  customSearchTerms: string | null;
  requestedAt: string | null;
  completedAt: string | null;
  download: {
    indexerName: string | null;
    releaseName: string | null;
    client: string | null;
    startedAt: string | null;
    completedAt: string | null;
  } | null;
  jobs: RequestHistoryJob[];
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** The only request fields the Library detail shows. */
export function pickRequestHistory(request: Record<string, unknown> | null | undefined): RequestHistory | null {
  if (!request) return null;
  const downloads = Array.isArray(request.downloadHistory) ? (request.downloadHistory as Record<string, unknown>[]) : [];
  const d = downloads[0];
  const jobs = Array.isArray(request.jobs) ? (request.jobs as Record<string, unknown>[]) : [];
  return {
    status: str(request.status),
    errorMessage: str(request.errorMessage),
    customSearchTerms: str(request.customSearchTerms),
    requestedAt: str(request.createdAt),
    completedAt: str(request.completedAt),
    download: d
      ? {
          indexerName: str(d.indexerName),
          releaseName: str(d.torrentName),
          client: str(d.downloadClient),
          startedAt: str(d.startedAt),
          completedAt: str(d.completedAt),
        }
      : null,
    jobs: jobs
      .filter((j) => str(j.id) && str(j.type))
      .map((j) => ({
        id: j.id as string,
        type: j.type as string,
        status: str(j.status) ?? '',
        createdAt: str(j.createdAt) ?? '',
        completedAt: str(j.completedAt),
      })),
  };
}

/**
 * The open book with the request's own status and error (the detail's copy while it is stale). An
 * in-library book keeps the list's word; an unknown status changes nothing.
 */
export function withRequestStatus(item: LibraryItem, history: RequestHistory | null): LibraryItem {
  if (!history?.status || item.inLibrary || !item.request) return item;
  const statusGroup = STATUS_GROUP_OF[history.status];
  if (!statusGroup) return item;
  if (history.status === item.status && (item.request.errorMessage ?? null) === history.errorMessage) return item;
  return {
    ...item,
    status: history.status,
    statusGroup,
    progress: statusGroup === 'on_the_way' && history.status === item.status ? item.progress : null,
    request: { ...item.request, errorMessage: history.errorMessage },
  };
}

type HistoryKey = readonly [string, string, number];

/** Its own SWR key: `/api/requests/<id>` belongs to useRequest, which caches the raw payload. */
const historyKey = (requestId: string, epoch: number): HistoryKey => ['library-request-history', requestId, epoch];

async function fetchHistory([, requestId, epoch]: HistoryKey): Promise<{ requestId: string; epoch: number; history: RequestHistory | null }> {
  const res = await fetchWithAuth(`/api/requests/${requestId}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message || `HTTP ${res.status}`);
  return { requestId, epoch, history: pickRequestHistory(body?.request) };
}

/** `requestId` null (no request, or the viewer may not see it): no call. */
export function useLibraryRequestDetail(requestId: string | null, live: boolean, stale = false) {
  const [epoch, setEpoch] = useState(0);
  const [wasStale, setWasStale] = useState(stale);
  if (stale !== wasStale) {
    // derived state, set while rendering: a new key each time the book goes stale
    setWasStale(stale);
    if (stale) setEpoch((e) => e + 1);
  }
  const { data, error, isLoading, mutate } = useSWR(requestId ? historyKey(requestId, epoch) : null, fetchHistory, {
    refreshInterval: live ? DETAIL_POLL_MS : 0,
    revalidateOnFocus: false,
    keepPreviousData: true,
    shouldRetryOnError: live,
    onErrorRetry: (_error, _key, _config, revalidate, { retryCount }) => {
      setTimeout(() => revalidate({ retryCount }), DETAIL_POLL_MS);
    },
  });
  // keepPreviousData also keeps another book's copy while this one loads: never show it
  const own = data !== undefined && data.requestId === requestId;
  return {
    history: own ? data.history : null,
    /** The history fetched since the book went stale (null otherwise). */
    current: stale && own && data.epoch === epoch ? data.history : null,
    error: error ?? null,
    isLoading: isLoading || (!!requestId && !own && !error),
    loaded: own,
    mutate,
  };
}
