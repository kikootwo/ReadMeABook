/**
 * Component: Setup Prowlarr Step Tests
 * Documentation: documentation/setup-wizard.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const indexersMock = [
  {
    id: 1,
    name: 'Indexer',
    priority: 10,
    seedingTimeMinutes: 0,
    rssEnabled: true,
    categories: [],
  },
];

vi.mock('@/components/admin/indexers/IndexerManagement', () => ({
  IndexerManagement: ({ onIndexersChange }: { onIndexersChange: (indexers: any[]) => void }) => (
    <button type="button" onClick={() => onIndexersChange(indexersMock)}>
      Set Indexers
    </button>
  ),
}));

describe('ProwlarrStep', () => {
  it('shows validation errors when required fields are missing', async () => {
    const { ProwlarrStep } = await import('@/app/setup/steps/ProwlarrStep');
    const onNext = vi.fn();

    render(
      <ProwlarrStep
        prowlarrUrl=""
        prowlarrApiKey=""
        onUpdate={vi.fn()}
        onNext={onNext}
        onBack={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText('Please enter Prowlarr URL and API key')).toBeInTheDocument();
    expect(onNext).not.toHaveBeenCalled();
  });

  it('updates indexers and proceeds when valid', async () => {
    const { ProwlarrStep } = await import('@/app/setup/steps/ProwlarrStep');
    const onUpdate = vi.fn();
    const onNext = vi.fn();

    render(
      <ProwlarrStep
        prowlarrUrl="http://localhost:9696"
        prowlarrApiKey="key"
        onUpdate={onUpdate}
        onNext={onNext}
        onBack={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Set Indexers' }));

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith('prowlarrIndexers', indexersMock);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onNext).toHaveBeenCalled();
  });
});
