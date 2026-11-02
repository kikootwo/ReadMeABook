/**
 * Component: Admin Users Page Tests
 * Documentation: documentation/admin-dashboard.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

const authState = vi.hoisted(() => ({ userId: 'me' as string | null }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: authState.userId ? { id: authState.userId } : null }),
}));

vi.mock('@/components/ui/Toast', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: () => toastMock,
}));

const makeUser = (overrides: Record<string, any> = {}) => ({
  id: 'u1',
  plexUsername: 'TestUser',
  plexId: 'plex-1',
  role: 'user',
  isSetupAdmin: false,
  authProvider: 'local',
  plexEmail: 'test@example.com',
  avatarUrl: null,
  createdAt: '',
  updatedAt: '',
  lastLoginAt: null,
  autoApproveRequests: false,
  interactiveSearchAccess: null,
  _count: { requests: 0 },
  ...overrides,
});

/** Sets up all required SWR state for the page, with optional overrides. */
function setupSWR(opts: {
  users?: any[];
  pendingUsers?: any[];
  autoApprove?: boolean;
  interactiveSearch?: boolean;
  mutateUsers?: ReturnType<typeof vi.fn>;
  mutatePending?: ReturnType<typeof vi.fn>;
  mutateAutoApprove?: ReturnType<typeof vi.fn>;
  mutateInteractiveSearch?: ReturnType<typeof vi.fn>;
} = {}) {
  const mutateUsers = opts.mutateUsers ?? vi.fn();
  const mutatePending = opts.mutatePending ?? vi.fn();
  const mutateAutoApprove = opts.mutateAutoApprove ?? vi.fn();
  const mutateInteractiveSearch = opts.mutateInteractiveSearch ?? vi.fn();

  swrState.set('/api/admin/users', {
    data: { users: opts.users ?? [makeUser()] },
    mutate: mutateUsers,
  });
  swrState.set('/api/admin/users/pending', {
    data: { users: opts.pendingUsers ?? [] },
    mutate: mutatePending,
  });
  swrState.set('/api/admin/settings/auto-approve', {
    data: { autoApproveRequests: opts.autoApprove ?? false },
    mutate: mutateAutoApprove,
  });
  swrState.set('/api/admin/settings/interactive-search', {
    data: { interactiveSearchAccess: opts.interactiveSearch ?? true },
    mutate: mutateInteractiveSearch,
  });

  return { mutateUsers, mutatePending, mutateAutoApprove, mutateInteractiveSearch };
}

describe('AdminUsersPage', () => {
  beforeEach(() => {
    swrState.clear();
    fetchJSONMock.mockReset();
    toastMock.success.mockReset();
    toastMock.error.mockReset();
  });

  it('opens global settings modal and toggles auto-approve', async () => {
    const { mutateAutoApprove, mutateUsers } = setupSWR({ autoApprove: false });

    fetchJSONMock.mockResolvedValueOnce({ success: true });

    render(<AdminUsersPage />);

    // Open the Global Settings modal
    fireEvent.click(await screen.findByRole('button', { name: /Global.*Permissions/i }));

    // Click the toggle label inside the modal
    fireEvent.click(await screen.findByText('Auto-Approve All Requests'));

    await waitFor(() => {
      expect(fetchJSONMock).toHaveBeenCalledWith('/api/admin/settings/auto-approve', {
        method: 'PATCH',
        body: JSON.stringify({ autoApproveRequests: true }),
      });
      expect(mutateAutoApprove).toHaveBeenCalled();
      expect(mutateUsers).toHaveBeenCalled();
    });
  });

  it('opens global settings modal and toggles interactive search', async () => {
    const { mutateInteractiveSearch, mutateUsers } = setupSWR({ interactiveSearch: true });

    fetchJSONMock.mockResolvedValueOnce({ success: true });

    render(<AdminUsersPage />);

    // Open the Global Settings modal
    fireEvent.click(await screen.findByRole('button', { name: /Global.*Permissions/i }));

    // Click the interactive search toggle label inside the modal
    fireEvent.click(await screen.findByText('Interactive Search Access'));

    await waitFor(() => {
      expect(fetchJSONMock).toHaveBeenCalledWith('/api/admin/settings/interactive-search', {
        method: 'PATCH',
        body: JSON.stringify({ interactiveSearchAccess: false }),
      });
      expect(mutateInteractiveSearch).toHaveBeenCalled();
      expect(mutateUsers).toHaveBeenCalled();
    });
  });

  it('shows correct permission badges in the users table', async () => {
    setupSWR({
      users: [
        makeUser({ id: 'u-admin', plexUsername: 'AdminUser', role: 'admin' }),
        makeUser({ id: 'u-manual', plexUsername: 'ManualUser', role: 'user', autoApproveRequests: false }),
        makeUser({ id: 'u-approved', plexUsername: 'ApprovedUser', role: 'user', autoApproveRequests: true }),
      ],
      autoApprove: false,
    });

    render(<AdminUsersPage />);

    expect((await screen.findAllByText('Full Access'))[0]).toBeDefined();
    expect(screen.getAllByText('Manual')[0]).toBeDefined();
    expect(screen.getAllByText('Auto-Approve')[0]).toBeDefined();
  });

  it('shows Global Default badge when global auto-approve is on', async () => {
    setupSWR({
      users: [makeUser({ id: 'u-user', plexUsername: 'RegularUser', role: 'user', autoApproveRequests: false })],
      autoApprove: true,
    });

    render(<AdminUsersPage />);

    expect((await screen.findAllByText('Global Default'))[0]).toBeDefined();
  });

  it('opens user permissions modal and shows admin lock state for both permissions', async () => {
    setupSWR({
      users: [makeUser({ id: 'u-admin', plexUsername: 'AdminUser', role: 'admin', plexEmail: 'admin@test.com' })],
      autoApprove: false,
      interactiveSearch: false,
    });

    render(<AdminUsersPage />);

    // Click the permissions badge to open modal
    fireEvent.click((await screen.findAllByText('Full Access'))[0]);

    // Modal should show user info and the locked state for both permissions
    expect(await screen.findByText('User Permissions')).toBeDefined();
    expect(screen.getAllByText('AdminUser').length).toBeGreaterThanOrEqual(2); // table + modal
    expect(screen.getByText('Admin requests are always auto-approved')).toBeDefined();
    expect(screen.getByText('Admins always have interactive search access')).toBeDefined();
  });

  it('opens user permissions modal and toggles auto-approve for regular user', async () => {
    const { mutateUsers } = setupSWR({
      users: [makeUser({ id: 'u-reg', plexUsername: 'RegularUser', autoApproveRequests: false })],
      autoApprove: false,
      interactiveSearch: false,
    });

    fetchJSONMock.mockResolvedValueOnce({ success: true });

    render(<AdminUsersPage />);

    // Click the Manual badge to open permissions modal
    fireEvent.click((await screen.findAllByText('Manual'))[0]);

    // Find and click the auto-approve toggle switch inside the modal
    const toggle = await screen.findByRole('switch', { name: 'Auto-Approve Requests' });
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(fetchJSONMock).toHaveBeenCalledWith('/api/admin/users/u-reg', {
        method: 'PUT',
        body: JSON.stringify({ role: 'user', autoApproveRequests: true }),
      });
    });
  });

  it('opens user permissions modal and toggles interactive search for regular user', async () => {
    setupSWR({
      users: [makeUser({ id: 'u-reg', plexUsername: 'RegularUser', autoApproveRequests: false, interactiveSearchAccess: false })],
      autoApprove: false,
      interactiveSearch: false,
    });

    fetchJSONMock.mockResolvedValueOnce({ success: true });

    render(<AdminUsersPage />);

    // Click the Manual badge to open permissions modal
    fireEvent.click((await screen.findAllByText('Manual'))[0]);

    // Find and click the interactive search toggle switch inside the modal
    const toggle = await screen.findByRole('switch', { name: 'Interactive Search Access' });
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(fetchJSONMock).toHaveBeenCalledWith('/api/admin/users/u-reg', {
        method: 'PUT',
        body: JSON.stringify({ role: 'user', interactiveSearchAccess: true }),
      });
    });
  });

  it('shows global override message in permissions modal when global is on', async () => {
    setupSWR({
      users: [makeUser({ id: 'u-reg', plexUsername: 'RegularUser', autoApproveRequests: false })],
      autoApprove: true,
      interactiveSearch: true,
    });

    render(<AdminUsersPage />);

    // Click the Global Default badge
    fireEvent.click((await screen.findAllByText('Global Default'))[0]);

    // Modal should show the global override message for both
    expect(await screen.findByText('Controlled by global auto-approve setting')).toBeDefined();
    expect(screen.getByText('Controlled by global interactive search setting')).toBeDefined();

    // Both toggles should be disabled
    const autoApproveToggle = screen.getByRole('switch', { name: 'Auto-Approve Requests' });
    expect(autoApproveToggle).toHaveProperty('disabled', true);

    const searchToggle = screen.getByRole('switch', { name: 'Interactive Search Access' });
    expect(searchToggle).toHaveProperty('disabled', true);
  });

  it('edits a user role and saves changes', async () => {
    const { mutateUsers } = setupSWR({
      users: [
        makeUser({
          id: 'u2',
          plexUsername: 'LocalUser',
          plexId: 'local-1',
          plexEmail: 'local@example.com',
          autoApproveRequests: false,
          _count: { requests: 2 },
        }),
      ],
      autoApprove: true,
    });

    fetchJSONMock.mockResolvedValueOnce({ success: true });

    render(<AdminUsersPage />);

    fireEvent.click((await screen.findAllByRole('button', { name: 'Edit Role' }))[0]);
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
    const { mutateUsers, mutatePending } = setupSWR({
      users: [],
      pendingUsers: [{ id: 'p1', plexUsername: 'Pending', plexEmail: null, authProvider: 'local', createdAt: new Date().toISOString() }],
      autoApprove: true,
    });

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

  describe('deleting users', () => {
    const users = [
      makeUser({ id: 'setup', plexUsername: 'SetupAdmin', role: 'admin', isSetupAdmin: true, authProvider: 'local' }),
      makeUser({ id: 'me', plexUsername: 'MePlex', role: 'admin', authProvider: 'plex' }),
      makeUser({ id: 'p1', plexUsername: 'PlexPat', authProvider: 'plex', _count: { requests: 4 } }),
      makeUser({ id: 'o1', plexUsername: 'OidcOlive', authProvider: 'oidc', _count: { requests: 1 } }),
      makeUser({ id: 'l1', plexUsername: 'LocalLee', authProvider: 'local' }),
    ];
    const rowFor = (name: string) => screen.getAllByRole('row').find((row) => within(row).queryByText(name))!;
    const deleteIn = (name: string) => within(rowFor(name)).queryByRole('button', { name: 'Delete' });

    beforeEach(() => {
      authState.userId = 'me';
    });

    it('shows Delete for Plex, OIDC and local users, but not the setup admin or yourself', async () => {
      setupSWR({ users });

      render(<AdminUsersPage />);
      await screen.findAllByText('PlexPat');

      expect(deleteIn('PlexPat')).toBeInTheDocument();
      expect(deleteIn('OidcOlive')).toBeInTheDocument();
      expect(deleteIn('LocalLee')).toBeInTheDocument();
      expect(deleteIn('SetupAdmin')).toBeNull();
      expect(deleteIn('MePlex')).toBeNull();
      expect(within(rowFor('MePlex')).getByRole('button', { name: 'Edit Role' })).toBeInTheDocument();
      expect(within(rowFor('OidcOlive')).getByText('OIDC Managed')).toBeInTheDocument();
    });

    it('confirms a Plex user delete with what is kept and what signing in again does, then deletes', async () => {
      const { mutateUsers } = setupSWR({ users });
      fetchJSONMock.mockResolvedValueOnce({ success: true, message: 'User "PlexPat" has been deleted.' });

      render(<AdminUsersPage />);
      await screen.findAllByText('PlexPat');
      expect(deleteIn('PlexPat')).toBeInTheDocument();
      fireEvent.click(deleteIn('PlexPat')!);

      const message = await screen.findByText((text) => text.startsWith('Delete "PlexPat"?'));
      expect(message).toHaveTextContent('Delete "PlexPat"? Their 4 request(s) are kept.');
      expect(message).toHaveTextContent('If they sign in with Plex again, they get a new account with the User role');
      fireEvent.click(screen.getByRole('button', { name: 'Delete User' }));

      await waitFor(() => {
        expect(fetchJSONMock).toHaveBeenCalledWith('/api/admin/users/p1', { method: 'DELETE' });
        expect(mutateUsers).toHaveBeenCalled();
      });
    });

    it('confirms an OIDC user delete with the approval note', async () => {
      setupSWR({ users });

      render(<AdminUsersPage />);
      await screen.findAllByText('OidcOlive');
      expect(deleteIn('OidcOlive')).toBeInTheDocument();
      fireEvent.click(deleteIn('OidcOlive')!);

      const message = await screen.findByText((text) => text.startsWith('Delete "OidcOlive"?'));
      expect(message).toHaveTextContent('Their 1 request(s) are kept.');
      expect(message).toHaveTextContent('If they sign in with single sign-on again, they get a new account with the User role');
      expect(message).toHaveTextContent('waits for approval when OIDC access is set to admin approval');
    });
  });
});
