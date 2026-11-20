/**
 * Component: Requesting access to a book already in the library (card and modal button)
 * The button keeps the usual labels (card "Request", modal "Request Audiobook").
 * Documentation: documentation/features/requester-tags.md
 */

// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createRequestMock = vi.hoisted(() => vi.fn());

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-2', username: 'reader' } }) }));
vi.mock('@/lib/hooks/useRequests', () => ({ useCreateRequest: () => ({ createRequest: createRequestMock, isLoading: false }) }));
vi.mock('@/components/audiobooks/AudiobookDetailsModal', () => ({ AudiobookDetailsModal: () => null }));
vi.mock('next/image', () => ({ __esModule: true, default: (props: any) => <img {...props} /> }));

const book = { asin: 'B0ACCESS01', title: 'Shared Book', author: 'Author', isAvailable: true };

describe('AudiobookCard: library access', () => {
  beforeEach(() => {
    createRequestMock.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('plain "In Your Library" without an access state', async () => {
    const { AudiobookCard } = await import('@/components/audiobooks/AudiobookCard');
    render(<AudiobookCard audiobook={book} />);
    expect(screen.getByText('In Your Library')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request' })).not.toBeInTheDocument();
  });

  it('Request creates an access request, then shows Access Requested', async () => {
    createRequestMock.mockResolvedValue({ id: 'req-new', status: 'awaiting_approval' });
    const { AudiobookCard } = await import('@/components/audiobooks/AudiobookCard');
    render(<AudiobookCard audiobook={{ ...book, libraryAccess: 'request' }} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Request' }));
    });

    expect(createRequestMock).toHaveBeenCalledWith(expect.objectContaining({ asin: book.asin }));
    expect(screen.getByText('Access Requested')).toBeInTheDocument();
    expect(screen.getByText('Access requested')).toBeInTheDocument(); // toast
  });

  it('auto-approved: back to "In Your Library" with an "Access granted" toast', async () => {
    createRequestMock.mockResolvedValue({ id: 'req-new', status: 'available' });
    const { AudiobookCard } = await import('@/components/audiobooks/AudiobookCard');
    render(<AudiobookCard audiobook={{ ...book, libraryAccess: 'request' }} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Request' }));
    });

    expect(screen.getByText('In Your Library')).toBeInTheDocument();
    expect(screen.getByText('Access granted')).toBeInTheDocument();
  });

  it.each([['requested', 'Access Requested'], ['denied', 'Access Denied']] as const)('%s shows "%s"', async (state, label) => {
    const { AudiobookCard } = await import('@/components/audiobooks/AudiobookCard');
    render(<AudiobookCard audiobook={{ ...book, libraryAccess: state }} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe('LibraryAccessButton', () => {
  it.each([
    [null, 'In Your Library', true],
    ['request', 'Request Audiobook', false],
    ['requested', 'Access Requested', true],
    ['denied', 'Access Denied', true],
  ] as const)('%s → "%s"', async (access, label, disabled) => {
    const { LibraryAccessButton } = await import('@/components/audiobooks/LibraryAccessButton');
    const onRequest = vi.fn();
    render(<LibraryAccessButton access={access} onRequest={onRequest} isRequesting={false} />);
    const button = screen.getByRole('button', { name: label });
    expect(button.hasAttribute('disabled')).toBe(disabled);
    fireEvent.click(button);
    expect(onRequest).toHaveBeenCalledTimes(disabled ? 0 : 1);
  });
});
