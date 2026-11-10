/**
 * Component: Theme Switch Tests (selection, persistence, keyboard, screen-reader roles)
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { THEME_ATTRIBUTE, THEME_STORAGE_KEY } from '@/lib/constants/theme';
import { ThemeSwitch } from '@/components/layout/ThemeSwitch';

const html = () => document.documentElement;
const radio = (name: string) => screen.getByRole('radio', { name });
const expectChecked = async (name: string) => {
  await waitFor(() => expect(radio(name)).toHaveAttribute('aria-checked', 'true'));
  for (const other of ['System', 'Light', 'Dark'].filter((n) => n !== name)) {
    expect(radio(other)).toHaveAttribute('aria-checked', 'false');
  }
};

describe('ThemeSwitch', () => {
  beforeEach(() => {
    localStorage.clear();
    html().removeAttribute(THEME_ATTRIBUTE);
  });

  afterEach(() => {
    html().removeAttribute(THEME_ATTRIBUTE);
  });

  it('is a labelled radio group of three real buttons with System selected by default', async () => {
    render(<ThemeSwitch />);
    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual(['System', 'Light', 'Dark']);
    for (const r of radios) {
      expect(group).toContainElement(r);
      expect(r.tagName).toBe('BUTTON');
      expect(r).toHaveAttribute('type', 'button');
    }
    await expectChecked('System');
  });

  it('shows the choice already applied to the page', async () => {
    html().setAttribute(THEME_ATTRIBUTE, 'dark');
    render(<ThemeSwitch />);
    await expectChecked('Dark');
  });

  it('a click applies the choice at once and saves it; System clears it', async () => {
    const user = userEvent.setup();
    render(<ThemeSwitch />);

    await user.click(radio('Light'));
    await expectChecked('Light');
    expect(html().getAttribute(THEME_ATTRIBUTE)).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');

    await user.click(radio('Dark'));
    await expectChecked('Dark');
    expect(html().getAttribute(THEME_ATTRIBUTE)).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    await user.click(radio('System'));
    await expectChecked('System');
    expect(html().hasAttribute(THEME_ATTRIBUTE)).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('has one tab stop (the selected choice); arrows, Home and End move and select', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">before</button>
        <ThemeSwitch />
      </>
    );

    await user.click(screen.getByRole('button', { name: 'before' }));
    await user.tab();
    expect(radio('System')).toHaveFocus();
    expect(screen.getAllByRole('radio').map((r) => r.tabIndex)).toEqual([0, -1, -1]);

    await user.keyboard('{ArrowRight}');
    await expectChecked('Light');
    expect(radio('Light')).toHaveFocus();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(screen.getAllByRole('radio').map((r) => r.tabIndex)).toEqual([-1, 0, -1]);

    await user.keyboard('{ArrowDown}');
    await expectChecked('Dark');
    await user.keyboard('{ArrowRight}');
    await expectChecked('System');
    expect(radio('System')).toHaveFocus();

    await user.keyboard('{ArrowLeft}');
    await expectChecked('Dark');
    await user.keyboard('{ArrowUp}');
    await expectChecked('Light');
    await user.keyboard('{Home}');
    await expectChecked('System');
    await user.keyboard('{End}');
    await expectChecked('Dark');
    expect(radio('Dark')).toHaveFocus();
    expect(html().getAttribute(THEME_ATTRIBUTE)).toBe('dark');
  });

  it('follows a change applied elsewhere (another tab, through the init script)', async () => {
    render(<ThemeSwitch />);
    await expectChecked('System');
    act(() => html().setAttribute(THEME_ATTRIBUTE, 'light'));
    await expectChecked('Light');
  });

  it('still switches the page when storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    const user = userEvent.setup();
    render(<ThemeSwitch />);
    await user.click(radio('Dark'));
    await expectChecked('Dark');
    expect(html().getAttribute(THEME_ATTRIBUTE)).toBe('dark');
  });
});
