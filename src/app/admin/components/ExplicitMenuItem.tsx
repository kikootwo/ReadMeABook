/**
 * Component: Admin request menu item, Mark explicit / Remove explicit mark (#542)
 * Documentation: documentation/features/explicit-flag.md
 *
 * Audiobookshelf mode, audiobook requests. "Mark explicit" is hidden on a denied request (it is
 * never delivered); "Remove explicit mark" shows whenever the request is marked. The server's
 * message (Audiobookshelf not updated, still flagged there, other marked requests) is a toast.
 */

'use client';

import { useToast } from '@/components/ui/Toast';
import { useSetExplicit } from '@/lib/hooks/useExplicitMark';

interface ExplicitMenuItemProps {
  requestId: string;
  explicit: boolean;
  status: string;
  /** Closes the menu */
  onDone: () => void;
}

export function ExplicitMenuItem({ requestId, explicit, status, onDone }: ExplicitMenuItemProps) {
  const { setExplicit } = useSetExplicit();
  const toast = useToast();
  if (!explicit && status === 'denied') return null;

  const handleClick = async () => {
    onDone();
    try {
      const result = await setExplicit(requestId, !explicit);
      if (result.message) toast.warning(result.message, 10000);
      else toast.success(result.explicit ? 'Marked explicit' : 'Explicit mark removed');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update the explicit mark');
    }
  };

  return (
    <button
      onClick={handleClick}
      className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors"
      role="menuitem"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
      </svg>
      {explicit ? 'Remove explicit mark' : 'Mark explicit'}
    </button>
  );
}
