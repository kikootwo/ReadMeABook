/**
 * Component: BookDate Card Stack Tests
 * Documentation: documentation/features/bookdate-animations.md
 */

// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/bookdate/RecommendationCard', () => ({
  RecommendationCard: ({
    recommendation,
    onSwipe,
    stackPosition,
    isDraggable,
  }: {
    recommendation: { id: string; title: string };
    onSwipe: (action: 'left' | 'right' | 'up') => void;
    stackPosition: number;
    isDraggable: boolean;
  }) => (
    <button
      data-testid={`card-${recommendation.id}`}
      data-stack={stackPosition}
      data-draggable={String(isDraggable)}
      onClick={() => onSwipe('left')}
    >
      {recommendation.title}
    </button>
  ),
}));

const recommendations = [
  { id: 'rec-1', title: 'Rec One' },
  { id: 'rec-2', title: 'Rec Two' },
  { id: 'rec-3', title: 'Rec Three' },
  { id: 'rec-4', title: 'Rec Four' },
];

describe('CardStack', () => {
  it('renders up to three cards and only the top card is draggable', async () => {
    const { CardStack } = await import('@/components/bookdate/CardStack');

    render(
      <CardStack
        recommendations={recommendations}
        currentIndex={0}
        onSwipe={vi.fn()}
        onSwipeComplete={vi.fn()}
      />
    );

    expect(screen.getByTestId('card-rec-1')).toHaveAttribute('data-stack', '0');
    expect(screen.getByTestId('card-rec-1')).toHaveAttribute('data-draggable', 'true');
    expect(screen.getByTestId('card-rec-2')).toHaveAttribute('data-stack', '1');
    expect(screen.getByTestId('card-rec-3')).toHaveAttribute('data-stack', '2');
    expect(screen.queryByTestId('card-rec-4')).toBeNull();
  });

  it('locks swipes during animations and calls onSwipeComplete', async () => {
    vi.useFakeTimers();
    const onSwipe = vi.fn();
    const onSwipeComplete = vi.fn();
    const { CardStack } = await import('@/components/bookdate/CardStack');

    render(
      <CardStack
        recommendations={recommendations}
        currentIndex={0}
        onSwipe={onSwipe}
        onSwipeComplete={onSwipeComplete}
      />
    );

    const topCard = screen.getByTestId('card-rec-1');
    fireEvent.click(topCard);
    fireEvent.click(topCard);

    expect(onSwipe).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(750);
    });
    expect(onSwipeComplete).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
