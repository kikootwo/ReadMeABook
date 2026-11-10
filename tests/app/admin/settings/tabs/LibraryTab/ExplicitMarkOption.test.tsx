/**
 * Component: Explicit mark option tests (#542)
 * Documentation: documentation/features/explicit-flag.md
 *
 * One switch with a short label and one line of help on the Audiobookshelf library settings;
 * off until the saved value says otherwise; a click (on the switch or its label) reports the change.
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExplicitMarkOption } from '@/app/admin/settings/tabs/LibraryTab/ExplicitMarkOption';
import { AudiobookshelfSection } from '@/app/admin/settings/tabs/LibraryTab/AudiobookshelfSection';
import type { Settings } from '@/app/admin/settings/lib/types';

const settings = (explicitMarkEnabled?: boolean) => ({
  audibleRegion: 'us',
  audibleLanguageFilter: false,
  audiobookshelf: { serverUrl: 'http://abs', apiToken: 't', libraryId: 'lib', triggerScanAfterImport: false, tagRequester: false, explicitMarkEnabled },
}) as unknown as Settings;

const toggle = () => screen.getByRole('switch', { name: 'Explicit mark on requests' });

describe('ExplicitMarkOption (#542)', () => {
  it('off when unset; one line of help describes it', () => {
    render(<ExplicitMarkOption settings={settings(undefined)} onChange={vi.fn()} />);

    expect(toggle()).toHaveAttribute('aria-checked', 'false');
    expect(toggle()).toHaveAccessibleDescription(
      "Adds an Explicit checkbox to requests. ReadMeABook turns on a marked book's Explicit flag in Audiobookshelf."
    );
  });

  it.each([[false, true], [true, false]])('saved %s: a click reports %s, keeping the other fields', (saved, next) => {
    const onChange = vi.fn();
    render(<ExplicitMarkOption settings={settings(saved)} onChange={onChange} />);

    expect(toggle()).toHaveAttribute('aria-checked', String(saved));
    fireEvent.click(toggle());

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ audiobookshelf: expect.objectContaining({ explicitMarkEnabled: next, libraryId: 'lib' }) }));
  });

  it('a click on the label toggles once', () => {
    const onChange = vi.fn();
    render(<ExplicitMarkOption settings={settings(false)} onChange={onChange} />);

    fireEvent.click(screen.getByText('Explicit mark on requests'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ audiobookshelf: expect.objectContaining({ explicitMarkEnabled: true }) }));
  });

  it('sits in the Audiobookshelf library settings', () => {
    render(
      <AudiobookshelfSection
        settings={settings(true)}
        onChange={() => {}}
        onValidationChange={() => {}}
        libraries={[]}
        testing={false}
        testResult={null}
        onTestConnection={() => {}}
      />,
    );

    expect(toggle()).toHaveAttribute('aria-checked', 'true');
  });
});
