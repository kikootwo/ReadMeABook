/**
 * Component: Category Tree View Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { CategoryTreeView } from '@/components/admin/indexers/CategoryTreeView';
import { getChildIds } from '@/lib/utils/torrent-categories';

describe('CategoryTreeView', () => {
  it('selects parent and children when the parent is toggled', () => {
    const onChange = vi.fn();

    render(<CategoryTreeView selectedCategories={[]} onChange={onChange} />);

    const audioLabel = screen.getByText('Audio');
    const audioRow = audioLabel.closest('div')?.parentElement;
    if (!audioRow) {
      throw new Error('Audio parent row not found');
    }

    fireEvent.click(within(audioRow).getByRole('switch'));

    const audioChildren = getChildIds(3000);
    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([3000, ...audioChildren])
    );
  });

  it('toggles a child category on and off', () => {
    const onChange = vi.fn();

    render(<CategoryTreeView selectedCategories={[]} onChange={onChange} />);

    const audiobookLabel = screen.getByText('Audiobook');
    const audiobookRow = audiobookLabel.closest('div')?.parentElement;
    if (!audiobookRow) {
      throw new Error('Audiobook row not found');
    }

    fireEvent.click(within(audiobookRow).getByRole('switch'));

    expect(onChange).toHaveBeenCalledWith(expect.arrayContaining([3030]));
  });

  it('disables child toggles when all children are selected', () => {
    const audioChildren = getChildIds(3000);

    render(
      <CategoryTreeView
        selectedCategories={[3000, ...audioChildren]}
        onChange={vi.fn()}
      />
    );

    const audiobookLabel = screen.getByText('Audiobook');
    const audiobookRow = audiobookLabel.closest('div')?.parentElement;
    if (!audiobookRow) {
      throw new Error('Audiobook row not found');
    }

    expect(within(audiobookRow).getByRole('switch')).toBeDisabled();
  });
});
