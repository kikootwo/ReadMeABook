/**
 * Component: Add Local User Dialog Tests
 * Documentation: documentation/admin-dashboard.md
 */

// @vitest-environment jsdom

import React, { useRef } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AddUserDialog } from '@/components/admin/users/AddUserDialog';

const fetchJSONMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/utils/api', () => ({ fetchJSON: fetchJSONMock }));

function renderDialog() {
  const onClose = vi.fn();
  const onAdded = vi.fn();
  render(<AddUserDialog onClose={onClose} onAdded={onAdded} />);
  return { onClose, onAdded };
}

/** The dialog next to the button that opened it, the way the Users page has it */
function renderWithOpener() {
  const onClose = vi.fn();
  const onAdded = vi.fn();
  function Harness() {
    const opener = useRef<HTMLButtonElement>(null);
    return (
      <>
        <button ref={opener} type="button">Opener</button>
        <AddUserDialog onClose={onClose} onAdded={onAdded} returnFocusRef={opener} />
      </>
    );
  }
  render(<Harness />);
  return { onClose, onAdded, opener: screen.getByRole('button', { name: 'Opener' }) };
}

function fill(username: string, password: string, confirm: string) {
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: username } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: confirm } });
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Add User' }));

describe('AddUserDialog', () => {
  beforeEach(() => {
    fetchJSONMock.mockReset();
  });

  it('is a labelled dialog with the three fields, Cancel and Add User', () => {
    renderDialog();

    expect(screen.getByRole('dialog', { name: 'Add User' })).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toHaveFocus();
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Confirm Password')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add User' })).toBeInTheDocument();
  });

  it('shows a mismatch under the confirm field and sends nothing', () => {
    renderDialog();
    fill('newreader', 'password123', 'password124');
    submit();

    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm Password')).toHaveAttribute('aria-invalid', 'true');
    expect(fetchJSONMock).not.toHaveBeenCalled();
  });

  it('posts the username and password, then reports the stored username', async () => {
    fetchJSONMock.mockResolvedValue({ user: { plexUsername: 'newreader' } });
    const { onAdded, onClose } = renderDialog();
    fill('NewReader', 'password123', 'password123');
    submit();

    await waitFor(() => expect(onAdded).toHaveBeenCalledWith('newreader'));
    expect(fetchJSONMock).toHaveBeenCalledWith('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({ username: 'NewReader', password: 'password123' }),
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each([
    ['That username is already taken', 'Username'],
    ['Password must be at least 8 characters', 'Password'],
  ])('shows "%s" inline under %s and clears it on edit', async (message, label) => {
    fetchJSONMock.mockRejectedValue(new Error(message));
    renderDialog();
    fill('newreader', 'password123', 'password123');
    submit();

    expect(await screen.findByText(message)).toBeInTheDocument();
    const input = screen.getByLabelText(label);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Add User' })).not.toBeDisabled();

    fireEvent.change(input, { target: { value: 'something-else' } });
    expect(screen.queryByText(message)).not.toBeInTheDocument();
  });

  it('shows any other server message at the bottom of the form', async () => {
    fetchJSONMock.mockRejectedValue(new Error('Local login is not enabled, so local users cannot be added'));
    renderDialog();
    fill('newreader', 'password123', 'password123');
    submit();

    expect(await screen.findByRole('alert')).toHaveTextContent('Local login is not enabled');
  });

  it('disables the form while adding and ignores Cancel and Escape', async () => {
    let resolve: (value: unknown) => void = () => {};
    fetchJSONMock.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { onClose, onAdded } = renderDialog();
    fill('newreader', 'password123', 'password123');
    submit();

    expect(await screen.findByRole('button', { name: 'Adding...' })).toBeDisabled();
    expect(screen.getByLabelText('Username')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    resolve({ user: { plexUsername: 'newreader' } });
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
  });

  it('puts the dialog role on a wrapper around the form, not on the form', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Add User' });

    expect(dialog.tagName).not.toBe('FORM');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.querySelector('form')).not.toBeNull();
  });

  it('stays open, with what was typed, when a text selection starts in a field and ends on the backdrop', () => {
    const { onClose } = renderDialog();
    fill('newreader', 'password123', 'password123');
    const username = screen.getByLabelText('Username');
    // The browser sends the click to the nearest element holding both the press and the release
    const common = screen.getByRole('dialog').parentElement as HTMLElement;

    fireEvent.mouseDown(username);
    fireEvent.mouseUp(common);
    fireEvent.click(common);

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Add User' })).toBeInTheDocument();
    expect(username).toHaveValue('newreader');
  });

  it('closes on a click on the backdrop itself', () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByTestId('add-user-backdrop'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['That username is already taken', 'Username'],
    ['Password must be at least 8 characters', 'Password'],
  ])('after "%s" focus moves to %s and the error is announced', async (message, label) => {
    fetchJSONMock.mockRejectedValue(new Error(message));
    renderDialog();
    fill('newreader', 'password123', 'password123');
    submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    const input = screen.getByLabelText(label);
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveAccessibleDescription(message);
  });

  it('after a server error with no field, focus moves to the first field', async () => {
    fetchJSONMock.mockRejectedValue(new Error('Failed to add user'));
    renderDialog();
    fill('newreader', 'password123', 'password123');
    submit();

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to add user');
    await waitFor(() => expect(screen.getByLabelText('Username')).toHaveFocus());
  });

  it('a mismatch moves focus to Confirm Password and is announced', async () => {
    renderDialog();
    fill('newreader', 'password123', 'password124');
    submit();

    expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match');
    await waitFor(() => expect(screen.getByLabelText('Confirm Password')).toHaveFocus());
  });

  it.each([
    ['Cancel', () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))],
    ['the close button', () => fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))],
    ['Escape', () => fireEvent.keyDown(window, { key: 'Escape' })],
    ['the backdrop', () => fireEvent.click(screen.getByTestId('add-user-backdrop'))],
  ])('closing with %s returns focus to the button that opened it', (_how, closeIt) => {
    const { onClose, opener } = renderWithOpener();
    expect(screen.getByLabelText('Username')).toHaveFocus();

    closeIt();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(opener).toHaveFocus();
  });

  it('returns focus to the button that opened it after adding', async () => {
    fetchJSONMock.mockResolvedValue({ user: { plexUsername: 'newreader' } });
    const { onAdded, opener } = renderWithOpener();
    fill('newreader', 'password123', 'password123');
    submit();

    await waitFor(() => expect(onAdded).toHaveBeenCalledWith('newreader'));
    expect(opener).toHaveFocus();
  });

  it('closes on Cancel, the close button and Escape', () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
