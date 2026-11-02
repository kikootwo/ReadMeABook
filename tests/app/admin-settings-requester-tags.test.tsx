/**
 * Component: Audiobookshelf Settings Section - Requester Tag Warning Tests
 * Documentation: documentation/features/requester-tags.md
 */

// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AudiobookshelfSection } from '@/app/admin/settings/tabs/LibraryTab/AudiobookshelfSection';

const collisions = [{ tag: 'req:johnsmith', usernames: ['john.smith', 'johnsmith'] }];

function renderSection(tagRequester: boolean, tagCollisions = collisions) {
  const settings = {
    audibleRegion: 'us',
    audiobookshelf: {
      serverUrl: 'http://abs',
      apiToken: '',
      libraryId: '',
      triggerScanAfterImport: false,
      tagRequester,
      tagCollisions,
    },
  } as any;

  render(
    <AudiobookshelfSection
      settings={settings}
      onChange={vi.fn()}
      onValidationChange={vi.fn()}
      libraries={[]}
      testing={false}
      testResult={null}
      onTestConnection={vi.fn()}
    />
  );
}

describe('AudiobookshelfSection requester tags', () => {
  it('warns about users who would share a tag while tagging is on', () => {
    renderSection(true);

    expect(screen.getByText('Some users would share a tag')).toBeInTheDocument();
    expect(screen.getByText('req:johnsmith')).toBeInTheDocument();
    expect(screen.getByText(/john\.smith, johnsmith/)).toBeInTheDocument();
  });

  it('shows no warning while tagging is off', () => {
    renderSection(false);
    expect(screen.queryByText('Some users would share a tag')).not.toBeInTheDocument();
  });

  it('shows no warning when no tags collide', () => {
    renderSection(true, []);
    expect(screen.queryByText('Some users would share a tag')).not.toBeInTheDocument();
  });
});
