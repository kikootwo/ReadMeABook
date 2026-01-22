/**
 * Component: Admin Users Page Tests
 * Documentation: documentation/admin-dashboard.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminUsersPage from '@/app/admin/users/page';

const fetchJSONMock = vi.hoisted(() => vi.fn());
const authenticatedFetcherMock = vi.hoisted(() => vi.fn());

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

const swrState = new Map<string, { data?: any; error?: any; mutate: ReturnType<typeof vi.fn> }>();

vi.mock('swr', () => ({
  default: (key: string) => {
    return swrState.get(key) || { data: undefined, error: undefined, mutate: vi.fn() };
  },
}));

vi.mock('@/lib/utils/api', () => ({
  authenticatedFetcher: authenticatedFetcherMock,
  fetchJSON: fetchJSONMock,
}));

vi.mock('@/components/ui/Toast', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: () => toastMock,
}));

describe('AdminUsersPage', () => {
  beforeEach(() => {
    swrState.clear();
    fetchJSONMock.mockReset();
    toastMock.success.mockReset();
    toastMock.error.mockReset();
  });

  it('toggles global auto-approve and persists setting', async () => {
    const mutateUsers = vi.fn();
    const mutatePending = vi.fn();
    const mutateGlobal = vi.fn();

    swrState.set('/api/admin/users', {
      data: { users: [{ id: 'u1', plexUsername: 'User', plexId: 'plex-1', role: 'user', isSetupAdmin: false, authProvider: 'local', plexEmail: null, avatarUrl: null, createdAt: '', updatedAt: '', lastLoginAt: null, autoApproveRequests: false, _count: { requests: 0 } }] },
      mutate: mutateUsers,
    });
    swrState.set('/api/admin/users/pending', { data: { users: [] }, mutate: mutatePending });
    swrState.set('/api/admin/settings/auto-approve', { data: { autoApproveRequests: false }, mutate: mutateGlobal });

    fetchJSONMock.mockResolvedValueOnce({ success: true });

    render(<AdminUsersPage />);

    fireEvent.click(await screen.findByText('Auto-Approve All Requests'));

    await waitFor(() => {
      expect(fetchJSONMock).toHaveBeenCalledWith('/api/admin/settings/auto-approve', {
        method: 'PATCH',
        body: JSON.stringify({ autoApproveRequests: true }),
      });
      expect(mutateGlobal).toHaveBeenCalled();
      expect(mutateUsers).toHaveBeenCalled();
    });
  });

  it('edits a user role and saves changes', async () => {
    const mutateUsers = vi.fn();

    swrState.set('/api/admin/users', {
      data: {
        users: [
          {
            id: 'u2',
            plexUsername: 'LocalUser',
            plexId: 'local-1',
            role: 'user',
            isSetupAdmin: false,
            authProvider: 'local',
            plexEmail: 'local@example.com',
            avatarUrl: null,
            createdAt: '',
            updatedAt: '',
            lastLoginAt: null,
            autoApproveRequests: false,
            _count: { requests: 2 },
          },
        ],
      },
      mutate: mutateUsers,
    });
    swrState.set('/api/admin/users/pending', { data: { users: [] }, mutate: vi.fn() });
    swrState.set('/api/admin/settings/auto-approve', { data: { autoApproveRequests: true }, mutate: vi.fn() });

    fetchJSONMock.mockResolvedValueOnce({ success: true });

    render(<AdminUsersPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Role' }));
    fireEvent.click(screen.getByRole('radio', { name: /Admin/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(fetchJSONMock).toHaveBeenCalledWith('/api/admin/users/u2', {
        method: 'PUT',
        body: JSON.stringify({ role: 'admin' }),
      });
      expect(mutateUsers).toHaveBeenCalled();
    });
  });

  it('approves a pending user and refreshes lists', async () => {
    const mutateUsers = vi.fn();
    const mutatePending = vi.fn();

    swrState.set('/api/admin/users', { data: { users: [] }, mutate: mutateUsers });
    swrState.set('/api/admin/users/pending', {
      data: {
        users: [{ id: 'p1', plexUsername: 'Pending', plexEmail: null, authProvider: 'local', createdAt: new Date().toISOString() }],
      },
      mutate: mutatePending,
    });
    swrState.set('/api/admin/settings/auto-approve', { data: { autoApproveRequests: true }, mutate: vi.fn() });

    fetchJSONMock.mockResolvedValueOnce({ success: true });

    render(<AdminUsersPage />);

    const approveButtons = await screen.findAllByRole('button', { name: 'Approve' });
    fireEvent.click(approveButtons[0]);

    const confirmButtons = await screen.findAllByRole('button', { name: 'Approve' });
    fireEvent.click(confirmButtons[1]);

    await waitFor(() => {
      expect(fetchJSONMock).toHaveBeenCalledWith('/api/admin/users/p1/approve', {
        method: 'POST',
        body: JSON.stringify({ approve: true }),
      });
      expect(mutatePending).toHaveBeenCalled();
    });
  });
});
