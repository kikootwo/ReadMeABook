/**
 * Component: Setup Wizard Page Tests
 * Documentation: documentation/setup-wizard.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'path';
import { resetMockRouter } from '../helpers/mock-next-navigation';

const mockSetupModules = () => {
  vi.doMock(path.resolve('src/app/setup/components/WizardLayout.tsx'), () => ({
    WizardLayout: ({
      children,
      currentStep,
      totalSteps,
    }: {
      children: React.ReactNode;
      currentStep: number;
      totalSteps: number;
    }) => (
      <div data-testid="wizard" data-step={currentStep} data-total={totalSteps}>
        {children}
      </div>
    ),
  }));

  vi.doMock(path.resolve('src/app/setup/steps/WelcomeStep.tsx'), () => ({
    WelcomeStep: ({ onNext }: { onNext: () => void }) => (
      <button type="button" onClick={onNext}>
        Next
      </button>
    ),
  }));

  vi.doMock(path.resolve('src/app/setup/steps/BackendSelectionStep.tsx'), () => ({
    BackendSelectionStep: ({
      onNext,
      onChange,
    }: {
      onNext: () => void;
      onChange: (value: 'plex' | 'audiobookshelf') => void;
    }) => (
      <div>
        <button type="button" onClick={() => onChange('plex')}>
          Choose Plex
        </button>
        <button type="button" onClick={() => onChange('audiobookshelf')}>
          Choose ABS
        </button>
        <button type="button" onClick={onNext}>
          Next
        </button>
      </div>
    ),
  }));

  vi.doMock(path.resolve('src/app/setup/steps/AdminAccountStep.tsx'), () => ({
    AdminAccountStep: ({ onNext }: { onNext: () => void }) => (
      <button type="button" onClick={onNext}>
        Next
      </button>
    ),
  }));

  vi.doMock(path.resolve('src/app/setup/steps/PlexStep.tsx'), () => ({
    PlexStep: ({ onNext }: { onNext: () => void }) => (
      <button type="button" onClick={onNext}>
        Next
      </button>
    ),
  }));

  vi.doMock(path.resolve('src/app/setup/steps/AudiobookshelfStep.tsx'), () => ({
    AudiobookshelfStep: ({ onNext }: { onNext: () => void }) => (
      <button type="button" onClick={onNext}>
        Next
      </button>
    ),
  }));

  vi.doMock(path.resolve('src/app/setup/steps/AuthMethodStep.tsx'), () => ({
    AuthMethodStep: ({
      onNext,
      onChange,
    }: {
      onNext: () => void;
      onChange: (value: 'oidc' | 'manual' | 'both') => void;
    }) => (
      <div>
        <button type="button" onClick={() => onChange('oidc')}>
          Choose OIDC
        </button>
        <button type="button" onClick={onNext}>
          Next
        </button>
      </div>
    ),
  }));

  vi.doMock(path.resolve('src/app/setup/steps/OIDCConfigStep.tsx'), () => ({
    OIDCConfigStep: ({ onNext }: { onNext: () => void }) => (
      <button type="button" onClick={onNext}>
        Next
      </button>
    ),
  }));

  vi.doMock(path.resolve('src/app/setup/steps/RegistrationSettingsStep.tsx'), () => ({
    RegistrationSettingsStep: ({ onNext }: { onNext: () => void }) => (
      <button type="button" onClick={onNext}>
        Next
      </button>
    ),
  }));

  vi.doMock(path.resolve('src/app/setup/steps/ProwlarrStep.tsx'), () => ({
    ProwlarrStep: ({ onNext }: { onNext: () => void }) => (
      <button type="button" onClick={onNext}>
        Next
      </button>
    ),
  }));

  vi.doMock(path.resolve('src/app/setup/steps/DownloadClientStep.tsx'), () => ({
    DownloadClientStep: ({ onNext }: { onNext: () => void }) => (
      <button type="button" onClick={onNext}>
        Next
      </button>
    ),
  }));

  vi.doMock(path.resolve('src/app/setup/steps/PathsStep.tsx'), () => ({
    PathsStep: ({ onNext }: { onNext: () => void }) => (
      <button type="button" onClick={onNext}>
        Next
      </button>
    ),
  }));

  vi.doMock(path.resolve('src/app/setup/steps/BookDateStep.tsx'), () => ({
    BookDateStep: ({ onNext }: { onNext: () => void }) => (
      <button type="button" onClick={onNext}>
        Next
      </button>
    ),
  }));

  vi.doMock(path.resolve('src/app/setup/steps/ReviewStep.tsx'), () => ({
    ReviewStep: ({ onComplete }: { onComplete: () => void }) => (
      <button type="button" onClick={onComplete}>
        Complete
      </button>
    ),
  }));

  vi.doMock(path.resolve('src/app/setup/steps/FinalizeStep.tsx'), () => ({
    FinalizeStep: ({ hasAdminTokens }: { hasAdminTokens: boolean }) => (
      <div data-testid="finalize">{hasAdminTokens ? 'admin' : 'oidc'}</div>
    ),
  }));
};

const makeJsonResponse = (body: any, ok: boolean = true) => ({
  ok,
  status: ok ? 200 : 500,
  json: async () => body,
});

describe('SetupWizard', () => {
  beforeEach(() => {
    resetMockRouter();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('completes setup in Plex mode and stores admin tokens', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === '/api/setup/complete') {
        return makeJsonResponse({
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          user: { id: 'admin-1', username: 'admin' },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    vi.resetModules();
    mockSetupModules();
    const { default: SetupWizard } = await import('@/app/setup/page');
    render(<SetupWizard />);

    for (let i = 0; i < 8; i += 1) {
      fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    }

    fireEvent.click(await screen.findByRole('button', { name: 'Complete' }));

    await waitFor(() => {
      expect(localStorage.getItem('accessToken')).toBe('access-token');
      expect(screen.getByTestId('finalize')).toHaveTextContent('admin');
    });

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(requestBody.backendMode).toBe('plex');
    expect(requestBody.admin).toBeDefined();
    expect(requestBody.plex).toBeDefined();
  });

  it('completes setup in OIDC-only mode and clears tokens', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === '/api/setup/complete') {
        return makeJsonResponse({ success: true });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('accessToken', 'stale-token');

    vi.resetModules();
    mockSetupModules();
    const { default: SetupWizard } = await import('@/app/setup/page');
    render(<SetupWizard />);

    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Choose ABS' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Choose OIDC' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    for (let i = 0; i < 5; i += 1) {
      fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    }

    fireEvent.click(await screen.findByRole('button', { name: 'Complete' }));

    await waitFor(() => {
      expect(localStorage.getItem('accessToken')).toBeNull();
      expect(screen.getByTestId('finalize')).toHaveTextContent('oidc');
    });

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(requestBody.backendMode).toBe('audiobookshelf');
    expect(requestBody.authMethod).toBe('oidc');
    expect(requestBody.audiobookshelf).toBeDefined();
    expect(requestBody.oidc).toBeDefined();
    expect(requestBody.admin).toBeUndefined();
  });
});
