/**
 * Component: Audiobook Grid Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import React from 'react';
import path from 'path';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAudiobookCard = () => {
  vi.doMock(path.resolve('src/components/audiobooks/AudiobookCard.tsx'), () => ({
    AudiobookCard: ({ audiobook }: { audiobook: any }) => (
      <div data-testid="audiobook-card">{audiobook.asin}</div>
    ),
  }));
};

describe('AudiobookGrid', () => {
  beforeEach(() => {
    vi.resetModules();
    mockAudiobookCard();
  });

  it('renders skeleton cards when loading', async () => {
    const { AudiobookGrid } = await import('@/components/audiobooks/AudiobookGrid');

    const { container } = render(<AudiobookGrid audiobooks={[]} isLoading={true} />);

    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(8);
  });

  it('shows the empty message when there are no results', async () => {
    const { AudiobookGrid } = await import('@/components/audiobooks/AudiobookGrid');

    render(<AudiobookGrid audiobooks={[]} isLoading={false} emptyMessage="Nothing found" />);

    expect(screen.getByText('Nothing found')).toBeInTheDocument();
  });

  it('applies grid classes based on card size', async () => {
    const { AudiobookGrid } = await import('@/components/audiobooks/AudiobookGrid');

    const { container } = render(
      <AudiobookGrid
        audiobooks={[{ asin: 'a1', title: 'Book', author: 'Author' }]}
        cardSize={9}
      />
    );

    expect(container.querySelector('div')?.className).toContain('grid-cols-1');
  });
});
