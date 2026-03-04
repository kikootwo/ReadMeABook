/**
 * Component: Hardcover Shelves Hook
 * Documentation: documentation/frontend/components.md
 */

'use client';

import { createShelfHooks, ShelfBook } from './createShelfHooks';

export type { ShelfBook };

export interface HardcoverShelf {
  id: string;
  name: string;
  listId: string;
  lastSyncAt: string | null;
  createdAt: string;
  bookCount: number | null;
  books: ShelfBook[];
}

const { useList, useAdd, useDelete, useUpdate } =
  createShelfHooks<HardcoverShelf>('/api/user/hardcover-shelves');

export const useHardcoverShelves = useList;

export function useAddHardcoverShelf() {
  const { addShelf: addGeneric, isLoading, error } = useAdd();

  const addShelf = async (apiToken: string, listId: string) => {
    return addGeneric({ apiToken, listId });
  };

  return { addShelf, isLoading, error };
}

export const useDeleteHardcoverShelf = useDelete;

export function useUpdateHardcoverShelf() {
  const { updateShelf: updateGeneric, isLoading, error } = useUpdate();

  const updateShelf = async (
    shelfId: string,
    updates: { listId?: string; apiToken?: string },
  ) => {
    return updateGeneric(shelfId, updates);
  };

  return { updateShelf, isLoading, error };
}
