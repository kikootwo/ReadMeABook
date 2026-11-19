/**
 * Component: Request Card Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cancelRequestMock = vi.hoisted(() => vi.fn());
const detailsModalSpy = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/useRequests', () => ({
  useCancelRequest: () => ({ cancelRequest: cancelRequestMock, isLoading: false }),
}));

vi.mock('@/components/audiobooks/AudiobookDetailsModal', () => ({
  AudiobookDetailsModal: (props: any) => {
    detailsModalSpy(props);
    return <div data-testid="audiobook-details-modal" data-open={String(props.isOpen)} />;
  },
}));

vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: any) => <img {...props} />,
}));

const preferencesMock = vi.hoisted(() => ({ squareCovers: false }));
vi.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ squareCovers: preferencesMock.squareCovers, setSquareCovers: vi.fn(), cardSize: 5, setCardSize: vi.fn() }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', role: 'user' },
    accessToken: 'test-token',
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
    refreshToken: vi.fn(),
    setAuthData: vi.fn(),
  }),
}));

const baseRequest = {
  id: 'req-1',
  status: 'pending',
  progress: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  audiobook: {
    id: 'book-1',
    title: 'Test Book',
    author: 'Test Author',
  },
};

describe('RequestCard', () => {
  beforeEach(() => {
    cancelRequestMock.mockReset();
    detailsModalSpy.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    [false, 'w-16 sm:w-24 aspect-[2/3]'],
    [true, 'w-24 sm:w-36 aspect-square'],
  ])('cover box with square covers %s is as tall as a 2:3 cover', async (square, classes) => {
    const { RequestCard } = await import('@/components/requests/RequestCard');
    preferencesMock.squareCovers = square;
    try {
      render(<RequestCard request={{ ...baseRequest, audiobook: { ...baseRequest.audiobook, coverArtUrl: 'https://example.test/c.jpg' } }} />);
      const box = screen.getByRole('img', { name: 'Test Book' }).parentElement!;
      for (const c of classes.split(' ')) expect(box.classList.contains(c)).toBe(true);
    } finally {
      preferencesMock.squareCovers = false;
    }
  });

  it('shows progress for downloads, with no separate Active note beside the bar', async () => {
    const { RequestCard } = await import('@/components/requests/RequestCard');

    render(
      <RequestCard
        request={{
          ...baseRequest,
          status: 'downloading',
          progress: 45,
        }}
      />
    );

    expect(screen.getByText('Downloading')).toBeInTheDocument();
    expect(screen.queryByText('Active')).toBeNull();
    expect(screen.getByText('45%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '45');
  });

  it('toggles the error message for failed requests', async () => {
    const { RequestCard } = await import('@/components/requests/RequestCard');

    render(
      <RequestCard
        request={{
          ...baseRequest,
          status: 'failed',
          errorMessage: 'Failure details',
        }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show error' }));
    expect(await screen.findByText('Failure details')).toBeInTheDocument();
  });

  it('triggers cancel action', async () => {
    const { RequestCard } = await import('@/components/requests/RequestCard');

    cancelRequestMock.mockResolvedValueOnce(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<RequestCard request={baseRequest} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request' }));
    await waitFor(() => {
      expect(cancelRequestMock).toHaveBeenCalledWith('req-1');
    });
  });

  it('the cancel confirmation promises only what a cancel does to the download', async () => {
    const { RequestCard } = await import('@/components/requests/RequestCard');

    render(<RequestCard request={{ ...baseRequest, status: 'downloading' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByText("RMAB stops this request's download and removes what it downloaded so far, unless another request still uses it. A download that already finished may stay in the download client to seed.")).toBeInTheDocument();
    expect(screen.queryByText(/Cancelling will stop the download/)).toBeNull();
  });

  it.each(['pending', 'searching', 'awaiting_search', 'awaiting_release'])(
    'a %s request has no download yet: the confirmation is the short line', async (status) => {
      const { RequestCard } = await import('@/components/requests/RequestCard');

      render(<RequestCard request={{ ...baseRequest, status }} />);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(await screen.findByText('RMAB stops looking for this book.')).toBeInTheDocument();
      expect(screen.queryByText(/this request's download/)).toBeNull();
    }
  );

  it('a downloading ebook is not promised that its file is removed', async () => {
    const { RequestCard } = await import('@/components/requests/RequestCard');

    render(<RequestCard request={{ ...baseRequest, status: 'downloading', type: 'ebook' as const }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByText("RMAB stops this request's download. What it already downloaded may stay in the download client or the downloads folder.")).toBeInTheDocument();
    expect(screen.queryByText(/removes what it downloaded/)).toBeNull();
  });

  it('does not show manual search or interactive search buttons', async () => {
    const { RequestCard } = await import('@/components/requests/RequestCard');

    render(<RequestCard request={baseRequest} />);

    expect(screen.queryByRole('button', { name: 'Manual Search' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Interactive Search' })).toBeNull();
  });

  it.each(['searching', 'downloading'])('shows the setup indicator when a %s request is at zero', async (status) => {
    const { RequestCard } = await import('@/components/requests/RequestCard');

    render(<RequestCard request={{ ...baseRequest, status, progress: 0 }} />);

    expect(screen.getByText('Setting up...')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  describe('processing says what it is doing (#216)', () => {
    it('organizing files: the label, no bar and no percent', async () => {
      const { RequestCard } = await import('@/components/requests/RequestCard');

      render(<RequestCard request={{ ...baseRequest, status: 'processing', progress: 100 }} />);

      expect(screen.getByText('Processing')).toBeInTheDocument();
      expect(screen.getByText('Organizing files')).toBeInTheDocument();
      expect(screen.queryByRole('progressbar')).toBeNull();
      expect(screen.queryByText('100%')).toBeNull();
      expect(screen.queryByText('Active')).toBeNull();
    });

    it('merging chapters: the label, the percent and a bar of that width', async () => {
      const { RequestCard } = await import('@/components/requests/RequestCard');

      render(<RequestCard request={{ ...baseRequest, status: 'processing', progress: 42 }} />);

      expect(screen.getByText('Merging chapters')).toBeInTheDocument();
      expect(screen.getByText('42%')).toBeInTheDocument();
      const bar = screen.getByRole('progressbar', { name: 'Progress' });
      expect(bar).toHaveAttribute('aria-valuenow', '42');
      expect((bar.firstElementChild as HTMLElement).style.width).toBe('42%');
      expect(screen.queryByText('Active')).toBeNull();
    });

    it('merging at 0%: the bar at zero, never "Setting up..."', async () => {
      const { RequestCard } = await import('@/components/requests/RequestCard');

      render(<RequestCard request={{ ...baseRequest, status: 'processing', progress: 0 }} />);

      expect(screen.getByText('Merging chapters')).toBeInTheDocument();
      expect(screen.getByText('0%')).toBeInTheDocument();
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
      expect(screen.queryByText('Setting up...')).toBeNull();
    });

    it.each([
      ['downloaded', 'audiobook'],
      ['downloaded', 'ebook'],
      ['awaiting_import', 'audiobook'],
    ] as const)('%s (%s) stays as it was: no phase label, no bar', async (status, type) => {
      const { RequestCard } = await import('@/components/requests/RequestCard');

      render(<RequestCard request={{ ...baseRequest, status, type, progress: 42 }} />);

      expect(screen.queryByText('Organizing files')).toBeNull();
      expect(screen.queryByText('Merging chapters')).toBeNull();
      expect(screen.queryByText(/library scan/i)).toBeNull();
      expect(screen.queryByRole('progressbar')).toBeNull();
    });
  });

  it('hides action buttons when showActions is false', async () => {
    const { RequestCard } = await import('@/components/requests/RequestCard');

    render(<RequestCard request={baseRequest} showActions={false} />);

    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('does not cancel when confirmation is declined', async () => {
    const { RequestCard } = await import('@/components/requests/RequestCard');

    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<RequestCard request={baseRequest} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(cancelRequestMock).not.toHaveBeenCalled();
    });
  });

  it('shows completed timestamp when available', async () => {
    const { RequestCard } = await import('@/components/requests/RequestCard');

    render(
      <RequestCard
        request={{
          ...baseRequest,
          completedAt: new Date('2024-01-01T00:00:00Z').toISOString(),
        }}
      />
    );

    expect(screen.getByText(/Completed/)).toBeInTheDocument();
  });

  it('renders release date when status is awaiting_release and releaseDate is provided', async () => {
    const { RequestCard } = await import('@/components/requests/RequestCard');

    render(
      <RequestCard
        request={{
          ...baseRequest,
          status: 'awaiting_release',
          releaseDate: '2026-08-15T00:00:00Z',
        }}
      />
    );

    expect(screen.getByText('Releases Aug 15, 2026')).toBeInTheDocument();
  });

  it('does not render release text when status is awaiting_release but releaseDate is null', async () => {
    const { RequestCard } = await import('@/components/requests/RequestCard');

    render(
      <RequestCard
        request={{
          ...baseRequest,
          status: 'awaiting_release',
          releaseDate: null,
        }}
      />
    );

    expect(screen.queryByText(/^Releases /)).toBeNull();
  });

  it('does not render release text when releaseDate is provided but status is not awaiting_release', async () => {
    const { RequestCard } = await import('@/components/requests/RequestCard');

    render(
      <RequestCard
        request={{
          ...baseRequest,
          status: 'pending',
          releaseDate: '2026-08-15T00:00:00Z',
        }}
      />
    );

    expect(screen.queryByText(/^Releases /)).toBeNull();
  });

  it('opens AudiobookDetailsModal without hiding request actions when details are viewed', async () => {
    const { RequestCard } = await import('@/components/requests/RequestCard');

    render(
      <RequestCard
        request={{
          ...baseRequest,
          audiobook: { ...baseRequest.audiobook, audibleAsin: 'ASIN123' },
        }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: baseRequest.audiobook.title }));

    expect(detailsModalSpy).toHaveBeenCalled();
    const props = detailsModalSpy.mock.calls.at(-1)?.[0];
    expect(props.isOpen).toBe(true);
    expect(props.asin).toBe('ASIN123');
    expect(props.hideRequestActions).toBeUndefined();
  });

  // #281: without the request id, a pick from My Requests tried to create a second request
  it.each(['audiobook', 'ebook'] as const)(
    'passes its %s request to AudiobookDetailsModal so Interactive Search picks for it',
    async (type) => {
      const { RequestCard } = await import('@/components/requests/RequestCard');

      render(
        <RequestCard
          request={{
            ...baseRequest,
            type,
            status: 'failed',
            userId: 'user-1',
            audiobook: { ...baseRequest.audiobook, audibleAsin: 'ASIN123', coverArtUrl: '/cover.jpg' },
          }}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: baseRequest.audiobook.title }));

      const props = detailsModalSpy.mock.calls.at(-1)?.[0];
      expect(props.requestId).toBe('req-1');
      expect(props.requestedByUserId).toBe('user-1');
      expect(props.requestType).toBe(type);
      expect(props.requestStatus).toBe('failed');
    }
  );

  // #542: after a pick from the details modal advances the request, My Requests reloads it
  it('a request advanced from the details modal reloads the list', async () => {
    const { RequestCard } = await import('@/components/requests/RequestCard');
    const onChanged = vi.fn();

    render(
      <RequestCard
        request={{ ...baseRequest, status: 'failed', userId: 'user-1', audiobook: { ...baseRequest.audiobook, audibleAsin: 'ASIN123' } }}
        onChanged={onChanged}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: baseRequest.audiobook.title }));
    detailsModalSpy.mock.calls.at(-1)?.[0].onRequestSuccess?.();

    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  describe('book details', () => {
    const fullBook = {
      ...baseRequest.audiobook,
      narrator: 'Tim Gerard Reynolds',
      year: 2014,
      series: 'Red Rising Saga',
      seriesPart: '1',
      description: '  Darrow is a Red.\n\nHe works all day.  ',
    };

    it('shows narrator, recording year and series with its book number on one line', async () => {
      const { RequestCard } = await import('@/components/requests/RequestCard');
      render(<RequestCard request={{ ...baseRequest, audiobook: fullBook }} />);

      expect(screen.getByTestId('request-book-details')).toHaveTextContent(
        'Narrated by Tim Gerard Reynolds · 2014 · Red Rising Saga, Book 1'
      );
    });

    it('leaves out the parts a book lacks', async () => {
      const { RequestCard } = await import('@/components/requests/RequestCard');
      render(<RequestCard request={{ ...baseRequest, audiobook: { ...baseRequest.audiobook, year: 2014, series: 'Saga' } }} />);

      expect(screen.getByTestId('request-book-details')).toHaveTextContent(/^2014 · Saga$/);
    });

    it('shows no details line for a book with none', async () => {
      const { RequestCard } = await import('@/components/requests/RequestCard');
      render(<RequestCard request={baseRequest} />);

      expect(screen.queryByTestId('request-book-details')).toBeNull();
      expect(screen.queryByTestId('request-book-description')).toBeNull();
    });

    it('shows the narrator and year on ebook requests too', async () => {
      const { RequestCard } = await import('@/components/requests/RequestCard');
      render(<RequestCard request={{ ...baseRequest, type: 'ebook', audiobook: fullBook }} />);

      expect(screen.getByTestId('request-book-details')).toHaveTextContent(
        /^Narrated by Tim Gerard Reynolds · 2014 · Red Rising Saga, Book 1$/
      );
    });

    it('names the first two authors and narrators, with everyone in the hover text', async () => {
      const { RequestCard } = await import('@/components/requests/RequestCard');
      const book = {
        ...baseRequest.audiobook,
        author: 'Terry Pratchett, Neil Gaiman, Ben Aaranovitch - introduction, Stephen Baxter',
        narrator: 'Sian Clifford, Peter Serafinowicz, Bill Nighy',
      };
      render(<RequestCard request={{ ...baseRequest, audiobook: book }} />);

      const authors = screen.getByTestId('request-book-authors');
      expect(authors).toHaveTextContent('By Terry Pratchett, Neil Gaiman and 1 more');
      expect(authors).toHaveAttribute('title', 'Terry Pratchett, Neil Gaiman, Ben Aaranovitch (introduction), Stephen Baxter');
      const details = screen.getByTestId('request-book-details');
      expect(details).toHaveTextContent(/^Narrated by Sian Clifford, Peter Serafinowicz and 1 more$/);
      expect(details).toHaveAttribute('title', 'Narrated by Sian Clifford, Peter Serafinowicz, Bill Nighy');
    });

    it('shows the description on one paragraph, clamped from sm and hidden on phones', async () => {
      const { RequestCard } = await import('@/components/requests/RequestCard');
      render(<RequestCard request={{ ...baseRequest, audiobook: fullBook }} />);

      const description = screen.getByTestId('request-book-description');
      expect(description.textContent).toBe('Darrow is a Red. He works all day.');
      for (const c of ['hidden', 'sm:line-clamp-2', 'md:line-clamp-3']) expect(description.classList.contains(c)).toBe(true);
    });

    it('puts the pills beside the title at every width, with the full title on hover', async () => {
      const { RequestCard } = await import('@/components/requests/RequestCard');
      render(<RequestCard request={{ ...baseRequest, status: 'available', type: 'ebook', audiobook: fullBook }} />);

      const heading = screen.getByRole('heading', { name: 'Test Book' });
      expect(heading).toHaveAttribute('title', 'Test Book');
      expect(heading.parentElement!.className).toContain('grid-cols-[minmax(0,1fr)_auto]');
      const badges = screen.getByTestId('request-card-badges');
      expect(heading.nextElementSibling).toBe(badges);
      // Icon-only below sm: labels stay for screen readers, and show as hover text
      expect(screen.getByTitle('Available')).toHaveTextContent('Available');
      expect(screen.getByText('Available').className).toContain('sr-only sm:not-sr-only');
      expect(screen.getByText('Ebook').className).toContain('sr-only sm:not-sr-only');
    });

    it('moves the setting-up note under the details, out of the pill column', async () => {
      const { RequestCard } = await import('@/components/requests/RequestCard');
      render(<RequestCard request={{ ...baseRequest, status: 'downloading', progress: 0, audiobook: fullBook }} />);

      expect(screen.getByTestId('request-card-badges')).not.toHaveTextContent('Setting up...');
      expect(screen.getByText('Setting up...')).toBeInTheDocument();
      expect(screen.queryByRole('progressbar')).toBeNull();
    });

    it('puts the progress bar full width under the cover, and shortens the description beside a note', async () => {
      const { RequestCard } = await import('@/components/requests/RequestCard');
      // Merging chapters: a note line and a bar
      render(<RequestCard request={{ ...baseRequest, status: 'processing', progress: 50, audiobook: fullBook }} />);

      const topRow = screen.getByRole('heading', { name: 'Test Book' }).closest('.flex.gap-3')!;
      expect(topRow.contains(screen.getByRole('progressbar'))).toBe(false);
      expect(screen.getByTestId('request-book-description').classList.contains('md:line-clamp-3')).toBe(false);
    });

    it('keeps 3 description lines from md on a download, which has a bar but no note', async () => {
      const { RequestCard } = await import('@/components/requests/RequestCard');
      render(<RequestCard request={{ ...baseRequest, status: 'downloading', progress: 45, audiobook: fullBook }} />);

      expect(screen.getByTestId('request-book-description').classList.contains('md:line-clamp-3')).toBe(true);
    });

    it.each([
      [0, 'Requested just now'],
      [86400000 + 60000, 'Requested yesterday'],
    ])('reads the request time as one phrase (%i ms ago)', async (ago, text) => {
      const { RequestCard } = await import('@/components/requests/RequestCard');
      render(<RequestCard request={{ ...baseRequest, createdAt: new Date(Date.now() - ago).toISOString() }} />);

      expect(screen.getByText(text)).toBeInTheDocument();
    });

    it('gives the date row the same space above and below', async () => {
      const { RequestCard } = await import('@/components/requests/RequestCard');
      render(<RequestCard request={baseRequest} />);

      const footer = screen.getByText(/^Requested/).parentElement!;
      expect(footer.className).toContain('pt-3');
      expect(footer.parentElement!.className).toContain('pb-3');
      expect(footer.parentElement!.className).not.toMatch(/(^| )p-\d/);
    });

    it('puts a failed request\'s error toggle full width under the cover', async () => {
      const { RequestCard } = await import('@/components/requests/RequestCard');
      render(<RequestCard request={{ ...baseRequest, status: 'failed', errorMessage: 'Boom', audiobook: fullBook }} />);

      const topRow = screen.getByRole('heading', { name: 'Test Book' }).closest('.flex.gap-3')!;
      expect(topRow.contains(screen.getByRole('button', { name: 'Show error' }))).toBe(false);
    });

    it('keeps the actions right-aligned when they wrap under the date', async () => {
      const { RequestCard } = await import('@/components/requests/RequestCard');
      render(<RequestCard request={baseRequest} />);

      const actions = screen.getByRole('button', { name: 'Cancel' }).parentElement!;
      for (const c of ['ml-auto', 'justify-end', 'flex-wrap']) expect(actions.classList.contains(c)).toBe(true);
    });

    it('steps the emphasis down: authors, then details, then the description', async () => {
      const { RequestCard } = await import('@/components/requests/RequestCard');
      render(<RequestCard request={{ ...baseRequest, audiobook: fullBook }} />);

      expect(screen.getByTestId('request-book-authors').className).toContain('font-medium text-gray-700 dark:text-gray-200');
      expect(screen.getByTestId('request-book-details').className).toContain('text-gray-600 dark:text-gray-300');
      expect(screen.getByTestId('request-book-description').className).toContain('text-gray-500 dark:text-gray-400');
    });

    it('keeps the date and actions in a full-width row under the cover', async () => {
      const { RequestCard } = await import('@/components/requests/RequestCard');
      render(<RequestCard request={{ ...baseRequest, audiobook: fullBook }} />);

      const footer = screen.getByRole('button', { name: 'Cancel' }).closest('.border-t')!;
      expect(footer).toHaveTextContent(/Requested/);
      expect(footer.contains(screen.getByRole('heading', { name: 'Test Book' }))).toBe(false);
      expect(footer.parentElement!.firstElementChild!.contains(screen.getByRole('heading', { name: 'Test Book' }))).toBe(true);
    });
  });
});
