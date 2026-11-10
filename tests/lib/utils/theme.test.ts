/**
 * Component: Theme Choice Helpers Tests (pre-paint script, parse, apply)
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_ATTRIBUTE, THEME_STORAGE_KEY } from '@/lib/constants/theme';
import {
  THEME_INIT_SCRIPT,
  applyThemeChoice,
  parseThemeChoice,
  readAppliedThemeChoice,
  subscribeToThemeChoice,
} from '@/lib/utils/theme';

type StorageListener = (event: { key: string | null }) => void;

/** Runs the inline script against a fresh document and a fake window; returns both. */
function runInitScript(storage: () => Pick<Storage, 'getItem'>) {
  const doc = document.implementation.createHTMLDocument('t');
  const listeners: StorageListener[] = [];
  const win = {
    get localStorage() {
      return storage();
    },
    addEventListener: (type: string, listener: StorageListener) => {
      if (type === 'storage') listeners.push(listener);
    },
  };
  new Function('window', 'document', THEME_INIT_SCRIPT)(win, doc);
  return { root: doc.documentElement, fire: (key: string | null) => listeners.forEach((l) => l({ key })) };
}

const stored = (value: string | null) => () => ({ getItem: (key: string) => (key === THEME_STORAGE_KEY ? value : null) });

describe('parseThemeChoice', () => {
  it('keeps the three choices and turns anything else into System', () => {
    expect(parseThemeChoice('system')).toBe('system');
    expect(parseThemeChoice('light')).toBe('light');
    expect(parseThemeChoice('dark')).toBe('dark');
    for (const junk of [null, undefined, '', 'Dark', 'blue', 1, {}]) expect(parseThemeChoice(junk)).toBe('system');
  });
});

describe('THEME_INIT_SCRIPT (runs in <head> before first paint)', () => {
  it('sets <html data-theme> for a stored Light or Dark', () => {
    expect(runInitScript(stored('light')).root.getAttribute(THEME_ATTRIBUTE)).toBe('light');
    expect(runInitScript(stored('dark')).root.getAttribute(THEME_ATTRIBUTE)).toBe('dark');
  });

  it('leaves <html> alone (System) when nothing is stored', () => {
    expect(runInitScript(stored(null)).root.hasAttribute(THEME_ATTRIBUTE)).toBe(false);
  });

  it('treats an invalid stored value as System', () => {
    for (const junk of ['system', 'DARK', 'purple', '"dark"', '']) {
      expect(runInitScript(stored(junk)).root.hasAttribute(THEME_ATTRIBUTE)).toBe(false);
    }
  });

  it('falls back to System silently when storage is blocked or getItem throws', () => {
    const blocked = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    };
    const failing = () => ({
      getItem: () => {
        throw new Error('storage broken');
      },
    });
    expect(() => runInitScript(blocked)).not.toThrow();
    expect(runInitScript(blocked).root.hasAttribute(THEME_ATTRIBUTE)).toBe(false);
    expect(runInitScript(failing).root.hasAttribute(THEME_ATTRIBUTE)).toBe(false);
  });

  it('follows a change made in another tab (storage event for its key, or a clear)', () => {
    let value: string | null = 'light';
    const { root, fire } = runInitScript(() => ({ getItem: () => value }));
    value = 'dark';
    fire('accessToken');
    expect(root.getAttribute(THEME_ATTRIBUTE)).toBe('light');
    fire(THEME_STORAGE_KEY);
    expect(root.getAttribute(THEME_ATTRIBUTE)).toBe('dark');
    value = null;
    fire(null);
    expect(root.hasAttribute(THEME_ATTRIBUTE)).toBe(false);
  });

  it('names the storage key and attribute from the constants module', () => {
    expect(THEME_INIT_SCRIPT).toContain(JSON.stringify(THEME_STORAGE_KEY));
    expect(THEME_INIT_SCRIPT).toContain(JSON.stringify(THEME_ATTRIBUTE));
    expect(THEME_INIT_SCRIPT).toContain('["light","dark"]');
  });
});

describe('applyThemeChoice / readAppliedThemeChoice', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute(THEME_ATTRIBUTE);
  });

  afterEach(() => {
    document.documentElement.removeAttribute(THEME_ATTRIBUTE);
  });

  it('applies and stores Light / Dark; System removes both', () => {
    applyThemeChoice('dark');
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(readAppliedThemeChoice()).toBe('dark');

    applyThemeChoice('light');
    expect(readAppliedThemeChoice()).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');

    applyThemeChoice('system');
    expect(document.documentElement.hasAttribute(THEME_ATTRIBUTE)).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(readAppliedThemeChoice()).toBe('system');
  });

  it('still applies the choice to the page when storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(() => applyThemeChoice('light')).not.toThrow();
    expect(readAppliedThemeChoice()).toBe('light');
  });

  it('reads an unknown attribute value as System', () => {
    document.documentElement.setAttribute(THEME_ATTRIBUTE, 'sepia');
    expect(readAppliedThemeChoice()).toBe('system');
  });

  it('notifies subscribers when the applied choice changes, until unsubscribed', async () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeToThemeChoice(onChange);
    applyThemeChoice('dark');
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    unsubscribe();
    applyThemeChoice('light');
    await new Promise((r) => setTimeout(r, 0));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
