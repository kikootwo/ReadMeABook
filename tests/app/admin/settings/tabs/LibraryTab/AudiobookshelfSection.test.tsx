/**
 * Component: Audiobookshelf Library Settings Section Tests
 * Documentation: documentation/settings-pages.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AudiobookshelfSection } from '@/app/admin/settings/tabs/LibraryTab/AudiobookshelfSection';
import type { ABSLibrary, Settings } from '@/app/admin/settings/lib/types';

const libraries: ABSLibrary[] = [
  { id: 'abs-audio', name: 'Audiobooks', type: 'book', itemCount: 10 },
  { id: 'abs-ebooks', name: 'Ebooks', type: 'book', itemCount: 5 },
];

const settings = (abs: Partial<Settings['audiobookshelf']>) => ({
  audibleRegion: 'us',
  audibleLanguageFilter: false,
  audiobookshelf: {
    serverUrl: 'http://abs',
    apiToken: '********',
    libraryId: 'abs-audio',
    ebookLibraryId: '',
    triggerScanAfterImport: false,
    ...abs,
  },
}) as Settings;

function renderSection(current: Settings, onChange = vi.fn(), libs = libraries) {
  render(
    <AudiobookshelfSection
      settings={current}
      onChange={onChange}
      onValidationChange={() => {}}
      libraries={libs}
      testing={false}
      testResult={null}
      onTestConnection={() => {}}
    />,
  );
  return onChange;
}

describe('AudiobookshelfSection: ebook library', () => {
  it('is hidden while the scan after import is off', () => {
    renderSection(settings({ triggerScanAfterImport: false }));

    expect(screen.queryByLabelText('Ebook Library')).not.toBeInTheDocument();
  });

  it('shows with the scan on, defaulting to the audiobook library', () => {
    renderSection(settings({ triggerScanAfterImport: true }));

    const select = screen.getByLabelText('Ebook Library') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(screen.getByRole('option', { name: 'Same as audiobook library' })).toBeInTheDocument();
  });

  it('reports the chosen library and keeps the other settings', () => {
    const onChange = renderSection(settings({ triggerScanAfterImport: true }));

    fireEvent.change(screen.getByLabelText('Ebook Library'), { target: { value: 'abs-ebooks' } });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      audiobookshelf: expect.objectContaining({ libraryId: 'abs-audio', ebookLibraryId: 'abs-ebooks', triggerScanAfterImport: true }),
    }));
  });

  it('asks for a connection test before libraries are loaded', () => {
    renderSection(settings({ triggerScanAfterImport: true, ebookLibraryId: 'abs-ebooks' }), vi.fn(), []);

    expect(screen.queryByLabelText('Ebook Library')).not.toBeInTheDocument();
    expect(screen.getAllByText('Test your connection to load libraries.')).toHaveLength(2);
  });
});
