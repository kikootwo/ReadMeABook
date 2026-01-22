/**
 * Component: Protected Route Component Tests
 * Documentation: documentation/frontend/routing-auth.md
 */

// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../helpers/render';
import { routerMock } from '../../helpers/mock-next-navigation';

describe('ProtectedRoute', () => {
  let ProtectedRoute: typeof import('@/components/auth/ProtectedRoute').ProtectedRoute;

  beforeAll(async () => {
    ({ ProtectedRoute } = await import('@/components/auth/ProtectedRoute'));
  });

  it('shows loading state while auth is initializing', async () => {
    renderWithProviders(
      <ProtectedRoute>
        <div>Protected Content</div>
      </ProtectedRoute>,
      { auth: { isLoading: true } }
    );

    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('redirects unauthenticated users to login with return URL', async () => {
    renderWithProviders(
      <ProtectedRoute>
        <div>Protected Content</div>
      </ProtectedRoute>,
      { auth: { user: null, isLoading: false }, pathname: '/requests' }
    );

    await waitFor(() => {
      expect(routerMock.push).toHaveBeenCalledWith('/login?redirect=%2Frequests');
    });
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('redirects non-admin users when admin access is required', async () => {
    renderWithProviders(
      <ProtectedRoute requireAdmin>
        <div>Admin Content</div>
      </ProtectedRoute>,
      {
        auth: {
          user: {
            id: 'user-1',
            plexId: 'plex-1',
            username: 'reader',
            role: 'user',
          },
          isLoading: false,
        },
      }
    );

    await waitFor(() => {
      expect(routerMock.push).toHaveBeenCalledWith('/');
    });
    expect(screen.queryByText('Admin Content')).not.toBeInTheDocument();
  });

  it('renders children for authenticated admins', async () => {
    renderWithProviders(
      <ProtectedRoute requireAdmin>
        <div>Admin Content</div>
      </ProtectedRoute>,
      {
        auth: {
          user: {
            id: 'admin-1',
            plexId: 'plex-1',
            username: 'admin',
            role: 'admin',
          },
          isLoading: false,
        },
      }
    );

    expect(screen.getByText('Admin Content')).toBeInTheDocument();
  });
});
