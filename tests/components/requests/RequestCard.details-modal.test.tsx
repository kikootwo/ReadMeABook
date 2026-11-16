/**
 * Component: Request Card details modal tests (#298 label, #325 library edition)
 * Documentation: documentation/frontend/components.md
 *
 * Renders the real RequestCard with the real AudiobookDetailsModal, so the props the card
 * passes are the ones under test.
 */

// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/hooks/useRequests', () => ({
  useCancelRequest: () => ({ cancelRequest: vi.fn(), isLoading: false }),
  useCreateRequest: () => ({ createRequest: vi.fn(), isLoading: false }),
  useEbookStatus: () => ({
    ebookStatus: { ebookSourcesEnabled: false, hasActiveEbookRequest: false },
    revalidate: vi.fn(),
  }),
  useDownloadStatus: () => ({ downloadAvailable: false, requestId: null }),
  useFetchEbookByAsin: () => ({ fetchEbook: vi.fn(), isLoading: false }),
}));

// Keyed by ASIN: the requested edition, and the edition the library holds (#325)
const DETAILS: Record<string, Record<string, string>> = {
  ASIN123: { asin: 'ASIN123', title: 'Detail Book', author: 'Detail Author', narrator: 'Requested Narrator', description: 'Summary' },
  B072R1CY4P: { asin: 'B072R1CY4P', title: 'Library Book', author: 'Library Author', narrator: 'Library Narrator', description: 'Library summary' },
};
vi.mock('@/lib/hooks/useAudiobooks', () => ({
  useAudiobookDetails: (asin: string | null) => ({
    audiobook: (asin && DETAILS[asin]) || null,
    audibleBaseUrl: 'https://www.audible.com',
    isLoading: false,
    error: null,
  }),
}));

vi.mock('@/components/requests/InteractiveTorrentSearchModal', () => ({
  InteractiveTorrentSearchModal: () => null,
}));

vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} alt={props.alt ?? ''} />,
}));

vi.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ squareCovers: false, setSquareCovers: vi.fn(), cardSize: 5, setCardSize: vi.fn() }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', role: 'user' }, accessToken: 'test-token', isLoading: false }),
}));

const request = (status: string, libraryAsin: string | null = null) => ({
  id: 'req-1',
  status,
  progress: 100,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  audiobook: { id: 'book-1', title: 'Test Book', author: 'Test Author', audibleAsin: 'ASIN123', libraryAsin, coverArtUrl: '/cover.jpg' },
});

async function openDetails(status: string, libraryAsin: string | null = null) {
  const { RequestCard } = await import('@/components/requests/RequestCard');
  render(<RequestCard request={request(status, libraryAsin)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Test Book' }));
  await act(async () => {});
}

describe('RequestCard details modal label (#298)', () => {
  it('a downloaded request opens a modal that says Downloaded, not In Your Library', async () => {
    await openDetails('downloaded');

    expect(screen.getByText('Detail Book')).toBeInTheDocument();
    expect(screen.queryByText('In Your Library')).toBeNull();
    // The card badge plus the modal's own label
    expect(screen.getAllByText('Downloaded').length).toBeGreaterThan(1);
  });

  it('an available request still opens a modal that says In Your Library', async () => {
    await openDetails('available');

    expect(screen.getByText('Detail Book')).toBeInTheDocument();
    expect(screen.getAllByText('In Your Library').length).toBeGreaterThan(0);
  });
});

describe('RequestCard details modal of a followed request (#325)', () => {
  it('shows the edition the library holds and names the requested one', async () => {
    await openDetails('available', 'B072R1CY4P');

    expect(screen.getByRole('heading', { name: 'Library Book' })).toBeInTheDocument();
    expect(screen.getByText('Narrated by Library Narrator')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'B072R1CY4P' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Audible/ })).toHaveAttribute('href', 'https://www.audible.com/pd/B072R1CY4P');
    expect(screen.getByTestId('requested-edition')).toHaveTextContent(
      'Requested edition: Detail Book · narrated by Requested Narrator · ASIN123',
    );
  });

  it('a request without a library ASIN shows the requested edition with no extra line', async () => {
    await openDetails('available');

    expect(screen.getByRole('heading', { name: 'Detail Book' })).toBeInTheDocument();
    expect(screen.queryByTestId('requested-edition')).toBeNull();
  });
});
