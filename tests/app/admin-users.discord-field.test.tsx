/**
 * Component: Admin Users Discord Account Field Tests
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
  default: (key: string | null) => (key && swrState.get(key)) || { data: undefined, error: undefined, mutate: vi.fn() },
}));
vi.mock('@/lib/utils/api', () => ({ authenticatedFetcher: vi.fn(), fetchJSON: fetchJSONMock }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
vi.mock('@/components/ui/Toast', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: () => toastMock,
}));

const LINKED = '123456789012345678';

const makeUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'u1',
  plexUsername: 'Reader',
  plexId: 'plex-1',
  role: 'user',
  isSetupAdmin: false,
  authProvider: 'local',
  plexEmail: 'reader@example.com',
  avatarUrl: null,
  createdAt: '',
  updatedAt: '',
  lastLoginAt: null,
  autoApproveRequests: null,
  interactiveSearchAccess: null,
  downloadAccess: null,
  hasLoginToken: false,
  discordUserId: null,
  _count: { requests: 0 },
  ...overrides,
});

function setup(opts: { configured: boolean | undefined; users: unknown[]; mutateUsers?: ReturnType<typeof vi.fn> }) {
  swrState.clear();
  swrState.set('/api/admin/users', { data: { users: opts.users }, mutate: opts.mutateUsers ?? vi.fn() });
  swrState.set('/api/admin/users/pending', { data: { users: [] }, mutate: vi.fn() });
  swrState.set('/api/admin/settings/auto-approve', { data: { autoApproveRequests: false }, mutate: vi.fn() });
  swrState.set('/api/admin/settings/interactive-search', { data: { interactiveSearchAccess: true }, mutate: vi.fn() });
  swrState.set('/api/admin/settings/download-access', { data: { downloadAccess: true }, mutate: vi.fn() });
  if (opts.configured !== undefined) {
    swrState.set('/api/admin/settings/discord', { data: { isConfigured: opts.configured }, mutate: vi.fn() });
  }
}

function openPermissions(username: string) {
  const row = screen.getAllByText(username).map((el) => el.closest('tr')).find(Boolean) as HTMLElement;
  fireEvent.click(within(row).getByRole('button', { name: /Manual/ }));
}

describe('Admin users page: Discord account', () => {
  beforeEach(() => {
    fetchJSONMock.mockReset();
    toastMock.success.mockReset();
    toastMock.error.mockReset();
  });

  it.each([
    ['not configured', false],
    ['settings not loaded yet', undefined],
  ])('bot %s: no Discord field or linked ID anywhere', (_label, configured) => {
    setup({ configured, users: [makeUser({ discordUserId: LINKED })] });
    render(<AdminUsersPage />);

    expect(screen.queryByText(LINKED)).toBeNull();
    openPermissions('Reader');
    expect(screen.queryByLabelText('Discord user ID')).toBeNull();
  });

  it('bot configured: the row shows the linked ID and the dialog edits it', async () => {
    const mutateUsers = vi.fn();
    setup({ configured: true, users: [makeUser({ discordUserId: LINKED })], mutateUsers });
    fetchJSONMock.mockResolvedValue({ user: { id: 'u1', discordUserId: '223456789012345678' } });
    render(<AdminUsersPage />);

    expect(screen.getAllByText(`Discord: ${LINKED}`).length).toBeGreaterThan(0);
    openPermissions('Reader');
    const input = screen.getByLabelText('Discord user ID') as HTMLInputElement;
    expect(input.value).toBe(LINKED);

    fireEvent.change(input, { target: { value: ' 223456789012345678 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Discord ID' }));

    await waitFor(() => expect(fetchJSONMock).toHaveBeenCalledWith('/api/admin/users/u1/discord', expect.objectContaining({ method: 'PUT' })));
    const [, init] = fetchJSONMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ discordUserId: '223456789012345678' });
    await waitFor(() => expect(mutateUsers).toHaveBeenCalled());
  });

  it('Unlink sends null', async () => {
    setup({ configured: true, users: [makeUser({ discordUserId: LINKED })] });
    fetchJSONMock.mockResolvedValue({ user: { id: 'u1', discordUserId: null } });
    render(<AdminUsersPage />);
    openPermissions('Reader');

    fireEvent.click(screen.getByRole('button', { name: 'Unlink Discord' }));

    await waitFor(() => expect(fetchJSONMock).toHaveBeenCalled());
    expect(JSON.parse(fetchJSONMock.mock.calls[0][1].body)).toEqual({ discordUserId: null });
  });

  it('shows the 409 message when the ID is linked to someone else', async () => {
    setup({ configured: true, users: [makeUser()] });
    fetchJSONMock.mockRejectedValue(Object.assign(new Error('This Discord account is already linked to another user'), { status: 409 }));
    render(<AdminUsersPage />);
    openPermissions('Reader');

    fireEvent.change(screen.getByLabelText('Discord user ID'), { target: { value: LINKED } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Discord ID' }));

    await waitFor(() => expect(screen.getByText('This Discord account is already linked to another user')).toBeTruthy());
  });

  it('refuses a value that is not a Discord ID without calling the API', () => {
    setup({ configured: true, users: [makeUser()] });
    render(<AdminUsersPage />);
    openPermissions('Reader');

    fireEvent.change(screen.getByLabelText('Discord user ID'), { target: { value: '12345' } });

    expect(screen.getByText('A Discord user ID is 15 to 20 digits')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save Discord ID' }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchJSONMock).not.toHaveBeenCalled();
  });
});
