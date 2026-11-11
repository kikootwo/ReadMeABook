/**
 * Component: Library access button (details modal, book already in the library)
 * Documentation: documentation/features/requester-tags.md
 *
 * "In Your Library", or, while requester tags are on, the caller's access state: the usual Request
 * Audiobook button (an access request), Access Requested (awaiting approval) or Access Denied.
 */

'use client';

import React from 'react';
import type { Audiobook } from '@/lib/hooks/useAudiobooks';

interface LibraryAccessButtonProps {
  access: Audiobook['libraryAccess'];
  onRequest: () => void;
  isRequesting: boolean;
}

const BASE = 'w-full py-3 px-4 rounded-xl font-semibold';

export function LibraryAccessButton({ access, onRequest, isRequesting }: LibraryAccessButtonProps) {
  if (access === 'request') {
    return (
      <button
        onClick={onRequest}
        disabled={isRequesting}
        className={`${BASE} text-white bg-blue-600 hover:bg-blue-700 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed`}
        title="This book is already in the library. Ask for access to it."
      >
        {isRequesting ? 'Requesting...' : 'Request Audiobook'}
      </button>
    );
  }
  if (access === 'requested') {
    return <button disabled className={`${BASE} text-blue-700 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30`}>Access Requested</button>;
  }
  if (access === 'denied') {
    return <button disabled className={`${BASE} text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-900/30`}>Access Denied</button>;
  }
  return <button disabled className={`${BASE} text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/30`}>In Your Library</button>;
}
