/**
 * Component: Admin Users Page, Add User Tests
 * Documentation: documentation/admin-dashboard.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminUsersPage from '@/app/admin/users/page';

const fetchJSONMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
const swrState = new Map<string, { data?: unknown; error?: unknown; mutate: ReturnType<typeof vi.fn> }>();

vi.mock('swr', () => ({
  default: (key: string) => swrState.get(key) || { data: undefined, error: undefined, mutate: vi.fn() },
}));
vi.mock('@/lib/utils/api', () => ({ authenticatedFetcher: vi.fn(), fetchJSON: fetchJSONMock }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
vi.mock('@/components/ui/Toast', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: () => toastMock,
}));

function setup(localLoginEnabled: boolean | undefined) {
  const mutateUsers = vi.fn();
  swrState.set('/api/admin/users', {
    data: {
      users: [{
        id: 'me', plexUsername: 'admin', plexId: 'local-admin', role: 'admin', isSetupAdmin: true,
        authProvider: 'local', plexEmail: null, avatarUrl: null, createdAt: '', updatedAt: '',
        lastLoginAt: null, autoApproveRequests: null, interactiveSearchAccess: null, _count: { requests: 0 },
      }],
      ...(localLoginEnabled !== undefined && { localLoginEnabled }),
    },
    mutate: mutateUsers,
  });
  swrState.set('/api/admin/users/pending', { data: { users: [] }, mutate: vi.fn() });
  swrState.set('/api/admin/settings/auto-approve', { data: { autoApproveRequests: false }, mutate: vi.fn() });
  swrState.set('/api/admin/settings/interactive-search', { data: { interactiveSearchAccess: true }, mutate: vi.fn() });
  return { mutateUsers };
}

describe('AdminUsersPage add user', () => {
  beforeEach(() => {
    swrState.clear();
    fetchJSONMock.mockReset();
    toastMock.success.mockReset();
  });

  it.each([
    ['off', false],
    ['not reported', undefined],
  ])('hides Add User while local login is %s', (_label, enabled) => {
    setup(enabled);
    render(<AdminUsersPage />);

    expect(screen.getByText('User Management')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add User' })).not.toBeInTheDocument();
  });

  it('adds a user from the header button: dialog closes, toast names the user, list refreshes', async () => {
    const { mutateUsers } = setup(true);
    fetchJSONMock.mockResolvedValue({ user: { plexUsername: 'newreader' } });
    render(<AdminUsersPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Add User' }));
    const dialog = screen.getByRole('dialog', { name: 'Add User' });

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'NewReader' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'password123' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add User' }));

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('User "newreader" added'));
    expect(mutateUsers).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Cancel closes the dialog without a request', () => {
    setup(true);
    render(<AdminUsersPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Add User' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetchJSONMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Add User' })).toHaveFocus();
  });

  it('returns focus to Add User after adding', async () => {
    setup(true);
    fetchJSONMock.mockResolvedValue({ user: { plexUsername: 'newreader' } });
    render(<AdminUsersPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Add User' }));
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'newreader' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'password123' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add User' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Add User' })).toHaveFocus();
  });

  it('lets the header actions wrap so a narrow screen never scrolls sideways', () => {
    setup(true);
    render(<AdminUsersPage />);

    expect(screen.getByRole('button', { name: 'Add User' }).parentElement).toHaveClass('flex-wrap');
  });
});
