/**
 * Component: Requester tag option tests (#232)
 * Documentation: documentation/features/requester-tags.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RequesterTagOption } from '@/app/admin/settings/tabs/LibraryTab/RequesterTagOption';
import { AudiobookshelfSection } from '@/app/admin/settings/tabs/LibraryTab/AudiobookshelfSection';
import type { Settings } from '@/app/admin/settings/lib/types';

const WARNINGS = {
  shared: [{ tag: 'req:johnsmith', usernames: ['john.smith', 'johnsmith'] }],
  lookalikes: [{ tag: 'req:bob', username: 'bob.', status: 'pending_approval', matches: ['bob'] }],
  untaggable: ['李雷'],
  deletedOverlaps: [{ tag: 'req:carol', username: 'carol', deletedUsernames: ['carol'] }],
};

const settings = (tagRequester: boolean, requesterTagWarnings = WARNINGS) => ({
  audibleRegion: 'us',
  audibleLanguageFilter: false,
  audiobookshelf: { serverUrl: 'http://abs', apiToken: 't', libraryId: 'lib', triggerScanAfterImport: false, tagRequester, requesterTagWarnings },
}) as unknown as Settings;

const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';

describe('RequesterTagOption (#232)', () => {
  it('reflects the saved value and reports a toggle', () => {
    const onChange = vi.fn();
    render(<RequesterTagOption settings={settings(false)} onChange={onChange} />);
    const box = screen.getByRole('checkbox', { name: /Tag items with the requester's username/ });

    expect(box).not.toBeChecked();
    fireEvent.click(box);

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ audiobookshelf: expect.objectContaining({ tagRequester: true, libraryId: 'lib' }) }));
  });

  it('says what it exposes and how a removed tag behaves', () => {
    render(<RequesterTagOption settings={settings(false)} onChange={() => {}} />);

    expect(text()).toContain('adds a req:<username> tag to its Audiobookshelf item and keeps the item\'s other tags');
    expect(text()).toContain('Every Audiobookshelf user with access to this library can see these tags, including the full list in its tag filter.');
    expect(text()).toContain('tagged with their email address (for example req:johnsmithexamplecom), or their sign-in ID when there is no email.');
    expect(text()).toContain('a req: tag removed in Audiobookshelf comes back on the next library scan; to take a book away from one user, turn this off or change that user\'s access in Audiobookshelf.');
    expect(text()).toContain('Turning this on also tags books that are already available. Turning it off doesn\'t remove tags already written.');
  });

  it('while ticked, the amber box lists shared tags, pending lookalikes, untaggable names and deleted overlaps', () => {
    render(<RequesterTagOption settings={settings(true)} onChange={() => {}} />);
    const box = screen.getByTestId('requester-tag-warnings');
    const boxText = box.textContent?.replace(/\s+/g, ' ');

    expect(box.className).toContain('bg-amber-50');
    expect(boxText).toContain('req:johnsmith is shared by "john.smith", "johnsmith": none of them is tagged.');
    expect(boxText).toContain('req:bob is also the tag of pending user "bob.": if you approve them, neither is tagged.');
    expect(boxText).toContain('"李雷" has no letters or digits a tag can use and is never tagged.');
    expect(boxText).toContain('req:carol (user "carol") is also the tag of deleted user "carol"; books tagged for them still carry it.');
    expect(boxText).toContain('tag those users\' books in Audiobookshelf by hand');
  });

  it('hidden while unticked, and when there is nothing to warn about', () => {
    const { rerender } = render(<RequesterTagOption settings={settings(false)} onChange={() => {}} />);
    expect(screen.queryByTestId('requester-tag-warnings')).toBeNull();

    rerender(<RequesterTagOption settings={settings(true, { shared: [], lookalikes: [], untaggable: [], deletedOverlaps: [] })} onChange={() => {}} />);
    expect(screen.queryByTestId('requester-tag-warnings')).toBeNull();
  });

  it('is part of the Audiobookshelf library section', () => {
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

    expect(screen.getByRole('checkbox', { name: /Tag items with the requester's username/ })).toBeChecked();
  });
});
