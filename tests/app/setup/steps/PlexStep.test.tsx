/**
 * Component: Setup Plex Step Tests
 * Documentation: documentation/setup-wizard.md
 */

// @vitest-environment jsdom

import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlexStep } from '@/app/setup/steps/PlexStep';

const PlexHarness = ({
  onNext,
  onBack,
  initialState,
}: {
  onNext: () => void;
  onBack: () => void;
  initialState?: Partial<React.ComponentProps<typeof PlexStep>>;
}) => {
  const [state, setState] = useState({
    plexUrl: 'http://plex.local',
    plexToken: 'token',
    plexLibraryId: '',
    plexTriggerScanAfterImport: false,
    ...initialState,
  });

  return (
    <PlexStep
      {...state}
      onUpdate={(field, value) => setState((prev) => ({ ...prev, [field]: value }))}
      onNext={onNext}
      onBack={onBack}
    />
  );
};

describe('PlexStep', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requires library selection after successful test', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        serverName: 'Plex',
        libraries: [{ id: 'lib-1', title: 'Audiobooks', type: 'artist' }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const onNext = vi.fn();

    render(<PlexHarness onNext={onNext} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/setup/test-plex', expect.any(Object));
    });

    await screen.findByText(/Connected to Plex/i);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Please select an audiobook library')).toBeInTheDocument();
    expect(onNext).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
    await screen.findByText(/Connected to Plex/i);

    const librarySelect = await screen.findByRole('combobox');
    fireEvent.change(librarySelect, { target: { value: 'lib-1' } });

    await waitFor(() => {
      expect(librarySelect).toHaveValue('lib-1');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onNext).toHaveBeenCalled();
  });
});
