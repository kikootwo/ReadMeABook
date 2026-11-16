/**
 * Component: Library edition lookup for the details modal
 * Documentation: documentation/fixes/file-hash-matching.md
 */

'use client';

import { useAudiobookDetails } from '@/lib/hooks/useAudiobooks';
import { sameAsin } from '@/lib/utils/asin';

/**
 * The Audible record of the edition the library holds, when it differs from the requested one.
 * Display only: callers keep every action on the requested ASIN. With no library ASIN, or the
 * same one (case-insensitive), nothing extra is looked up.
 *
 * - `libraryAsin`: the library ASIN when it differs from `asin`, else null
 * - `libraryBook`: its Audible record once loaded, else null
 * - `isLoading`: its lookup is still running
 * - `failed`: its lookup finished without a record (not found, or an error)
 */
export function useLibraryEdition(asin: string | null, libraryAsin: string | null | undefined, enabled: boolean) {
  const following = enabled && !!asin && !!libraryAsin && !sameAsin(asin, libraryAsin);
  const { audiobook, isLoading } = useAudiobookDetails(following ? libraryAsin! : null);
  const libraryBook = following ? audiobook : null;

  return {
    libraryAsin: following ? libraryAsin! : null,
    libraryBook,
    isLoading: following && isLoading,
    failed: following && !isLoading && !libraryBook,
  };
}
