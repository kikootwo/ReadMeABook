/**
 * Component: Auth Context Test Mock
 * Documentation: documentation/frontend/routing-auth.md
 */

import React from 'react';
import { vi } from 'vitest';

export interface MockUser {
  id: string;
  plexId: string;
  username: string;
  role: string;
  email?: string;
  avatarUrl?: string;
  authProvider?: string | null;
}

const authState = vi.hoisted(() => ({
  user: null as MockUser | null,
  accessToken: null as string | null,
  isLoading: false,
  login: vi.fn(),
  logout: vi.fn(),
  refreshToken: vi.fn(),
  setAuthData: vi.fn(),
}));

export const setMockAuthState = (overrides: Partial<typeof authState>) => {
  Object.assign(authState, overrides);
};

export const resetMockAuthState = () => {
  authState.user = null;
  authState.accessToken = null;
  authState.isLoading = false;
  authState.login.mockReset();
  authState.logout.mockReset();
  authState.refreshToken.mockReset();
  authState.setAuthData.mockReset();
};

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => authState,
  AuthProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));
