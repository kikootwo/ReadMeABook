/**
 * Component: Audible Language Filter Option Tests (#259)
 * Documentation: documentation/integrations/audible-language-filter.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AudibleLanguageFilterOption } from '@/app/admin/settings/tabs/LibraryTab/AudibleLanguageFilterOption';
import type { Settings } from '@/app/admin/settings/lib/types';

const settings = (overrides: Partial<Settings>) => ({ audibleRegion: 'us', audibleLanguageFilter: false, ...overrides }) as Settings;

describe('AudibleLanguageFilterOption', () => {
  it.each([['us', 'English'], ['fr', 'French'], ['de', 'German'], ['es', 'Spanish'], ['it', 'Italian']])(
    'region %s names %s',
    (region, language) => {
      render(<AudibleLanguageFilterOption settings={settings({ audibleRegion: region })} onChange={() => {}} />);

      expect(screen.getByRole('checkbox', { name: new RegExp(`^Only show books in ${language}`) })).toBeInTheDocument();
    },
  );

  it('an unknown region falls back to the default region language', () => {
    render(<AudibleLanguageFilterOption settings={settings({ audibleRegion: 'zz' })} onChange={() => {}} />);

    expect(screen.getByText('Only show books in English')).toBeInTheDocument();
  });

  it('reflects the stored value and reports a toggle', () => {
    const onChange = vi.fn();
    render(<AudibleLanguageFilterOption settings={settings({ audibleLanguageFilter: false })} onChange={onChange} />);
    const box = screen.getByRole('checkbox');

    expect(box).not.toBeChecked();
    fireEvent.click(box);

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ audibleRegion: 'us', audibleLanguageFilter: true }));
  });

  it('states what the filter covers and what it leaves alone', () => {
    render(<AudibleLanguageFilterOption settings={settings({})} onChange={() => {}} />);

    const help = screen.getByRole('checkbox').closest('label')?.textContent?.replace(/\s+/g, ' ');
    expect(help).toContain('Search and series hide other-language editions and show how many they hid;');
    expect(help).toContain('the home page rows leave them out from their next refresh.');
    expect(help).not.toContain('home page rows hide');
    expect(help).toContain('Books with no language listed still show.');
    expect(help).toContain('BookDate, shelf sync and watched series skip other-language editions and request nothing for them.');
    expect(help).not.toContain('are kept');
    expect(screen.getByText(/Bulk import and requests made from a book page are not affected/)).toBeInTheDocument();
  });
});
