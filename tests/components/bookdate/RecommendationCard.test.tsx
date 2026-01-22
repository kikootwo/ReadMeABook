/**
 * Component: BookDate Recommendation Card Tests
 * Documentation: documentation/features/bookdate.md
 */

// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const swipeHandlers: {
  onSwiping?: (eventData: { deltaX: number; deltaY: number }) => void;
  onSwiped?: (eventData: { deltaX: number; deltaY: number }) => void;
} = {};

vi.mock('react-swipeable', () => ({
  useSwipeable: (handlers: any) => {
    swipeHandlers.onSwiping = handlers.onSwiping;
    swipeHandlers.onSwiped = handlers.onSwiped;
    return {};
  },
}));

const recommendation = {
  title: 'Sample Book',
  author: 'Sample Author',
  narrator: 'Sample Narrator',
  rating: 4.5,
  description: 'A sample description',
  aiReason: 'Because it matches your tastes.',
};

describe('RecommendationCard', () => {
  beforeEach(() => {
    swipeHandlers.onSwiping = undefined;
    swipeHandlers.onSwiped = undefined;
  });

  it('shows the request toast and triggers a request action', async () => {
    const onSwipe = vi.fn();
    const { RecommendationCard } = await import('@/components/bookdate/RecommendationCard');

    render(<RecommendationCard recommendation={recommendation} onSwipe={onSwipe} />);

    const requestButtons = screen.getAllByRole('button', { name: /Request/ });
    fireEvent.click(requestButtons[0]);

    expect(screen.getByText('Request "Sample Book"?')).toBeInTheDocument();
    const toastRequestButtons = screen.getAllByRole('button', { name: /Request/ });
    fireEvent.click(toastRequestButtons[toastRequestButtons.length - 1]);

    expect(onSwipe).toHaveBeenCalledWith('right', false);
  });

  it('marks a recommendation as liked from the toast', async () => {
    const onSwipe = vi.fn();
    const { RecommendationCard } = await import('@/components/bookdate/RecommendationCard');

    render(<RecommendationCard recommendation={recommendation} onSwipe={onSwipe} />);

    const requestButtons = screen.getAllByRole('button', { name: /Request/ });
    fireEvent.click(requestButtons[0]);

    fireEvent.click(screen.getByRole('button', { name: 'Mark as Liked' }));

    expect(onSwipe).toHaveBeenCalledWith('right', true);
  });

  it('triggers dislike and dismiss actions from desktop buttons', async () => {
    const onSwipe = vi.fn();
    const { RecommendationCard } = await import('@/components/bookdate/RecommendationCard');

    render(<RecommendationCard recommendation={recommendation} onSwipe={onSwipe} />);

    fireEvent.click(screen.getByRole('button', { name: /Not Interested/ }));
    fireEvent.click(screen.getByRole('button', { name: /Dismiss/ }));

    expect(onSwipe).toHaveBeenCalledWith('left');
    expect(onSwipe).toHaveBeenCalledWith('up');
  });

  it('shows drag overlays based on swipe direction', async () => {
    const onSwipe = vi.fn();
    const { RecommendationCard } = await import('@/components/bookdate/RecommendationCard');

    render(<RecommendationCard recommendation={recommendation} onSwipe={onSwipe} />);

    act(() => {
      swipeHandlers.onSwiping?.({ deltaX: -80, deltaY: 0 });
    });

    expect(screen.getByText('Dislike')).toBeInTheDocument();
  });

  it('triggers an upward swipe from gesture handling', async () => {
    const onSwipe = vi.fn();
    const { RecommendationCard } = await import('@/components/bookdate/RecommendationCard');

    render(<RecommendationCard recommendation={recommendation} onSwipe={onSwipe} />);

    act(() => {
      swipeHandlers.onSwiped?.({ deltaX: 0, deltaY: -150 });
    });

    expect(onSwipe).toHaveBeenCalledWith('up');
  });

  it('ignores swipe gestures when not draggable', async () => {
    const onSwipe = vi.fn();
    const { RecommendationCard } = await import('@/components/bookdate/RecommendationCard');

    render(
      <RecommendationCard recommendation={recommendation} onSwipe={onSwipe} isDraggable={false} />
    );

    act(() => {
      swipeHandlers.onSwiped?.({ deltaX: 150, deltaY: 0 });
    });

    expect(onSwipe).not.toHaveBeenCalled();
    expect(screen.queryByText(/Request "Sample Book"/)).toBeNull();
  });

  it('hides desktop actions when not the top card', async () => {
    const onSwipe = vi.fn();
    const { RecommendationCard } = await import('@/components/bookdate/RecommendationCard');

    render(
      <RecommendationCard recommendation={recommendation} onSwipe={onSwipe} stackPosition={1} />
    );

    expect(screen.queryByRole('button', { name: /Not Interested/ })).toBeNull();
  });
});
