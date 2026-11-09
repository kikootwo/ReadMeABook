/**
 * Component: Home Sections Hook
 * Documentation: documentation/features/home-sections.md
 *
 * Manages user home section configuration (CRUD) and category fetching.
 */

'use client';

import useSWR, { mutate as globalMutate } from 'swr';
import { authenticatedFetcher } from '@/lib/utils/api';
import { useCallback, useRef } from 'react';

export interface HomeSection {
  id: string;
  sectionType: 'popular' | 'new_releases' | 'category';
  categoryId: string | null;
  categoryName: string | null;
  sortOrder: number;
}

export interface HomeSectionsResponse {
  success: boolean;
  sections: HomeSection[];
  nextRefresh: string | null;
}

export interface AudibleSubcategory {
  id: string;
  name: string;
  parentId: string;
}

/** A top-level Audible category with its sub-categories (GET /api/audible/categories). */
export interface AudibleCategory {
  id: string;
  name: string;
  subcategories?: AudibleSubcategory[];
}

const HOME_SECTIONS_KEY = '/api/user/home-sections';

/**
 * Hook to fetch and manage user home sections.
 */
export function useHomeSections() {
  const { data, error, isLoading, mutate } = useSWR<HomeSectionsResponse>(
    HOME_SECTIONS_KEY,
    authenticatedFetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 30000,
    }
  );

  const saveSections = useCallback(
    async (sections: Omit<HomeSection, 'id'>[]) => {
      const { fetchJSON } = await import('@/lib/utils/api');
      const result = await fetchJSON<HomeSectionsResponse>(HOME_SECTIONS_KEY, {
        method: 'PUT',
        body: JSON.stringify({ sections }),
      });
      // Update local cache
      mutate(result, false);
      return result;
    },
    [mutate]
  );

  return {
    sections: data?.sections || [],
    nextRefresh: data?.nextRefresh || null,
    isLoading,
    error,
    saveSections,
    mutate,
  };
}

/**
 * Hook to fetch Audible categories (live scrape, for config modal).
 */
export function useAudibleCategories() {
  const { data, error, isLoading } = useSWR<{ success: boolean; categories: AudibleCategory[] }>(
    null, // Don't fetch automatically — use fetchCategories
    authenticatedFetcher,
    { revalidateOnFocus: false }
  );

  return {
    categories: data?.categories || [],
    isLoading,
    error,
  };
}

/**
 * Hook to fetch category audiobooks (same pattern as useAudiobooks).
 */
export function useCategoryAudiobooks(
  categoryId: string | null,
  limit: number = 20,
  page: number = 1,
  hideAvailable: boolean = false
) {
  const hideParam = hideAvailable ? '&hideAvailable=true' : '';
  const endpoint = categoryId
    ? `/api/audiobooks/category/${categoryId}?page=${page}&limit=${limit}${hideParam}`
    : null;

  const { data, error, isLoading } = useSWR(endpoint, authenticatedFetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 60000,
  });

  return {
    audiobooks: data?.audiobooks || [],
    totalCount: data?.totalCount || 0,
    totalPages: data?.totalPages || 0,
    currentPage: data?.page || page,
    hasMore: data?.hasMore || false,
    message: data?.message || null,
    isLoading,
    error,
  };
}
