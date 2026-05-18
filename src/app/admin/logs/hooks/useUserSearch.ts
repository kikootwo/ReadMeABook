/**
 * Component: useUserSearch Hook (admin logs user typeahead)
 * Documentation: documentation/admin-dashboard.md
 *
 * Fetch-once-and-cache user directory from /api/admin/users for the user
 * typeahead in LogsFilters. SWR caches the response for the session so every
 * keystroke filters in-memory — no per-keystroke network round-trip.
 *
 * Assumes installs have <500 users (Zach Resolution #3 — fine for self-hosted).
 */

'use client';

import { useCallback, useMemo } from 'react';
import useSWR from 'swr';
import { authenticatedFetcher } from '@/lib/utils/api';

const USERS_URL = '/api/admin/users';
const MAX_SUGGESTIONS = 10;
// One-time-per-session cache: dedupe identical fetches for an hour.
const DEDUPING_INTERVAL_MS = 60 * 60 * 1000;

export interface UserSearchUser {
  id: string;
  plexUsername: string;
  role: string;
}

interface UsersApiResponse {
  users: UserSearchUser[];
}

export interface UseUserSearchResult {
  users: UserSearchUser[];
  filterByQuery: (q: string) => UserSearchUser[];
  /** Resolve a user by id — handy for chip label rendering. */
  findUserById: (id: string | null | undefined) => UserSearchUser | undefined;
  isLoading: boolean;
  error: Error | null;
}

export function useUserSearch(): UseUserSearchResult {
  const { data, error, isLoading } = useSWR<UsersApiResponse>(
    USERS_URL,
    authenticatedFetcher,
    {
      revalidateOnFocus: false,
      revalidateIfStale: false,
      revalidateOnReconnect: false,
      dedupingInterval: DEDUPING_INTERVAL_MS,
    }
  );

  const users = useMemo<UserSearchUser[]>(() => data?.users ?? [], [data]);

  const filterByQuery = useCallback(
    (q: string): UserSearchUser[] => {
      if (users.length === 0) return [];
      const trimmed = q.trim().toLowerCase();
      if (!trimmed) return users.slice(0, MAX_SUGGESTIONS);
      const out: UserSearchUser[] = [];
      for (const u of users) {
        if (u.plexUsername.toLowerCase().includes(trimmed)) {
          out.push(u);
          if (out.length >= MAX_SUGGESTIONS) break;
        }
      }
      return out;
    },
    [users]
  );

  const findUserById = useCallback(
    (id: string | null | undefined): UserSearchUser | undefined => {
      if (!id) return undefined;
      return users.find((u) => u.id === id);
    },
    [users]
  );

  return {
    users,
    filterByQuery,
    findUserById,
    isLoading,
    error: (error as Error | null) ?? null,
  };
}
