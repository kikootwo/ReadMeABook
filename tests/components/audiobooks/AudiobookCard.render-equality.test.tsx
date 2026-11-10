/**
 * Component: Audiobook Card render equality (pins the DOM per status so the BookCover extraction changes nothing)
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Audiobook } from '@/lib/hooks/useAudiobooks';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', username: 'user' } }),
}));

vi.mock('@/lib/hooks/useRequests', () => ({
  useCreateRequest: () => ({ createRequest: vi.fn(), isLoading: false }),
}));

vi.mock('@/components/audiobooks/AudiobookDetailsModal', () => ({
  AudiobookDetailsModal: () => null,
}));

vi.mock('next/image', () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: ({ fill, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean }) => <img data-fill={fill ? 'true' : undefined} {...props} />,
}));

const base = { asin: 'asin-1', title: 'Test Book', author: 'Author', coverArtUrl: 'https://img.test/c.jpg' };

/** Element tree with class tokens collapsed to single spaces (template-literal indentation is not DOM). */
function normalized(root: Element): string {
  const clone = root.cloneNode(true) as Element;
  for (const el of [clone, ...Array.from(clone.querySelectorAll('*'))]) {
    const cls = el.getAttribute('class');
    if (cls !== null) el.setAttribute('class', cls.split(/\s+/).filter(Boolean).join(' '));
  }
  return clone.outerHTML;
}

const cases: [string, Record<string, unknown>][] = [
  ['no status', {}],
  ['available', { isAvailable: true }],
  ['completed', { isRequested: true, requestStatus: 'completed' }],
  ['downloading', { isRequested: true, requestStatus: 'downloading' }],
  ['awaiting_import', { isRequested: true, requestStatus: 'awaiting_import' }],
  ['pending', { isRequested: true, requestStatus: 'pending' }],
  ['searching', { isRequested: true, requestStatus: 'searching' }],
  ['awaiting_approval', { isRequested: true, requestStatus: 'awaiting_approval' }],
  ['awaiting_release', { isRequested: true, requestStatus: 'awaiting_release' }],
  ['denied', { isRequested: true, requestStatus: 'denied' }],
  ['failed', { isRequested: true, requestStatus: 'failed' }],
  ['rating and ignored', { rating: 4.4, isIgnored: true }],
  ['no cover', { coverArtUrl: undefined }],
];

describe('AudiobookCard render equality', () => {
  it.each(cases)('%s renders the same DOM', async (_label, extra) => {
    const { AudiobookCard } = await import('@/components/audiobooks/AudiobookCard');
    const { container } = render(<AudiobookCard audiobook={{ ...base, ...extra } as Audiobook} />);
    expect(normalized(container.firstElementChild!)).toMatchSnapshot();
  });

  it('square covers render the same DOM', async () => {
    const { AudiobookCard } = await import('@/components/audiobooks/AudiobookCard');
    const { container } = render(<AudiobookCard audiobook={{ ...base, isAvailable: true }} squareCovers />);
    expect(normalized(container.firstElementChild!)).toMatchSnapshot();
  });

  it('a broken cover falls back to the placeholder', async () => {
    const { AudiobookCard } = await import('@/components/audiobooks/AudiobookCard');
    const { container } = render(<AudiobookCard audiobook={base as Audiobook} />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')!.getAttribute('src')).toBe('/placeholder_cover.svg');
    expect(normalized(container.firstElementChild!)).toMatchSnapshot();
  });
});
