/**
 * Component: BookDate Page Tests
 * Documentation: documentation/features/bookdate.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMockRouter, routerMock } from '../helpers/mock-next-navigation';

vi.mock('@/components/layout/Header', () => ({
  Header: () => <div data-testid="header" />,
}));

vi.mock('@/components/bookdate/LoadingScreen', () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}));

vi.mock('@/components/bookdate/SettingsWidget', () => ({
  SettingsWidget: ({
    isOpen,
    isOnboarding,
    onOnboardingComplete,
  }: {
    isOpen: boolean;
    isOnboarding: boolean;
    onOnboardingComplete: () => void;
  }) => (
    <div data-testid="settings-widget" data-open={String(isOpen)} data-onboarding={String(isOnboarding)}>
      <button type="button" onClick={onOnboardingComplete}>
        Finish Onboarding
      </button>
    </div>
  ),
}));

vi.mock('@/components/bookdate/CardStack', () => ({
  CardStack: ({
    recommendations,
    onSwipe,
    onSwipeComplete,
  }: {
    recommendations: any[];
    onSwipe: (action: 'left' | 'right' | 'up', markedAsKnown?: boolean) => void;
    onSwipeComplete: () => void;
  }) => (
    <div>
      <div data-testid="card-count">{recommendations.length}</div>
      <button
        type="button"
        onClick={() => {
          onSwipe('left');
          onSwipeComplete();
        }}
      >
        Swipe Left
      </button>
      <button
        type="button"
        onClick={() => {
          onSwipe('right');
          onSwipeComplete();
        }}
      >
        Swipe Right
      </button>
    </div>
  ),
}));

const makeJsonResponse = (body: any, ok: boolean = true) => ({
  ok,
  status: ok ? 200 : 500,
  json: async () => body,
});

describe('BookDatePage', () => {
  beforeEach(() => {
    resetMockRouter();
    localStorage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('redirects to login when no access token is available', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { default: BookDatePage } = await import('@/app/bookdate/page');
    render(<BookDatePage />);

    await waitFor(() => {
      expect(routerMock.push).toHaveBeenCalledWith('/login');
    });
  });

  it('shows onboarding settings when onboarding is incomplete', async () => {
    localStorage.setItem('accessToken', 'token');

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === '/api/bookdate/preferences') {
        return makeJsonResponse({ onboardingComplete: false });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { default: BookDatePage } = await import('@/app/bookdate/page');
    render(<BookDatePage />);

    expect(await screen.findByText('Welcome to BookDate!')).toBeInTheDocument();
    expect(screen.getByTestId('settings-widget')).toHaveAttribute('data-open', 'true');
  });

  it('renders an error state when recommendations fetch fails', async () => {
    localStorage.setItem('accessToken', 'token');

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === '/api/bookdate/preferences') {
        return makeJsonResponse({ onboardingComplete: true });
      }
      if (url === '/api/bookdate/recommendations') {
        return makeJsonResponse({ error: 'bad' }, false);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { default: BookDatePage } = await import('@/app/bookdate/page');
    render(<BookDatePage />);

    expect(await screen.findByText(/Could not load recommendations/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));

    await waitFor(() => {
      const recCalls = fetchMock.mock.calls.filter(([input]) => String(input).includes('/api/bookdate/recommendations'));
      expect(recCalls.length).toBeGreaterThan(1);
    });
  });

  it('shows empty state and triggers recommendation generation', async () => {
    localStorage.setItem('accessToken', 'token');

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === '/api/bookdate/preferences') {
        return makeJsonResponse({ onboardingComplete: true });
      }
      if (url === '/api/bookdate/recommendations') {
        return makeJsonResponse({ recommendations: [] });
      }
      if (url === '/api/bookdate/generate') {
        return makeJsonResponse({ recommendations: [{ id: 'rec-1' }] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { default: BookDatePage } = await import('@/app/bookdate/page');
    render(<BookDatePage />);

    const generateButton = await screen.findByRole('button', { name: 'Get More Recommendations' });
    fireEvent.click(generateButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/bookdate/generate',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  it('posts swipes and shows undo option', async () => {
    localStorage.setItem('accessToken', 'token');

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === '/api/bookdate/preferences') {
        return makeJsonResponse({ onboardingComplete: true });
      }
      if (url === '/api/bookdate/recommendations') {
        return makeJsonResponse({ recommendations: [{ id: 'rec-1' }, { id: 'rec-2' }] });
      }
      if (url === '/api/bookdate/swipe') {
        return makeJsonResponse({ success: true });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { default: BookDatePage } = await import('@/app/bookdate/page');
    render(<BookDatePage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Swipe Left' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/bookdate/swipe',
        expect.objectContaining({ method: 'POST' })
      );
    });

    expect(await screen.findByRole('button', { name: /Undo/i })).toBeInTheDocument();
  });

  it('opens settings when the settings button is clicked', async () => {
    localStorage.setItem('accessToken', 'token');

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === '/api/bookdate/preferences') {
        return makeJsonResponse({ onboardingComplete: true });
      }
      if (url === '/api/bookdate/recommendations') {
        return makeJsonResponse({ recommendations: [{ id: 'rec-1' }] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { default: BookDatePage } = await import('@/app/bookdate/page');
    render(<BookDatePage />);

    expect(await screen.findByTestId('card-count')).toHaveTextContent('1');
    expect(screen.getByTestId('settings-widget')).toHaveAttribute('data-open', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));

    expect(screen.getByTestId('settings-widget')).toHaveAttribute('data-open', 'true');
  });

  it('undoes a swipe and reloads recommendations', async () => {
    localStorage.setItem('accessToken', 'token');
    let recommendationsCall = 0;

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === '/api/bookdate/preferences') {
        return makeJsonResponse({ onboardingComplete: true });
      }
      if (url === '/api/bookdate/recommendations') {
        recommendationsCall += 1;
        if (recommendationsCall === 1) {
          return makeJsonResponse({ recommendations: [{ id: 'rec-1' }, { id: 'rec-2' }] });
        }
        return makeJsonResponse({ recommendations: [{ id: 'rec-restored' }] });
      }
      if (url === '/api/bookdate/swipe') {
        return makeJsonResponse({ success: true });
      }
      if (url === '/api/bookdate/undo') {
        return makeJsonResponse({ success: true });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { default: BookDatePage } = await import('@/app/bookdate/page');
    render(<BookDatePage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Swipe Left' }));

    const undoButton = await screen.findByRole('button', { name: /Undo/i });
    fireEvent.click(undoButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/bookdate/undo',
        expect.objectContaining({ method: 'POST' })
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('card-count')).toHaveTextContent('1');
    });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Undo/i })).toBeNull();
    });
  });
});
