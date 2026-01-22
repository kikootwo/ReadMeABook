/**
 * Component: Backend Selection Step Tests
 * Documentation: documentation/setup-wizard.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

describe('BackendSelectionStep', () => {
  it('updates the audible region helper based on backend', async () => {
    const { BackendSelectionStep } = await import('@/app/setup/steps/BackendSelectionStep');

    const { rerender } = render(
      <BackendSelectionStep
        value="plex"
        onChange={vi.fn()}
        audibleRegion="us"
        onAudibleRegionChange={vi.fn()}
        onNext={vi.fn()}
        onBack={vi.fn()}
      />
    );

    expect(screen.getByText(/configuration in Plex/i)).toBeInTheDocument();

    rerender(
      <BackendSelectionStep
        value="audiobookshelf"
        onChange={vi.fn()}
        audibleRegion="us"
        onAudibleRegionChange={vi.fn()}
        onNext={vi.fn()}
        onBack={vi.fn()}
      />
    );

    expect(screen.getByText(/configuration in Audiobookshelf/i)).toBeInTheDocument();
  });

  it('updates backend selection and audible region', async () => {
    const onChange = vi.fn();
    const onAudibleRegionChange = vi.fn();
    const onNext = vi.fn();
    const onBack = vi.fn();
    const { BackendSelectionStep } = await import('@/app/setup/steps/BackendSelectionStep');

    render(
      <BackendSelectionStep
        value="plex"
        onChange={onChange}
        audibleRegion="us"
        onAudibleRegionChange={onAudibleRegionChange}
        onNext={onNext}
        onBack={onBack}
      />
    );

    fireEvent.click(screen.getByRole('radio', { name: /Audiobookshelf/i }));
    expect(onChange).toHaveBeenCalledWith('audiobookshelf');

    fireEvent.change(screen.getByLabelText('Audible Region'), { target: { value: 'uk' } });
    expect(onAudibleRegionChange).toHaveBeenCalledWith('uk');

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(onBack).toHaveBeenCalled();
    expect(onNext).toHaveBeenCalled();
  });
});
