/**
 * Component: Home Section Config Modal Tests (#309)
 * Documentation: documentation/features/home-sections.md
 *
 * The category picker lists Audible sub-categories under their parent, and a picked
 * sub-category is saved like a top-level category section.
 */

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HomeSectionConfigModal } from '@/components/home/HomeSectionConfigModal';
import type { HomeSection } from '@/lib/hooks/useHomeSections';

const fetcherMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/utils/api', () => ({ authenticatedFetcher: fetcherMock }));

const LIT = '18574426011';
const HORROR = '18574490011';
const SHARED = '18574496011';

/** The route's answer shape (two-level US catalog answer, trimmed). */
const CATEGORIES = [
  {
    id: '24427740011',
    name: 'Comedy & Humor',
    subcategories: [{ id: SHARED, name: 'Literature & Fiction', parentId: '24427740011' }],
  },
  {
    id: LIT,
    name: 'Literature & Fiction',
    subcategories: [
      { id: '18574449011', name: 'Classics', parentId: LIT },
      { id: HORROR, name: 'Horror', parentId: LIT },
      { id: SHARED, name: 'Humor & Satire', parentId: LIT },
    ],
  },
  { id: '18580606011', name: 'Science Fiction & Fantasy', subcategories: [] },
];

const POPULAR: HomeSection = { id: 's1', sectionType: 'popular', categoryId: null, categoryName: null, sortOrder: 0 };

function renderModal(sections: HomeSection[] = [POPULAR]) {
  const onSave = vi.fn().mockResolvedValue({});
  render(<HomeSectionConfigModal isOpen onClose={vi.fn()} sections={sections} onSave={onSave} />);
  return { onSave };
}

/** Open the picker and wait for the categories; falls back to the page where there is no named list. */
async function openPicker(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: 'Category' }));
  await screen.findByRole('button', { name: 'Science Fiction & Fantasy' });
  return screen.queryByRole('list', { name: 'Audible categories' }) ?? document.body;
}

/** Assert the element exists (fails on an assertion, not a query error) and return it. */
function present<T extends HTMLElement>(el: T | null): T {
  expect(el).not.toBeNull();
  return el!;
}

describe('HomeSectionConfigModal category picker (#309)', () => {
  beforeEach(() => {
    fetcherMock.mockResolvedValue({ success: true, categories: CATEGORIES });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists sub-categories under their parent and saves a picked sub-category', async () => {
    const { onSave } = renderModal();
    const picker = await openPicker();

    const toggle = present(within(picker).queryByRole('button', { name: 'Sub-categories of Literature & Fiction' }));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(picker).queryByRole('button', { name: 'Horror' })).toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const group = screen.getByRole('list', { name: 'Literature & Fiction sub-categories' });
    expect(toggle).toHaveAttribute('aria-controls', group.id);
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Classics', 'Horror', 'Humor & Satire']);

    fireEvent.click(within(group).getByRole('button', { name: 'Horror' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(onSave).toHaveBeenCalledWith([
      { sectionType: 'popular', categoryId: null, categoryName: null, sortOrder: 0 },
      { sectionType: 'category', categoryId: HORROR, categoryName: 'Horror', sortOrder: 1 },
    ]);
    expect(screen.getByRole('button', { name: 'Remove Horror' })).toBeInTheDocument();
    expect(fetcherMock).toHaveBeenCalledTimes(1);
  });

  it('a top-level category without sub-categories has no toggle and is still picked as before', async () => {
    const { onSave } = renderModal();
    const picker = await openPicker();

    expect(within(picker).queryByRole('button', { name: 'Sub-categories of Science Fiction & Fantasy' })).toBeNull();
    fireEvent.click(within(picker).getByRole('button', { name: 'Science Fiction & Fantasy' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(onSave.mock.calls[0][0][1]).toEqual({
      sectionType: 'category', categoryId: '18580606011', categoryName: 'Science Fiction & Fantasy', sortOrder: 1,
    });
  });

  it('the filter finds a sub-category by name and shows it under its parent', async () => {
    renderModal();
    const picker = await openPicker();

    fireEvent.change(present(screen.queryByRole('searchbox', { name: 'Filter categories' })), { target: { value: 'horr' } });

    const group = present(screen.queryByRole('list', { name: 'Literature & Fiction sub-categories' }));
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Horror']);
    expect(within(picker).queryByRole('button', { name: 'Comedy & Humor' })).toBeNull();
    expect(within(picker).queryByRole('button', { name: 'Science Fiction & Fantasy' })).toBeNull();
  });

  it('while filtering, a parent that matches by its own name can still be expanded to all its sub-categories', async () => {
    renderModal();
    const picker = await openPicker();

    fireEvent.change(present(screen.queryByRole('searchbox', { name: 'Filter categories' })), { target: { value: 'literature' } });

    const toggle = present(within(picker).queryByRole('button', { name: 'Sub-categories of Literature & Fiction' }));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list', { name: 'Literature & Fiction sub-categories' })).toBeNull();
    // Comedy & Humor shows only through its matching sub-category, so it has no toggle.
    expect(within(picker).queryByRole('button', { name: 'Sub-categories of Comedy & Humor' })).toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const group = screen.getByRole('list', { name: 'Literature & Fiction sub-categories' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Classics', 'Horror', 'Humor & Satire']);
  });

  it('marks an added sub-category as added under every parent that lists it', async () => {
    renderModal([
      POPULAR,
      { id: 's2', sectionType: 'category', categoryId: SHARED, categoryName: 'Humor & Satire', sortOrder: 1 },
    ]);
    const picker = await openPicker();

    fireEvent.click(present(within(picker).queryByRole('button', { name: 'Sub-categories of Comedy & Humor' })));
    fireEvent.click(present(within(picker).queryByRole('button', { name: 'Sub-categories of Literature & Fiction' })));

    const comedy = screen.getByRole('list', { name: 'Comedy & Humor sub-categories' });
    const lit = screen.getByRole('list', { name: 'Literature & Fiction sub-categories' });
    expect(within(comedy).getByRole('button', { name: /^Literature & Fiction/ })).toBeDisabled();
    expect(within(lit).getByRole('button', { name: /^Humor & Satire/ })).toBeDisabled();
    expect(within(lit).getByRole('button', { name: 'Horror' })).toBeEnabled();
  });
});
