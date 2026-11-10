/**
 * Component: Theme Switch (System / Light / Dark, header user menu)
 * Documentation: documentation/frontend/components.md
 *
 * A radio group: one tab stop, arrow keys / Home / End move and select, a click selects.
 * The choice applies at once and is saved per browser.
 */

'use client';

import React, { useRef } from 'react';
import { ComputerDesktopIcon, MoonIcon, SunIcon } from '@heroicons/react/24/outline';
import type { ThemeChoice } from '@/lib/constants/theme';
import { applyThemeChoice } from '@/lib/utils/theme';
import { useThemeChoice } from '@/hooks/useThemeChoice';

const OPTIONS: { value: ThemeChoice; label: string; Icon: typeof SunIcon }[] = [
  { value: 'system', label: 'System', Icon: ComputerDesktopIcon },
  { value: 'light', label: 'Light', Icon: SunIcon },
  { value: 'dark', label: 'Dark', Icon: MoonIcon },
];

const KEY_STEP = new Map<string, number>([
  ['ArrowRight', 1],
  ['ArrowDown', 1],
  ['ArrowLeft', -1],
  ['ArrowUp', -1],
]);

export function ThemeSwitch() {
  const choice = useThemeChoice();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const select = (index: number, moveFocus: boolean) => {
    applyThemeChoice(OPTIONS[index].value);
    if (moveFocus) buttons.current[index]?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent, index: number) => {
    const step = KEY_STEP.get(event.key);
    let next: number | null = null;
    if (step !== undefined) next = (index + step + OPTIONS.length) % OPTIONS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = OPTIONS.length - 1;
    if (next === null) return;
    event.preventDefault();
    select(next, true);
  };

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="mx-3 my-2 grid grid-cols-3 gap-1 rounded-lg bg-gray-100 dark:bg-gray-900/60 p-1"
    >
      {OPTIONS.map(({ value, label, Icon }, index) => {
        const checked = choice === value;
        return (
          <button
            key={value}
            ref={(el) => {
              buttons.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => select(index, false)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`flex flex-col items-center gap-0.5 rounded-md py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              checked
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
            }`}
          >
            <Icon className="w-4 h-4" aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
