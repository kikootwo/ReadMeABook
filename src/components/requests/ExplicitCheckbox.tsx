/**
 * Component: Explicit checkbox (#542)
 * Documentation: documentation/features/explicit-flag.md
 *
 * ExplicitCheckbox: one "Explicit" checkbox with a 44px touch target. A non-admin's tick asks first
 * (what it does in Audiobookshelf, and that only an admin can undo it); once a mark is saved, a
 * non-admin sees it disabled with the reason as visible text (the details modal, which saves
 * nothing until Request, locks it only for a request already marked). Admins toggle without a confirm.
 * RequestExplicitControl: the checkbox wired to an existing request (My Requests), with a toast for
 * the server's message.
 */

'use client';

import React, { useId, useState } from 'react';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useToast } from '@/components/ui/Toast';
import { useSetExplicit } from '@/lib/hooks/useExplicitMark';

export const EXPLICIT_CONFIRM_MESSAGE =
  "Audiobookshelf will hide this book from accounts that can't see explicit content (which may include yours), and only an admin can remove the mark.";
export const EXPLICIT_LOCKED_REASON = 'Only an admin can remove this';

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
          locked || busy ? 'cursor-default' : 'cursor-pointer'
        } text-gray-700 dark:text-gray-300`}
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={locked || busy}
          onChange={handleChange}
          aria-describedby={locked ? reasonId : undefined}
          className="h-4 w-4 rounded border-gray-300 accent-rose-600 disabled:opacity-60 dark:border-gray-600"
        />
        <span className="font-medium">Explicit</span>
        {locked && (
          <span id={reasonId} className="text-xs text-gray-500 dark:text-gray-400">
            {EXPLICIT_LOCKED_REASON}
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
  className?: string;
}

/** The checkbox on an existing request: saves through PUT /api/requests/[id]/explicit. */
export function RequestExplicitControl({ requestId, explicit, isAdmin, className }: RequestExplicitControlProps) {
  const { setExplicit, isLoading } = useSetExplicit();
  const toast = useToast();
  // Shown at once; the list refresh that follows confirms it (a new value from the list wins)
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
      if (result.message) toast.warning(result.message, 10000);
    } catch (error) {
      setShown(null);
      toast.error(error instanceof Error ? error.message : 'Failed to update the explicit mark');
    }
  };

  return <ExplicitCheckbox checked={checked} onChange={save} isAdmin={isAdmin} busy={isLoading} className={className} />;
}
