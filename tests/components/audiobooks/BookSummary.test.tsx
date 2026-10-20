/**
 * Component: Book Summary Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BookSummary } from '@/components/audiobooks/BookSummary';

// jsdom has no layout: fake the scroll box's geometry and the wrapper's resolved cap. Only the element
// tagged data-testid="book-summary-scroll" (and the wrapper's max-height) is faked; everything else is jsdom's.
const layout = { scrollHeight: 0, clientHeight: 0, offsetWidth: 0, clientWidth: 0, capPx: NaN };
const faked = ['scrollHeight', 'clientHeight', 'offsetWidth', 'clientWidth'] as const;
const originals = new Map<string, { proto: object; desc: PropertyDescriptor }>();
const realGetComputedStyle = window.getComputedStyle.bind(window);

function isBox(el: Element): boolean {
  return el.getAttribute('data-testid') === 'book-summary-scroll';
}

function setLayout(next: Partial<typeof layout>) {
  Object.assign(layout, next);
}

beforeEach(() => {
  setLayout({ scrollHeight: 0, clientHeight: 0, offsetWidth: 0, clientWidth: 0, capPx: NaN });
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
  // The wrapper's cap resolves to capPx (plus the 12px slack while the inline lift is applied).
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
    const style = realGetComputedStyle(el, pseudo);
    if (el.getAttribute('data-testid') !== 'book-summary') return style;
    const lifted = (el as HTMLElement).style.maxHeight !== '';
    return new Proxy(style, {
      get: (target, key) => (key === 'maxHeight' ? `${layout.capPx + (lifted ? 12 : 0)}px` : Reflect.get(target, key)),
    });
  });
  HTMLElement.prototype.scrollBy = vi.fn();
});

afterEach(() => {
  for (const [prop, { proto, desc }] of originals) Object.defineProperty(proto, prop, desc);
  originals.clear();
  vi.restoreAllMocks();
});

const LONG = Array.from({ length: 9 }, (_, i) => `Paragraph ${i + 1}. ${'Lorem ipsum dolor sit amet. '.repeat(18)}`).join('\n\n');
const SHORT = 'A lone astronaut must save the earth from disaster.';
const box = () => screen.getByTestId('book-summary-scroll');

function scrollBox(top: number) {
  box().scrollTop = top;
  fireEvent.scroll(box());
}

describe('BookSummary', () => {
  it('makes a long summary a labelled, focusable scroll region with a fade and a more chevron', () => {
    setLayout({ scrollHeight: 975, clientHeight: 240, offsetWidth: 704, clientWidth: 704, capPx: 240 });
    render(<BookSummary text={LONG} />);

    const region = screen.getByRole('region', { name: 'Summary' });
    expect(region).toBe(box());
    expect(region).toHaveAttribute('tabindex', '0');
    expect(region).toHaveClass('overflow-y-auto', 'overflow-x-hidden', 'overscroll-y-auto', 'min-h-0', 'focus-visible:outline-offset-4');
    expect(region.className).not.toMatch(/overscroll-y-contain|max-h-/);

    // The wrapper owns the cap and the shrink rules.
    expect(screen.getByTestId('book-summary')).toHaveClass(
      'shrink-0', '[@media(min-width:640px)_and_(min-height:500px)]:shrink', 'basis-[content]', 'h-24',
      '[--summary-cap:38dvh]', '[@media(min-width:640px)_and_(min-height:500px)]:[--summary-cap:15rem]', 'max-h-(--summary-cap)'
    );

    expect(screen.getByTestId('book-summary-fade-bottom')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByTestId('book-summary-fade-top')).toBeNull();

    const more = screen.getByTestId('book-summary-more');
    expect(more).toHaveAttribute('type', 'button');
    expect(more).toHaveAttribute('tabindex', '-1');
    expect(more).toHaveAttribute('aria-hidden', 'true');
    expect(more).toHaveClass('-bottom-2', 'w-8', 'h-8');

    const paragraph = region.querySelector('p')!;
    expect(paragraph.textContent).toBe(LONG);
    expect(paragraph).toHaveClass('whitespace-pre-wrap', 'break-words');
  });

  it('renders a short summary at natural height with no region, tab stop, fades or chevron', () => {
    setLayout({ scrollHeight: 49, clientHeight: 49, capPx: 240 });
    render(<BookSummary text={SHORT} />);

    expect(screen.getByRole('heading', { name: 'Summary' })).toBeInTheDocument();
    expect(screen.getByText(SHORT)).toBeInTheDocument();
    expect(screen.queryByRole('region')).toBeNull();
    expect(box()).not.toHaveAttribute('tabindex');
    expect(box()).toHaveClass('overflow-y-hidden');
    expect(screen.queryByTestId('book-summary-fade-bottom')).toBeNull();
    expect(screen.queryByTestId('book-summary-fade-top')).toBeNull();
    expect(screen.queryByTestId('book-summary-more')).toBeNull();
  });

  it('treats content exactly at the cap as not overflowing', () => {
    setLayout({ scrollHeight: 240, clientHeight: 240, capPx: 240 });
    render(<BookSummary text={LONG} />);
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.getByTestId('book-summary')).not.toHaveAttribute('style');
  });

  it('lifts the cap instead of scrolling when the text overruns it by 12px or less', () => {
    setLayout({ scrollHeight: 244, clientHeight: 240, capPx: 240 });
    render(<BookSummary text={LONG} />);
    const wrapper = screen.getByTestId('book-summary');
    expect(wrapper.style.maxHeight).toBe('calc(var(--summary-cap) + 12px)');

    // The lifted box now shows all 244px; the decision is against the cap, so it does not flip back.
    setLayout({ clientHeight: 244 });
    fireEvent.scroll(box());
    expect(wrapper.style.maxHeight).toBe('calc(var(--summary-cap) + 12px)');
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByTestId('book-summary-fade-bottom')).toBeNull();
    expect(screen.queryByTestId('book-summary-more')).toBeNull();
  });

  it('keeps the cap and scrolls when the text overruns it by more than 12px', () => {
    setLayout({ scrollHeight: 253, clientHeight: 240, capPx: 240 });
    render(<BookSummary text={LONG} />);
    expect(screen.getByTestId('book-summary').style.maxHeight).toBe('');
    expect(screen.getByRole('region', { name: 'Summary' })).toBeInTheDocument();
    expect(screen.getByTestId('book-summary-more')).toBeInTheDocument();
  });

  it('shows the chevron exactly while the bottom fade shows, and drops both at the end', () => {
    setLayout({ scrollHeight: 975, clientHeight: 240, capPx: 240 });
    render(<BookSummary text={LONG} />);

    scrollBox(300);
    expect(screen.getByTestId('book-summary-fade-top')).toBeInTheDocument();
    expect(screen.getByTestId('book-summary-fade-bottom')).toBeInTheDocument();
    expect(screen.getByTestId('book-summary-more')).toBeInTheDocument();

    scrollBox(975 - 240);
    expect(screen.getByTestId('book-summary-fade-top')).toBeInTheDocument();
    expect(screen.queryByTestId('book-summary-fade-bottom')).toBeNull();
    expect(screen.queryByTestId('book-summary-more')).toBeNull();

    scrollBox(0);
    expect(screen.queryByTestId('book-summary-fade-top')).toBeNull();
    expect(screen.getByTestId('book-summary-fade-bottom')).toBeInTheDocument();
    expect(screen.getByTestId('book-summary-more')).toBeInTheDocument();
  });

  it('scrolls the box by one box height minus both fades (40px) when the chevron is clicked', () => {
    setLayout({ scrollHeight: 975, clientHeight: 240, capPx: 240 });
    render(<BookSummary text={LONG} />);
    fireEvent.click(screen.getByTestId('book-summary-more'));
    expect(box().scrollBy).toHaveBeenCalledWith({ top: 200, behavior: 'smooth' });
  });

  it('jumps instead of animating when the reader prefers reduced motion', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({ matches: query.includes('reduce'), media: query } as MediaQueryList));
    setLayout({ scrollHeight: 975, clientHeight: 240, capPx: 240 });
    render(<BookSummary text={LONG} />);
    fireEvent.click(screen.getByTestId('book-summary-more'));
    expect(box().scrollBy).toHaveBeenCalledWith({ top: 200, behavior: 'auto' });
  });

  it('never steps less than 24px, even in a very short box', () => {
    setLayout({ scrollHeight: 975, clientHeight: 50, capPx: 240 });
    render(<BookSummary text={LONG} />);
    fireEvent.click(screen.getByTestId('book-summary-more'));
    expect(box().scrollBy).toHaveBeenCalledWith({ top: 24, behavior: 'smooth' });
  });

  it('still hints at a few hidden pixels when the box is shrunk below the cap', () => {
    setLayout({ scrollHeight: 150, clientHeight: 145, capPx: 240 });
    render(<BookSummary text={LONG} />);
    expect(screen.getByRole('region', { name: 'Summary' })).toBeInTheDocument();
    expect(screen.getByTestId('book-summary-fade-bottom')).toBeInTheDocument();
  });

  // jsdom has no focus fixup, so only the tab stop is checked here; the e2e spec checks that a real browser keeps focus.
  it('keeps the tab stop while the box is focused even if it stops overflowing, then drops it on blur', () => {
    setLayout({ scrollHeight: 975, clientHeight: 240, capPx: 240 });
    render(<BookSummary text={LONG} />);
    act(() => box().focus());
    expect(document.activeElement).toBe(box());

    setLayout({ scrollHeight: 240, clientHeight: 240 });
    fireEvent.scroll(box());
    expect(box()).toHaveAttribute('tabindex', '0');
    expect(screen.queryByTestId('book-summary-more')).toBeNull();

    act(() => box().blur());
    expect(box()).not.toHaveAttribute('tabindex');
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('re-measures when the text changes', () => {
    setLayout({ scrollHeight: 975, clientHeight: 240, capPx: 240 });
    const { rerender } = render(<BookSummary text={LONG} />);
    expect(screen.getByRole('region', { name: 'Summary' })).toBeInTheDocument();

    setLayout({ scrollHeight: 49, clientHeight: 49 });
    rerender(<BookSummary text={SHORT} />);
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByTestId('book-summary-fade-bottom')).toBeNull();
  });

  it('insets the fades and the chevron by the scrollbar width', () => {
    setLayout({ scrollHeight: 975, clientHeight: 240, offsetWidth: 704, clientWidth: 689, capPx: 240 });
    render(<BookSummary text={LONG} />);
    expect(screen.getByTestId('book-summary-fade-bottom')).toHaveStyle({ right: '15px' });
    expect(screen.getByTestId('book-summary-more')).toHaveStyle({ right: '19px' });
  });

  it('keeps box-set bullet lists and long unbroken tokens as written', () => {
    const boxSet = 'This box set includes:\n• Book 1: The First\n• Book 2: The Second\n• Book 3: The Third';
    const token = 'x'.repeat(80);
    setLayout({ scrollHeight: 120, clientHeight: 120, capPx: 240 });
    render(<BookSummary text={`${boxSet}\n\n${token}`} />);
    const paragraph = box().querySelector('p')!;
    expect(paragraph.textContent).toBe(`${boxSet}\n\n${token}`);
    expect(paragraph).toHaveClass('break-words');
  });
});
