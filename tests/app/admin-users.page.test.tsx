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
        body: JSON.stringify({ role: 'admin', discordUserId: null }),
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
});
