/**
 * Component: Next Navigation Test Mock (URL-backed)
 * Documentation: documentation/settings-pages.md
 *
 * For pages that keep state in the URL with the native History API (jsdom only).
 * useSearchParams/usePathname read window.location and re-render on history.pushState,
 * history.replaceState and popstate, as Next.js does for those calls.
 * useRouter writes are spies only: they do not change the URL.
 */

import { vi } from 'vitest';

const LOCATION_CHANGE = 'test:locationchange';
const PATCHED = Symbol.for('rmab.test.historyPatched');

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
}));

export const urlRouterMock = router;

/** Points jsdom at `url` without adding a history entry */
export const setMockUrl = (url: string) => {
  window.history.replaceState(null, '', url);
};

/** Resolves after the next popstate (history.back/forward are async in jsdom) */
export const nextPopState = () =>
  new Promise<void>((resolve) => window.addEventListener('popstate', () => resolve(), { once: true }));

const patchHistory = () => {
  const history = window.history as History & { [PATCHED]?: boolean };
  if (history[PATCHED]) return;
  history[PATCHED] = true;
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method].bind(history);
    history[method] = (...args: Parameters<History['pushState']>) => {
      original(...args);
      window.dispatchEvent(new Event(LOCATION_CHANGE));
    };
  }
};

const subscribe = (onChange: () => void) => {
  window.addEventListener('popstate', onChange);
  window.addEventListener(LOCATION_CHANGE, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(LOCATION_CHANGE, onChange);
  };
};

vi.mock('next/navigation', async () => {
  const React = await import('react');
  patchHistory();
  return {
    useRouter: () => router,
    usePathname: () => React.useSyncExternalStore(subscribe, () => window.location.pathname),
    useSearchParams: () => {
      const search = React.useSyncExternalStore(subscribe, () => window.location.search);
      return React.useMemo(() => new URLSearchParams(search), [search]);
    },
    redirect: vi.fn(),
    notFound: vi.fn(),
  };
});
