/**
 * Component: Setup Audiobookshelf Step Tests
 * Documentation: documentation/setup-wizard.md
 */

// @vitest-environment jsdom

import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudiobookshelfStep } from '@/app/setup/steps/AudiobookshelfStep';

const AudiobookshelfHarness = ({
  onNext,
  onBack,
  initialState,
}: {
  onNext: () => void;
  onBack: () => void;
  initialState?: Partial<React.ComponentProps<typeof AudiobookshelfStep>>;
}) => {
  const [state, setState] = useState({
    absUrl: 'http://abs.local',
    absApiToken: 'token',
    absLibraryId: '',
    absTriggerScanAfterImport: false,
    ...initialState,
  });

  return (
    <AudiobookshelfStep
      {...state}
      onUpdate={(field, value) => setState((prev) => ({ ...prev, [field]: value }))}
      onNext={onNext}
      onBack={onBack}
    />
  );
};

describe('AudiobookshelfStep', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requires library selection after successful test', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        libraries: [{ id: 'lib-1', name: 'Main', itemCount: 10 }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const onNext = vi.fn();

    render(<AudiobookshelfHarness onNext={onNext} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/setup/test-abs', expect.any(Object));
    });

    await screen.findByText('Connection successful!');

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Please select an audiobook library')).toBeInTheDocument();
    expect(onNext).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
    await screen.findByText('Connection successful!');

    const librarySelect = await screen.findByRole('combobox');
    fireEvent.change(librarySelect, { target: { value: 'lib-1' } });

    await waitFor(() => {
      expect(librarySelect).toHaveValue('lib-1');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onNext).toHaveBeenCalled();
  });
});
