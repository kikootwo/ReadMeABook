/**
 * Component: Indexer Config Modal Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { IndexerConfigModal } from '@/components/admin/indexers/IndexerConfigModal';

describe('IndexerConfigModal', () => {
  it('clamps numeric inputs and saves configuration', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();

    render(
      <IndexerConfigModal
        isOpen
        onClose={onClose}
        mode="add"
        indexer={{ id: 1, name: 'Prowlarr', protocol: 'torrent', supportsRss: true }}
        onSave={onSave}
      />
    );

    const [priorityInput, seedingInput] = screen.getAllByRole('spinbutton');

    fireEvent.change(priorityInput, { target: { value: '99' } });
    expect(priorityInput).toHaveValue(25);

    fireEvent.change(seedingInput, { target: { value: '-5' } });
    expect(seedingInput).toHaveValue(0);

    const rssToggle = screen.getByRole('checkbox');
    fireEvent.click(rssToggle);

    fireEvent.click(screen.getByRole('button', { name: 'Add Indexer' }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        name: 'Prowlarr',
        priority: 25,
        seedingTimeMinutes: 0,
        rssEnabled: false,
        categories: expect.arrayContaining([3030]),
      })
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('validates that at least one category is selected', () => {
    const onSave = vi.fn();

    render(
      <IndexerConfigModal
        isOpen
        onClose={vi.fn()}
        mode="add"
        indexer={{ id: 2, name: 'NoCats', protocol: 'torrent', supportsRss: true }}
        onSave={onSave}
      />
    );

    const audiobookLabel = screen.getByText('Audiobook');
    const audiobookRow = audiobookLabel.closest('div')?.parentElement;
    if (!audiobookRow) {
      throw new Error('Audiobook row not found');
    }

    fireEvent.click(within(audiobookRow).getByRole('switch'));
    fireEvent.click(screen.getByRole('button', { name: 'Add Indexer' }));

    expect(screen.getByText('At least one category must be selected')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('forces RSS to false when the indexer does not support RSS', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();

    render(
      <IndexerConfigModal
        isOpen
        onClose={onClose}
        mode="add"
        indexer={{ id: 3, name: 'NoRSS', protocol: 'torrent', supportsRss: false }}
        onSave={onSave}
      />
    );

    const rssToggle = screen.getByRole('checkbox');
    expect(rssToggle).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Add Indexer' }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 3,
        name: 'NoRSS',
        rssEnabled: false,
      })
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
