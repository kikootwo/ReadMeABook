/**
 * Component: Library dialog shell (detail and filter sheet): portal, Esc, scroll lock, focus trap
 * Documentation: documentation/features/library-view.md
 *
 * z-[45]: above the sticky header (z-40), below toasts (z-50) and the stacked Interactive search
 * modal (z-[60]). While `isChildOpen()` is true, a child dialog owns the keyboard: Esc, the Tab trap
 * and the backdrop click pause. The scroll lock holds while the child is open. The child clears it
 * in its own effect cleanup when it closes; useChildDialog sets it again inside the close report
 * itself (same commit), so the page behind is never unlocked, or Esc ignored, between the two.
 */

'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface LibraryDialogProps {
  open: boolean;
  onClose: () => void;
  /** id of the element that names the dialog. */
  labelledBy: string;
  /** center: phone bottom sheet, centered card from sm. side: phone bottom sheet, right panel from sm. */
  variant?: 'center' | 'side';
  /** A child dialog is open (useChildDialog). Read at event time, so it needs no re-render. */
  isChildOpen?: () => boolean;
  children: React.ReactNode;
}

/**
 * Open state of a child dialog (Interactive search) opened from inside an open LibraryDialog, kept
 * in a ref, not state. The child reports from an effect, which runs in the same commit as its own
 * cleanup (that clears the body lock), so the open-to-closed report sets the lock again and frees
 * Esc at once; state would wait for a later render and leave both wrong in between. `active`: the
 * dialog is open; closing it forgets the last report, so a fresh mount (it reports closed) never locks.
 */
export function useChildDialog(active: boolean): { isChildOpen: () => boolean; onChildOpenChange: (open: boolean) => void } {
  const reportedOpen = useRef(false);
  useEffect(() => {
    if (!active) reportedOpen.current = false;
  }, [active]);
  const isChildOpen = useCallback(() => reportedOpen.current, []);
  const onChildOpenChange = useCallback((open: boolean) => {
    if (reportedOpen.current && !open) document.body.style.overflow = 'hidden';
    reportedOpen.current = open;
  }, []);
  return { isChildOpen, onChildOpenChange };
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest('[inert]'));
}

export function LibraryDialog({ open, onClose, labelledBy, variant = 'center', isChildOpen, children }: LibraryDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const isChildOpenRef = useRef(isChildOpen);
  useEffect(() => {
    onCloseRef.current = onClose;
    isChildOpenRef.current = isChildOpen;
  }, [onClose, isChildOpen]);
  const childOpenNow = () => isChildOpenRef.current?.() ?? false;

  // Focus in on open, back to the opener on close.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    if (panel) (focusables(panel)[0] ?? panel).focus();
    return () => {
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open]);

  // Scroll lock for as long as the dialog is open. A child dialog reports itself open one commit
  // after it locked the body, so the lock never depends on the child (that cleanup would unlock it).
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Esc and the Tab trap (paused while a child dialog is open).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (childOpenNow()) return;
      const panel = panelRef.current;
      if (!panel) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables(panel);
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = !!active && panel.contains(active);
      if (e.shiftKey && (!inside || active === firstItem)) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && (!inside || active === lastItem)) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  // Never open on the first (server) render: it opens on a click, so document exists.
  if (!open || typeof document === 'undefined') return null;

  const side = variant === 'side';
  return createPortal(
    <div
      className={`fixed inset-0 z-[45] flex bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 items-end justify-center ${
        side ? 'sm:items-stretch sm:justify-end' : 'sm:items-center'
      }`}
      style={{ height: '100dvh' }}
      onClick={() => {
        if (!childOpenNow()) onCloseRef.current();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={`relative w-full bg-white dark:bg-gray-900 shadow-2xl overflow-hidden flex flex-col outline-none rounded-t-2xl animate-in slide-in-from-bottom-4 duration-300 ${
          side
            ? 'max-h-[85dvh] sm:max-h-none sm:h-full sm:w-96 sm:max-w-[90vw] sm:rounded-none sm:slide-in-from-bottom-0'
            : 'sm:max-w-2xl lg:max-w-3xl sm:rounded-2xl sm:slide-in-from-bottom-0 sm:zoom-in-95'
        }`}
        style={{
          maxHeight: side ? undefined : 'calc(100dvh - env(safe-area-inset-top, 0px) - 1rem)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
