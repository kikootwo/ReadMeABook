/**
 * Component: Frontend Test Render Helpers
 * Documentation: documentation/frontend/components.md
 */

import React from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { SWRConfig, type SWRConfiguration } from 'swr';
import { resetMockAuthState, setMockAuthState, type MockUser } from './mock-auth';
import { resetMockRouter, setMockPathname, setMockSearchParams } from './mock-next-navigation';

type RenderWithProvidersOptions = Omit<RenderOptions, 'wrapper'> & {
  auth?: Partial<{
    user: MockUser | null;
    accessToken: string | null;
    isLoading: boolean;
    login: (pinId: number) => Promise<void>;
    logout: () => void;
    refreshToken: () => Promise<void>;
    setAuthData: (user: MockUser, accessToken: string) => void;
  }>;
  pathname?: string;
  searchParams?: string | URLSearchParams;
  swr?: SWRConfiguration;
  wrapper?: React.ComponentType<{ children: React.ReactNode }>;
};

const createWrapper = (
  swr: SWRConfiguration | undefined,
  Wrapper: RenderWithProvidersOptions['wrapper']
) => {
  return function WrapperComponent({ children }: { children: React.ReactNode }) {
    const content = Wrapper ? <Wrapper>{children}</Wrapper> : children;

    return (
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, ...swr }}>
        {content}
      </SWRConfig>
    );
  };
};

export const renderWithProviders = (
  ui: React.ReactElement,
  options: RenderWithProvidersOptions = {}
) => {
  resetMockAuthState();
  resetMockRouter();

  if (options.auth) {
    setMockAuthState(options.auth);
  }

  if (options.pathname) {
    setMockPathname(options.pathname);
  }

  if (options.searchParams) {
    setMockSearchParams(options.searchParams);
  }

  const { wrapper, swr, ...renderOptions } = options;

  return render(ui, {
    wrapper: createWrapper(swr, wrapper),
    ...renderOptions,
  });
};
