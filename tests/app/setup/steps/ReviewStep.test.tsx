/**
 * Component: Setup Review Step Tests
 * Documentation: documentation/setup-wizard.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReviewStep } from '@/app/setup/steps/ReviewStep';

const baseConfig = {
  backendMode: 'plex' as const,
  plexUrl: 'http://plex.local',
  plexLibraryId: 'plex-lib',
  absUrl: 'http://abs.local',
  absLibraryId: 'abs-lib',
  authMethod: 'oidc' as const,
  oidcProviderName: 'Auth',
  adminUsername: 'admin',
  prowlarrUrl: 'http://prowlarr.local',
  downloadClient: 'qbittorrent' as const,
  downloadClientUrl: 'http://qb.local',
  downloadDir: '/downloads',
  mediaDir: '/media',
  bookdateConfigured: true,
  bookdateProvider: 'openai',
  bookdateModel: 'model-1',
};

describe('ReviewStep', () => {
  it('renders Plex configuration and triggers actions', async () => {
    const onComplete = vi.fn();
    const onBack = vi.fn();

    render(
      <ReviewStep
        config={baseConfig}
        loading={false}
        error={null}
        onComplete={onComplete}
        onBack={onBack}
      />
    );

    expect(screen.getByText('Plex Media Server')).toBeInTheDocument();
    expect(screen.getByText('BookDate AI Recommendations')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Complete Setup' }));

    expect(onBack).toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalled();
  });

  it('renders Audiobookshelf config and error state', async () => {
    render(
      <ReviewStep
        config={{ ...baseConfig, backendMode: 'audiobookshelf', authMethod: 'both' }}
        loading={false}
        error="Something went wrong"
        onComplete={vi.fn()}
        onBack={vi.fn()}
      />
    );

    expect(screen.getByText('Audiobookshelf')).toBeInTheDocument();
    expect(screen.getByText('OIDC + Manual Registration')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });
});
