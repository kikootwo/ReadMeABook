/**
 * Component: Setup Wizard Layout Tests
 * Documentation: documentation/setup-wizard.md
 */

// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

describe('WizardLayout', () => {
  it('renders Plex steps and footer progress', async () => {
    const { WizardLayout } = await import('@/app/setup/components/WizardLayout');

    render(
      <WizardLayout currentStep={3} totalSteps={10} backendMode="plex">
        <div>Content</div>
      </WizardLayout>
    );

    expect(screen.getByText('ReadMeABook Setup')).toBeInTheDocument();
    expect(screen.getByText('Plex')).toBeInTheDocument();
    expect(screen.getByText('Finalize')).toBeInTheDocument();
    expect(screen.getByText('Step 3 of 10')).toBeInTheDocument();
  });

  it('renders Audiobookshelf steps based on auth method', async () => {
    const { WizardLayout } = await import('@/app/setup/components/WizardLayout');

    render(
      <WizardLayout currentStep={2} totalSteps={8} backendMode="audiobookshelf" authMethod="oidc">
        <div>Content</div>
      </WizardLayout>
    );

    expect(screen.getByText('ABS')).toBeInTheDocument();
    expect(screen.getByText('Auth')).toBeInTheDocument();
    expect(screen.getByText('OIDC')).toBeInTheDocument();
    expect(screen.queryByText('Registration')).toBeNull();
    expect(screen.queryByText('Admin')).toBeNull();
  });
});
