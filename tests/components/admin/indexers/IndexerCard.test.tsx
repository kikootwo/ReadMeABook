/**
 * Component: Indexer Card Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { IndexerCard } from '@/components/admin/indexers/IndexerCard';

describe('IndexerCard', () => {
  it('renders indexer info and triggers edit/delete actions', () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    render(
      <IndexerCard
        indexer={{ id: 2, name: 'IndexerTwo', protocol: 'usenet' }}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );

    expect(screen.getByText('IndexerTwo')).toBeInTheDocument();
    expect(screen.getByText('usenet')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Edit indexer'));
    fireEvent.click(screen.getByTitle('Delete indexer'));

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
