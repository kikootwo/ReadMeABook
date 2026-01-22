/**
 * Component: Available Indexer Row Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AvailableIndexerRow } from '@/components/admin/indexers/AvailableIndexerRow';

describe('AvailableIndexerRow', () => {
  const indexer = {
    id: 1,
    name: 'Test Indexer',
    protocol: 'torrent',
    supportsRss: true,
  };

  it('renders an add button when the indexer is not added', () => {
    const onAdd = vi.fn();

    render(<AvailableIndexerRow indexer={indexer} isAdded={false} onAdd={onAdd} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Test Indexer')).toBeInTheDocument();
    expect(screen.getByText('torrent')).toBeInTheDocument();
  });

  it('renders the added state when already configured', () => {
    render(<AvailableIndexerRow indexer={indexer} isAdded onAdd={vi.fn()} />);

    expect(screen.getByText('Added')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
  });
});
