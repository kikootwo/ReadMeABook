/**
 * Component: Delete Confirm Modal Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DeleteConfirmModal } from '@/components/admin/indexers/DeleteConfirmModal';

describe('DeleteConfirmModal', () => {
  it('confirms removal and closes the modal', () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();

    render(
      <DeleteConfirmModal
        isOpen
        onClose={onClose}
        onConfirm={onConfirm}
        indexerName="TrackerOne"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove Indexer' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes without confirming when canceled', () => {
    const onClose = vi.fn();

    render(
      <DeleteConfirmModal
        isOpen
        onClose={onClose}
        onConfirm={vi.fn()}
        indexerName="TrackerTwo"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
