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

  it('says what it exposes and how a removed tag behaves, in two paragraphs', () => {
    render(<RequesterTagOption settings={settings(false)} onChange={() => {}} />);

    expect(text()).toContain('When a requested audiobook becomes available, ReadMeABook adds req:<username> to its Audiobookshelf item, keeping its other tags, so Audiobookshelf can limit each user to their own books. Turning this on also tags books already available; turning it off removes no tags.');
    expect(text()).toContain('Every user of this Audiobookshelf library can see all requesters\' usernames in its tag filter. OIDC users without a username are tagged with their email address (req:johnsmithexamplecom) or sign-in ID. While this is on, a removed req: tag comes back on the next scan; to hide a book from one user, change their access in Audiobookshelf.');
    expect(document.querySelectorAll('p')).toHaveLength(2);
  });

  it('the label is the title only; the help text describes the checkbox and is not a tap target', () => {
    const onChange = vi.fn();
    render(<RequesterTagOption settings={settings(false)} onChange={onChange} />);
    const box = screen.getByRole('checkbox');

    expect(box).toHaveAccessibleName('Tag items with the requester\'s username');
    expect(box).toHaveAccessibleDescription(/Every user of this Audiobookshelf library can see all requesters' usernames/);
    fireEvent.click(screen.getByText(/Every user of this Audiobookshelf library/));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Tag items with the requester\'s username'));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('while ticked, the amber box lists shared tags, pending lookalikes, untaggable names and deleted overlaps', () => {
    render(<RequesterTagOption settings={settings(true)} onChange={() => {}} />);
    const box = screen.getByTestId('requester-tag-warnings');
    const boxText = box.textContent?.replace(/\s+/g, ' ');

    expect(box.className).toContain('bg-amber-50');
    expect(boxText).toContain('req:johnsmith is shared by "john.smith", "johnsmith": neither is tagged.');
    expect(boxText).toContain('req:bob is also the tag of pending user "bob.": if you approve them, neither is tagged.');
    expect(boxText).toContain(`"李雷" can't be turned into a tag and is never tagged.`);
    expect(boxText).toContain('req:carol (user "carol") is also the tag of deleted user "carol"; books tagged for them still carry it.');
    expect(boxText).toContain('give those users\' books a tag of your own in Audiobookshelf, not the shared one, which would show the book to every user who has it.');
  });

  it('three names on one tag: none of them is tagged', () => {
    const shared = [{ tag: 'req:ann', usernames: ['ann', 'Ann', 'ann.'] }];
    render(<RequesterTagOption settings={settings(true, { ...WARNINGS, shared })} onChange={() => {}} />);

    expect(screen.getByTestId('requester-tag-warnings').textContent).toContain('req:ann is shared by "ann", "Ann", "ann.": none of them is tagged.');
  });

  it('the closing advice fits the case: untaggable names only get a tag of your own; lookalikes and deleted overlaps get none', () => {
    const none = { shared: [], lookalikes: [], untaggable: [], deletedOverlaps: [] };
    const { rerender } = render(<RequesterTagOption settings={settings(true, { ...none, untaggable: ['李雷'] })} onChange={() => {}} />);
    const advice = () => screen.queryByTestId('requester-tag-advice')?.textContent?.replace(/\s+/g, ' ');

    expect(advice()).toContain('give those users\' books a tag of your own in Audiobookshelf.');
    expect(advice()).not.toContain('shared');

    rerender(<RequesterTagOption settings={settings(true, { ...none, lookalikes: WARNINGS.lookalikes, deletedOverlaps: WARNINGS.deletedOverlaps })} onChange={() => {}} />);
    expect(screen.getByTestId('requester-tag-warnings')).toBeTruthy();
    expect(advice()).toBeUndefined();
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
