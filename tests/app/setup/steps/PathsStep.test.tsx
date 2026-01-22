/**
 * Component: Setup Paths Step Tests
 * Documentation: documentation/setup-wizard.md
 */

// @vitest-environment jsdom

import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PathsStep } from '@/app/setup/steps/PathsStep';

const PathsHarness = ({
  onNext,
  onBack,
  initialState,
}: {
  onNext: () => void;
  onBack: () => void;
  initialState?: Partial<React.ComponentProps<typeof PathsStep>>;
}) => {
  const [state, setState] = useState({
    downloadDir: '/downloads',
    mediaDir: '/media/audiobooks',
    metadataTaggingEnabled: true,
    chapterMergingEnabled: false,
    ...initialState,
  });

  return (
    <PathsStep
      {...state}
      onUpdate={(field, value) => setState((prev) => ({ ...prev, [field]: value }))}
      onNext={onNext}
      onBack={onBack}
    />
  );
};

describe('PathsStep', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('validates paths and allows navigation on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        message: 'Directories are ready',
        downloadDirValid: true,
        mediaDirValid: true,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const onNext = vi.fn();

    render(<PathsHarness onNext={onNext} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Validate Paths' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/setup/test-paths', expect.any(Object));
    });

    expect(screen.getByText('Directories are ready')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onNext).toHaveBeenCalled();
  });

  it('requires validation before proceeding', async () => {
    const onNext = vi.fn();
    render(<PathsHarness onNext={onNext} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText('Please validate the paths before proceeding')).toBeInTheDocument();
    expect(onNext).not.toHaveBeenCalled();
  });

  it('toggles metadata and chapter merge settings', async () => {
    render(
      <PathsHarness
        onNext={vi.fn()}
        onBack={vi.fn()}
        initialState={{ metadataTaggingEnabled: false, chapterMergingEnabled: false }}
      />
    );

    const metadataToggle = screen.getByLabelText('Auto-tag audio files with metadata');
    const chapterToggle = screen.getByLabelText('Auto-merge chapters to M4B');

    fireEvent.click(metadataToggle);
    fireEvent.click(chapterToggle);

    expect(metadataToggle).toBeChecked();
    expect(chapterToggle).toBeChecked();
  });
});
