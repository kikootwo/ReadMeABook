/**
 * Component: Change Password Modal Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChangePasswordModal } from '@/components/ui/ChangePasswordModal';

describe('ChangePasswordModal', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    localStorage.clear();
  });

  it('shows validation errors when required fields are missing', () => {
    render(<ChangePasswordModal isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));

    expect(screen.getByText('Current password is required')).toBeInTheDocument();
    expect(screen.getByText('New password is required')).toBeInTheDocument();
    expect(screen.getByText('Please confirm your new password')).toBeInTheDocument();
  });

  it('rejects submission when access token is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<ChangePasswordModal isOpen onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Current Password'), {
      target: { value: 'old-password' },
    });
    fireEvent.change(screen.getByLabelText('New Password'), {
      target: { value: 'new-password' },
    });
    fireEvent.change(screen.getByLabelText('Confirm New Password'), {
      target: { value: 'new-password' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));

    await waitFor(() => {
      expect(screen.getByText('Not authenticated')).toBeInTheDocument();
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('submits successfully and auto-closes after showing success', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('accessToken', 'token');

    render(<ChangePasswordModal isOpen onClose={onClose} />);

    fireEvent.change(screen.getByLabelText('Current Password'), {
      target: { value: 'old-password' },
    });
    fireEvent.change(screen.getByLabelText('New Password'), {
      target: { value: 'new-password' },
    });
    fireEvent.change(screen.getByLabelText('Confirm New Password'), {
      target: { value: 'new-password' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/change-password',
      expect.objectContaining({ method: 'POST' })
    );

    expect(screen.getByText('Password changed successfully!')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows server error responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Invalid password' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('accessToken', 'token');

    render(<ChangePasswordModal isOpen onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Current Password'), {
      target: { value: 'old-password' },
    });
    fireEvent.change(screen.getByLabelText('New Password'), {
      target: { value: 'new-password' },
    });
    fireEvent.change(screen.getByLabelText('Confirm New Password'), {
      target: { value: 'new-password' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));

    expect(await screen.findByText('Invalid password')).toBeInTheDocument();
  });
});
