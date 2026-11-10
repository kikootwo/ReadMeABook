/**
 * Component: Library dialog shell (Esc, focus in/trap/return, child dialog pauses, scroll lock, z order)
 * Documentation: documentation/features/library-view.md
 */

// @vitest-environment jsdom

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LibraryDialog, useChildDialog } from '@/components/library/LibraryDialog';

/** A stand-in for InteractiveTorrentSearchModal: portaled outside, clears the scroll lock on close. */
function Child({ onClose }: { onClose: () => void }) {
  React.useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);
  return createPortal(
    <div role="dialog" aria-label="child">
      <input aria-label="child search" />
      <button type="button">child result</button>
      <button type="button" onClick={onClose}>
        close child
      </button>
    </div>,
    document.body
  );
}

/**
 * Like LibraryActions: owns the child's open state and reports it from an effect, one commit after
 * the child mounts (and in the same commit as its cleanup). `seen` records the body lock right
 * after each report; `escAfterClose` presses Esc right after the close report, before any re-render.
 */
function Actions({
  onChildOpenChange,
  seen,
  escAfterClose,
}: {
  onChildOpenChange: (open: boolean) => void;
  seen: string[];
  escAfterClose: boolean;
}) {
  const [child, setChild] = useState(false);
  const wasOpen = React.useRef(false);
  React.useEffect(() => {
    onChildOpenChange(child);
    seen.push(document.body.style.overflow);
    if (escAfterClose && wasOpen.current && !child) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    wasOpen.current = child;
  }, [child, onChildOpenChange, seen, escAfterClose]);
  return (
    <>
      <button type="button" onClick={() => setChild(true)}>
        open child
      </button>
      {child && <Child onClose={() => setChild(false)} />}
    </>
  );
}

function Harness({
  onClose = vi.fn(),
  seen = [],
  escAfterClose = false,
}: {
  onClose?: () => void;
  seen?: string[];
  escAfterClose?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { isChildOpen, onChildOpenChange } = useChildDialog(open);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        opener
      </button>
      {/* The page closing the dialog by itself (LibraryDetail renders nothing without an item) */}
      <button type="button" onClick={() => setOpen(false)}>
        force close
      </button>
      <LibraryDialog
        open={open}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        labelledBy="t"
        isChildOpen={isChildOpen}
      >
        <h2 id="t">Title</h2>
        <button type="button">first</button>
        {open && <Actions onChildOpenChange={onChildOpenChange} seen={seen} escAfterClose={escAfterClose} />}
        <button type="button">last</button>
      </LibraryDialog>
    </>
  );
}

describe('LibraryDialog', () => {
  it('moves focus in, traps Tab both ways, closes on Esc and returns focus to the opener', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await user.click(screen.getByText('opener'));
    const dialog = screen.getByRole('dialog', { name: 'Title' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('first')).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByText('last')).toHaveFocus();
    await user.tab();
    expect(screen.getByText('first')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('opener')).toHaveFocus();
  });

  it('sits above the header (z-40) and below toasts (z-50)', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('opener'));
    const backdrop = screen.getByRole('dialog', { name: 'Title' }).parentElement!;
    expect(backdrop.className).toContain('z-[45]');
  });

  it('while a child dialog is open, Esc and the Tab trap pause; the scroll lock comes back when it closes', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await user.click(screen.getByText('opener'));
    expect(document.body.style.overflow).toBe('hidden');
    await user.click(screen.getByText('open child'));

    const search = screen.getByLabelText('child search');
    await user.click(search);
    await user.keyboard('dune');
    expect(search).toHaveValue('dune'); // typing in the child is not pulled back
    await user.tab();
    expect(screen.getByText('child result')).toHaveFocus(); // Tab moves through the child
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByText('close child'));
    expect(document.body.style.overflow).toBe('hidden'); // the child's cleanup cleared it; set again
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.body.style.overflow).toBe('');
  });

  it('the lock is back in the same commit the child closes in (no later render needed)', async () => {
    const user = userEvent.setup();
    const seen: string[] = [];
    render(<Harness seen={seen} />);
    await user.click(screen.getByText('opener'));
    await user.click(screen.getByText('open child'));
    await user.click(screen.getByText('close child'));
    expect(seen.at(-1)).toBe('hidden'); // read right after the close report, before any re-render
    await user.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('');
  });

  it('Esc right after the child closes (before any re-render) closes the dialog', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} escAfterClose />);
    await user.click(screen.getByText('opener'));
    await user.click(screen.getByText('open child'));
    await user.click(screen.getByText('close child'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });

  it('the dialog closed while its child is open: unlocked, and a reopen is not left locked on close', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText('opener'));
    await user.click(screen.getByText('open child'));
    fireEvent.click(screen.getByRole('dialog', { name: 'Title' }).parentElement!); // paused: no close
    expect(screen.getByRole('dialog', { name: 'Title' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('force close'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
    await user.click(screen.getByText('opener')); // the fresh child reports closed: no lock of its own
    expect(document.body.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('');
  });

  it('a backdrop click closes; a click inside does not', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByText('opener'));
    fireEvent.click(screen.getByText('first'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('dialog', { name: 'Title' }).parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
