/**
 * Component: Explicit checkbox (#542)
 * Documentation: documentation/features/explicit-flag.md
 *
 * ExplicitCheckbox: one "Explicit" checkbox with a 44px touch target. A non-admin's tick asks first
 * (what it does in Audiobookshelf, and that only an admin can undo it); once a mark is saved, a
 * non-admin sees it disabled with the reason as visible text (the details modal, which saves
 * nothing until Request, locks it only for a request already marked; an admin there reads that a
 * re-request keeps the mark). Admins toggle without a confirm. A locked mark keeps its rose tick.
 * RequestExplicitControl: the checkbox wired to an existing request (My Requests), with a toast for
 * the server's message; `onSaved` reloads the list it came from.
 */

'use client';

import React, { useId, useState } from 'react';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useToast } from '@/components/ui/Toast';
import { useSetExplicit } from '@/lib/hooks/useExplicitMark';

export const EXPLICIT_CONFIRM_MESSAGE =
  "Audiobookshelf will hide this book from accounts that can't see explicit content (which may include yours), and only an admin can remove the mark.";
export const EXPLICIT_LOCKED_REASON = 'Only an admin can remove this';
/** An admin's locked box: the details modal on a marked request (a re-request ORs the mark back in) */
export const EXPLICIT_LOCKED_REASON_ADMIN = 'A re-request keeps the mark';

interface ExplicitCheckboxProps {
  checked: boolean;
  onChange: (next: boolean) => void | Promise<void>;
  isAdmin: boolean;
  /** While a save is in flight */
  busy?: boolean;
  /** Disabled with the reason; default: checked and not an admin (a saved mark). A form that saves nothing yet passes its own. */
  locked?: boolean;
  className?: string;
}

export function ExplicitCheckbox({ checked, onChange, isAdmin, busy = false, locked: lockedProp, className }: ExplicitCheckboxProps) {
  const id = useId();
  const reasonId = `${id}-reason`;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const locked = lockedProp ?? (checked && !isAdmin);
  // Mid-save: a wait cursor and a lighter border. Idle border is 3:1 or more on white and dark
  const waiting = busy && !locked;

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.checked;
    if (next && !isAdmin) {
      setConfirmOpen(true);
      return;
    }
    void onChange(next);
  };

  const confirm = () => {
    setConfirmOpen(false);
    void onChange(true);
  };

  return (
    <div className={className}>
      <label
        htmlFor={id}
        className={`inline-flex min-h-[44px] flex-wrap items-center gap-x-2 gap-y-0.5 text-sm ${
          waiting ? 'cursor-wait' : locked ? 'cursor-default' : 'cursor-pointer'
        } text-gray-700 dark:text-gray-300`}
      >
        {/* Drawn by hand so a locked (disabled) mark keeps its rose tick instead of the native grey */}
        <span className="relative inline-flex h-4 w-4 shrink-0">
          <input
            id={id}
            type="checkbox"
            checked={checked}
            disabled={locked || busy}
            onChange={handleChange}
            aria-describedby={locked ? reasonId : undefined}
            className={`peer h-4 w-4 appearance-none rounded border bg-white checked:border-rose-600 checked:bg-rose-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600 dark:bg-gray-800 dark:checked:border-rose-500 dark:checked:bg-rose-500 ${
              waiting ? 'cursor-wait border-gray-300 dark:border-gray-600' : 'border-gray-500 dark:border-gray-400'
            }`}
          />
          <svg aria-hidden="true" viewBox="0 0 16 16" className="pointer-events-none absolute inset-0 hidden h-4 w-4 text-white peer-checked:block">
            <path d="M4 8.5l2.5 2.5L12 5.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="font-medium">Explicit</span>
        {locked && (
          <span id={reasonId} className="text-xs text-gray-500 dark:text-gray-400">
            {isAdmin ? EXPLICIT_LOCKED_REASON_ADMIN : EXPLICIT_LOCKED_REASON}
          </span>
        )}
      </label>
      <ConfirmModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={confirm}
        title="Mark as explicit?"
        message={EXPLICIT_CONFIRM_MESSAGE}
        confirmText="Mark explicit"
        cancelText="Cancel"
      />
    </div>
  );
}

interface RequestExplicitControlProps {
  requestId: string;
  explicit: boolean;
  isAdmin: boolean;
  /** After a save: reload the list the request came from (My Requests passes its own revalidate) */
  onSaved?: () => void;
  className?: string;
}

/** The checkbox on an existing request: saves through PUT /api/requests/[id]/explicit. */
export function RequestExplicitControl({ requestId, explicit, isAdmin, onSaved, className }: RequestExplicitControlProps) {
  const { setExplicit, isLoading } = useSetExplicit();
  const toast = useToast();
  // Shown at once; onSaved reloads the list, and a new value from the list wins
  const [shown, setShown] = useState<boolean | null>(null);
  const [shownFor, setShownFor] = useState(explicit);
  if (shownFor !== explicit) {
    setShownFor(explicit);
    setShown(null);
  }
  const checked = shown ?? explicit;

  const save = async (next: boolean) => {
    setShown(next);
    try {
      const result = await setExplicit(requestId, next);
      setShown(result.explicit);
      onSaved?.();
      if (result.message) toast.warning(result.message, 10000);
    } catch (error) {
      setShown(null);
      toast.error(error instanceof Error ? error.message : 'Failed to update the explicit mark');
    }
  };

  return <ExplicitCheckbox checked={checked} onChange={save} isAdmin={isAdmin} busy={isLoading} className={className} />;
}
