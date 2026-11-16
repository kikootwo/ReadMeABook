/**
 * Component: Approval API Token Form Tests
 * Documentation: documentation/backend/services/api-tokens.md
 *
 * The "Can approve requests" option defaults the token to expire (any expiry can still be chosen),
 * is sent only when the server offers it, and is hidden in the admin tab for another user's token.
 */

// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchWithAuthMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/utils/api', () => ({ fetchWithAuth: fetchWithAuthMock }));

const ok = (body: unknown) => ({ ok: true, json: async () => body });

function respond({ available }: { available: boolean }) {
  fetchWithAuthMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/admin/users') return ok({ users: [{ id: 'u-2', plexUsername: 'reader', role: 'user' }] });
    if (url === '/api/admin/settings/api-tokens') return ok({ allowRequestApproval: available });
    if (init?.method === 'POST') return ok({ fullToken: 'rmab_new' });
    return ok({ tokens: [], approvalTokensAvailable: available });
  });
}

const postedBody = () => {
  const call = fetchWithAuthMock.mock.calls.find(([, init]) => init?.method === 'POST');
  return JSON.parse(call![1].body);
};

describe('useApiTokens approval option', () => {
  beforeEach(() => vi.clearAllMocks());

  it('picks a 90-day expiry when ticked on "Never", and sends the flag', async () => {
    respond({ available: true });
    const { useApiTokens } = await import('@/lib/hooks/useApiTokens');
    const { result } = renderHook(() => useApiTokens({ basePath: '/api/user/api-tokens' }));
    await waitFor(() => expect(result.current.approvalTokensAvailable).toBe(true));

    act(() => {
      result.current.setNewTokenName('Absorb');
      result.current.setNewTokenCanApprove(true);
    });
    expect(result.current.newTokenExpiry).toBe('90d');
    await act(async () => { await result.current.handleCreate(); });

    expect(postedBody()).toMatchObject({ name: 'Absorb', canApproveRequests: true });
    expect(postedBody().expiresAt).not.toBeNull();
  });

  it('keeps an expiry the admin chose, including "Never" picked after ticking', async () => {
    respond({ available: true });
    const { useApiTokens } = await import('@/lib/hooks/useApiTokens');
    const { result } = renderHook(() => useApiTokens({ basePath: '/api/user/api-tokens' }));
    await waitFor(() => expect(result.current.approvalTokensAvailable).toBe(true));

    act(() => result.current.setNewTokenExpiry('30d'));
    act(() => result.current.setNewTokenCanApprove(true));
    expect(result.current.newTokenExpiry).toBe('30d');

    act(() => {
      result.current.setNewTokenName('Absorb');
      result.current.setNewTokenExpiry('never');
    });
    await act(async () => { await result.current.handleCreate(); });

    expect(postedBody()).toMatchObject({ canApproveRequests: true, expiresAt: null });
  });

  it('never sends the flag when the server does not offer it', async () => {
    respond({ available: false });
    const { useApiTokens } = await import('@/lib/hooks/useApiTokens');
    const { result } = renderHook(() => useApiTokens({ basePath: '/api/user/api-tokens' }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setNewTokenName('Plain');
      result.current.setNewTokenCanApprove(true);
    });
    await act(async () => { await result.current.handleCreate(); });

    expect(postedBody()).not.toHaveProperty('canApproveRequests');
  });
});

describe('ApprovalTokenOption', () => {
  it('warns about what the token can do, and more when it never expires', async () => {
    const { ApprovalTokenOption } = await import('@/components/api-tokens/ApprovalTokenOption');
    const { rerender } = render(<ApprovalTokenOption checked={false} onChange={vi.fn()} expiry="never" />);
    expect(screen.queryByText(/approve or deny requests as you/)).toBeNull();

    rerender(<ApprovalTokenOption checked onChange={vi.fn()} expiry="90d" />);
    expect(screen.getByText(/approve or deny requests as you/)).toBeInTheDocument();
    expect(screen.queryByText(/never expires/)).toBeNull();

    rerender(<ApprovalTokenOption checked onChange={vi.fn()} expiry="never" />);
    expect(screen.getByText(/never expires/)).toBeInTheDocument();
  });
});

describe('Admin API tab', () => {
  beforeEach(() => vi.clearAllMocks());

  it("offers the option only for the admin's own token, and never sends it for another user", async () => {
    respond({ available: true });
    const { ApiTab } = await import('@/app/admin/settings/tabs/ApiTab/ApiTab');
    render(<ApiTab />);

    fireEvent.click(await screen.findByRole('button', { name: 'Create New Token' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /^Can approve requests/ }));
    fireEvent.change(screen.getByPlaceholderText(/Home Assistant/), { target: { value: 'For reader' } });
    fireEvent.change(screen.getByDisplayValue('Current user (default)'), { target: { value: 'u-2' } });

    expect(screen.queryByRole('checkbox', { name: /^Can approve requests/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Create Token' }));

    await waitFor(() => expect(postedBody()).toMatchObject({ userId: 'u-2', canApproveRequests: false }));
  });

  it('shows the setting and hides the option while it is off', async () => {
    respond({ available: false });
    const { ApiTab } = await import('@/app/admin/settings/tabs/ApiTab/ApiTab');
    render(<ApiTab />);

    const setting = await screen.findByRole('checkbox', { name: /Allow API tokens to approve or deny requests/ });
    await waitFor(() => expect(setting).not.toBeDisabled());
    expect(setting).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Create New Token' }));
    expect(screen.queryByRole('checkbox', { name: /^Can approve requests/ })).toBeNull();
  });
});
