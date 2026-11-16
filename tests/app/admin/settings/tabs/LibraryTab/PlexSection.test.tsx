/**
 * Component: Plex Library Settings Section Tests
 * Documentation: documentation/settings-pages.md
 */

// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PlexSection } from '@/app/admin/settings/tabs/LibraryTab/PlexSection';
import type { Settings } from '@/app/admin/settings/lib/types';

const settings = {
  audibleRegion: 'us',
  audibleLanguageFilter: false,
  plex: {
    url: 'http://plex:32400',
    token: '********',
    libraryId: 'lib-1',
    triggerScanAfterImport: false,
  },
} as Settings;

describe('PlexSection: Audible region hint', () => {
  it('says the Plex library must use the Audnexus agent', () => {
    render(
      <PlexSection
        settings={settings}
        onChange={() => {}}
        onValidationChange={() => {}}
        libraries={[]}
        testing={false}
        testResult={null}
        onTestConnection={() => {}}
      />,
    );

    expect(
      screen.getByText(
        /Your Plex audiobook library must use the Audnexus agent: ReadMeABook matches books by the Audible ID it adds\./,
      ),
    ).toBeInTheDocument();
  });
});
