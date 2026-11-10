/**
 * Component: Library detail request history (GET /api/requests/[id], admin or requester only)
 * Documentation: documentation/features/library-view.md
 *
 * Fetched only when the list said the viewer may see the request (canSeeRequestDetails); other
 * viewers make no call. Polls every 5 s only while the book is in the latest live response. Returns
 * a whitelist: the owner payload's fileFormat, ebookAutoRetryCount, type, parentRequestId and
 * audiobook file data never leave this hook.
 */

'use client';

import useSWR from 'swr';
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

async function fetchHistory(url: string): Promise<RequestHistory | null> {
  const res = await fetchWithAuth(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message || `HTTP ${res.status}`);
  return pickRequestHistory(body?.request);
}

/** `requestId` null (no request, or the viewer may not see it): no call. */
export function useLibraryRequestDetail(requestId: string | null, live: boolean) {
  const { data, error, isLoading, mutate } = useSWR(requestId ? `/api/requests/${requestId}` : null, fetchHistory, {
    refreshInterval: live ? DETAIL_POLL_MS : 0,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  return { history: data ?? null, error: error ?? null, isLoading, loaded: data !== undefined, mutate };
}
