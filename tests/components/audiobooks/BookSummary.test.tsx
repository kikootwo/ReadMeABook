/**
 * Component: Book Summary Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BookSummary } from '@/components/audiobooks/BookSummary';

// jsdom has no layout: fake the scroll box's geometry. Only the element tagged
// data-testid="book-summary-scroll" is faked; every other element keeps jsdom's values.
const layout = { scrollHeight: 0, clientHeight: 0, offsetWidth: 0, clientWidth: 0 };
const faked = ['scrollHeight', 'clientHeight', 'offsetWidth', 'clientWidth'] as const;
const originals = new Map<string, { proto: object; desc: PropertyDescriptor }>();

function isBox(el: Element): boolean {
  return el.getAttribute('data-testid') === 'book-summary-scroll';
}

function setLayout(next: Partial<typeof layout>) {
  Object.assign(layout, next);
}

beforeEach(() => {
  setLayout({ scrollHeight: 0, clientHeight: 0, offsetWidth: 0, clientWidth: 0 });
  for (const prop of faked) {
    const proto = prop === 'offsetWidth' ? HTMLElement.prototype : Element.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, prop)!;
    originals.set(prop, { proto, desc });
    Object.defineProperty(proto, prop, {
      configurable: true,
      get(this: Element) {
        return isBox(this) ? layout[prop] : desc.get!.call(this);
      },
    });
  }
});

afterEach(() => {
  for (const [prop, { proto, desc }] of originals) Object.defineProperty(proto, prop, desc);
  originals.clear();
});

const LONG = Array.from({ length: 9 }, (_, i) => `Paragraph ${i + 1}. ${'Lorem ipsum dolor sit amet. '.repeat(18)}`).join('\n\n');
const SHORT = 'A lone astronaut must save the earth from disaster.';

function scrollBox(top: number) {
  const box = screen.getByTestId('book-summary-scroll');
  box.scrollTop = top;
  fireEvent.scroll(box);
}

describe('BookSummary', () => {
  it('makes a long summary a labelled, focusable, capped scroll region with a bottom fade', () => {
    setLayout({ scrollHeight: 975, clientHeight: 240, offsetWidth: 704, clientWidth: 704 });
    render(<BookSummary text={LONG} />);

    const region = screen.getByRole('region', { name: 'Summary' });
    expect(region).toBe(screen.getByTestId('book-summary-scroll'));
    expect(region).toHaveAttribute('tabindex', '0');
    expect(region).toHaveClass('overflow-y-auto', 'overflow-x-hidden', 'overscroll-y-auto', 'max-h-[38dvh]', 'sm:max-h-[15rem]');
    expect(region.className).not.toMatch(/overscroll-y-contain/);

    const wrapper = screen.getByTestId('book-summary');
    expect(wrapper).toHaveClass('shrink-0', 'sm:shrink', 'basis-[content]', 'h-24', 'max-h-[38dvh]', 'sm:max-h-[15rem]');

    expect(screen.getByTestId('book-summary-fade-bottom')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByTestId('book-summary-fade-top')).toBeNull();

    const paragraph = region.querySelector('p')!;
    expect(paragraph.textContent).toBe(LONG);
    expect(paragraph).toHaveClass('whitespace-pre-wrap', 'break-words');
  });

  it('renders a short summary at natural height with no region, tab stop or fades', () => {
    setLayout({ scrollHeight: 49, clientHeight: 49 });
    render(<BookSummary text={SHORT} />);

    expect(screen.getByRole('heading', { name: 'Summary' })).toBeInTheDocument();
    expect(screen.getByText(SHORT)).toBeInTheDocument();
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.getByTestId('book-summary-scroll')).not.toHaveAttribute('tabindex');
    expect(screen.queryByTestId('book-summary-fade-bottom')).toBeNull();
    expect(screen.queryByTestId('book-summary-fade-top')).toBeNull();
  });

  it('treats content exactly at the cap as not overflowing', () => {
    setLayout({ scrollHeight: 240, clientHeight: 240 });
    render(<BookSummary text={LONG} />);
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('swaps the bottom fade for a top fade as the reader scrolls to the end', () => {
    setLayout({ scrollHeight: 975, clientHeight: 240 });
    render(<BookSummary text={LONG} />);

    scrollBox(300);
    expect(screen.getByTestId('book-summary-fade-top')).toBeInTheDocument();
    expect(screen.getByTestId('book-summary-fade-bottom')).toBeInTheDocument();

    scrollBox(975 - 240);
    expect(screen.getByTestId('book-summary-fade-top')).toBeInTheDocument();
    expect(screen.queryByTestId('book-summary-fade-bottom')).toBeNull();

    scrollBox(0);
    expect(screen.queryByTestId('book-summary-fade-top')).toBeNull();
    expect(screen.getByTestId('book-summary-fade-bottom')).toBeInTheDocument();
  });

  it('re-measures when the text changes', () => {
    setLayout({ scrollHeight: 975, clientHeight: 240 });
    const { rerender } = render(<BookSummary text={LONG} />);
    expect(screen.getByRole('region', { name: 'Summary' })).toBeInTheDocument();

    setLayout({ scrollHeight: 49, clientHeight: 49 });
    rerender(<BookSummary text={SHORT} />);
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByTestId('book-summary-fade-bottom')).toBeNull();
  });

  it('insets the fades by the scrollbar width so they never cover the scrollbar', () => {
    setLayout({ scrollHeight: 975, clientHeight: 240, offsetWidth: 704, clientWidth: 689 });
    render(<BookSummary text={LONG} />);
    expect(screen.getByTestId('book-summary-fade-bottom')).toHaveStyle({ right: '15px' });
  });

  it('keeps box-set bullet lists and long unbroken tokens as written', () => {
    const boxSet = 'This box set includes:\n• Book 1: The First\n• Book 2: The Second\n• Book 3: The Third';
    const token = 'See https://www.example-publisher.com/audiobooks/companion/' + 'x'.repeat(120);
    setLayout({ scrollHeight: 120, clientHeight: 120 });
    render(<BookSummary text={`${boxSet}\n\n${token}`} />);
    const paragraph = screen.getByTestId('book-summary-scroll').querySelector('p')!;
    expect(paragraph.textContent).toBe(`${boxSet}\n\n${token}`);
    expect(paragraph).toHaveClass('break-words');
  });
});
