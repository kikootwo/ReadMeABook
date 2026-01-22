/**
 * Component: Card Size Controls Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('CardSizeControls', () => {
  beforeEach(() => {
    window.innerWidth = 1300;
  });

  it('moves to the next visible size when zooming in or out', async () => {
    const onSizeChange = vi.fn();
    const { CardSizeControls } = await import('@/components/ui/CardSizeControls');

    render(<CardSizeControls size={5} onSizeChange={onSizeChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(onSizeChange).toHaveBeenCalledWith(6);

    onSizeChange.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(onSizeChange).toHaveBeenCalledWith(4);
  });

  it('disables zoom controls at the size boundaries', async () => {
    const onSizeChange = vi.fn();
    const { CardSizeControls } = await import('@/components/ui/CardSizeControls');

    const { rerender } = render(<CardSizeControls size={1} onSizeChange={onSizeChange} />);

    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();

    rerender(<CardSizeControls size={9} onSizeChange={onSizeChange} />);

    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
  });
});
