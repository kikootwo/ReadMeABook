/**
 * Component: Modal Component Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Modal } from '@/components/ui/Modal';

describe('Modal', () => {
  it('locks body scroll while open and closes on escape', () => {
    const onClose = vi.fn();

    const { unmount } = render(
      <Modal isOpen onClose={onClose} title="Test Modal">
        <div>Modal Content</div>
      </Modal>
    );

    expect(screen.getByText('Modal Content')).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    unmount();
    expect(document.body.style.overflow).toBe(''); // Cleared to default
  });

  it('opened over another dialog that locks the page: closing leaves that lock in place', () => {
    document.body.style.overflow = 'hidden'; // the outer dialog (e.g. the details modal)

    const { rerender } = render(
      <Modal isOpen onClose={vi.fn()} title="Confirm">
        <div>Confirm body</div>
      </Modal>
    );
    rerender(
      <Modal isOpen={false} onClose={vi.fn()} title="Confirm">
        <div>Confirm body</div>
      </Modal>
    );

    expect(document.body.style.overflow).toBe('hidden');
    document.body.style.overflow = '';
  });
});
