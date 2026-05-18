/**
 * Component: useAutoRefreshControl Hook
 * Documentation: documentation/admin-dashboard.md
 *
 * Pause-on-interact registry shared across the logs page:
 *   - Components call register(reason) on focus/open and unregister(reason) on blur/close.
 *   - Non-empty reasons → paused (SWR refreshInterval=0). Empty → 10s polling.
 *   - 250ms debounce on pause-EXIT prevents "Paused" indicator flicker when a
 *     dropdown is opened-and-immediately-closed.
 *   - User-controlled off toggle persists to sessionStorage (per-tab).
 *   - manualRefresh() is provided to fire an out-of-band refetch.
 *
 * Singleton pattern: the page calls `useAutoRefreshControlProvider()` to OWN
 * the state, child components call `useAutoRefreshControl()` to CONSUME it
 * via the shared context.
 */

'use client';

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  createElement,
} from 'react';

const REFRESH_INTERVAL_MS = 10_000;
const PAUSE_EXIT_DEBOUNCE_MS = 250;
const STORAGE_KEY = 'admin-logs:auto-refresh-enabled';

export interface AutoRefreshControl {
  /** True when auto-refresh is currently effectively running (not paused, user-enabled). */
  isRunning: boolean;
  /** True when paused for any reason (interaction OR user toggle off). */
  isPaused: boolean;
  /** Stable list of human-readable pause reasons for the tooltip. */
  pauseReasons: string[];
  /** User toggle — when false, auto-refresh is forced off regardless of interactions. */
  enabled: boolean;
  setEnabled: (next: boolean) => void;
  /** SWR refreshInterval value to pass: REFRESH_INTERVAL_MS when running, 0 when paused. */
  effectiveInterval: number;
  /** Register a pause reason (idempotent by reason key). */
  register: (reason: string) => void;
  /** Unregister a pause reason (idempotent). */
  unregister: (reason: string) => void;
  /** Trigger a one-shot refresh now (consumer wires this to SWR `mutate`). */
  manualRefresh: () => void;
  /** Setter the consumer (page.tsx) uses to wire the mutate fn into the registry. */
  setMutate: (fn: (() => Promise<unknown> | void) | null) => void;
  /** Setter the consumer uses to broadcast "we just got fresh data at <Date>". */
  setLastUpdatedAt: (ts: number) => void;
  /** Timestamp of last successful refresh (ms since epoch); 0 if never. */
  lastUpdatedAt: number;
}

const AutoRefreshContext = createContext<AutoRefreshControl | null>(null);

// ---------------------------------------------------------------------------
// Provider — owns state; rendered by page.tsx so all children share it.
// ---------------------------------------------------------------------------
export function AutoRefreshControlProvider({ children }: { children: ReactNode }) {
  const value = useAutoRefreshControlImpl();
  return createElement(AutoRefreshContext.Provider, { value }, children);
}

// ---------------------------------------------------------------------------
// Consumer hook — used by every component that wants to read state OR
// register/unregister pause reasons.
// ---------------------------------------------------------------------------
export function useAutoRefreshControl(): AutoRefreshControl {
  const ctx = useContext(AutoRefreshContext);
  if (!ctx) {
    throw new Error(
      'useAutoRefreshControl must be used inside <AutoRefreshControlProvider>'
    );
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Implementation — only called once by the provider.
// ---------------------------------------------------------------------------
function useAutoRefreshControlImpl(): AutoRefreshControl {
  // User toggle, hydrated from sessionStorage post-mount (SSR-safe).
  const [enabled, setEnabledState] = useState(true);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = window.sessionStorage.getItem(STORAGE_KEY);
      if (stored === '0') setEnabledState(false);
    } catch {
      // sessionStorage can throw in private mode — fall through with default.
    }
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    if (typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      // ignore
    }
  }, []);

  // Pause reasons — a Set kept in a ref so register/unregister don't churn
  // React state on every effect mount/unmount. We mirror SIZE/CONTENT into a
  // version counter + a debounced visible-reasons state for rendering.
  const reasonsRef = useRef<Set<string>>(new Set());
  const [visibleReasons, setVisibleReasons] = useState<string[]>([]);
  const exitDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushVisible = useCallback(() => {
    setVisibleReasons(Array.from(reasonsRef.current).sort());
  }, []);

  const register = useCallback(
    (reason: string) => {
      if (reasonsRef.current.has(reason)) return;
      reasonsRef.current.add(reason);
      // Entry → reflect immediately (no flicker concern when ADDING a reason).
      if (exitDebounceRef.current) {
        clearTimeout(exitDebounceRef.current);
        exitDebounceRef.current = null;
      }
      flushVisible();
    },
    [flushVisible]
  );

  const unregister = useCallback(
    (reason: string) => {
      if (!reasonsRef.current.has(reason)) return;
      reasonsRef.current.delete(reason);
      // Exit → debounce so brief blips (dropdown opened-then-closed) don't flash.
      if (exitDebounceRef.current) clearTimeout(exitDebounceRef.current);
      exitDebounceRef.current = setTimeout(() => {
        exitDebounceRef.current = null;
        flushVisible();
      }, PAUSE_EXIT_DEBOUNCE_MS);
    },
    [flushVisible]
  );

  // Clean up any pending debounce on unmount.
  useEffect(() => {
    return () => {
      if (exitDebounceRef.current) clearTimeout(exitDebounceRef.current);
    };
  }, []);

  // Manual refresh — page.tsx wires SWR's `mutate` in via setMutate.
  const mutateRef = useRef<(() => Promise<unknown> | void) | null>(null);
  const setMutate = useCallback((fn: (() => Promise<unknown> | void) | null) => {
    mutateRef.current = fn;
  }, []);
  const manualRefresh = useCallback(() => {
    const fn = mutateRef.current;
    if (fn) fn();
  }, []);

  // lastUpdatedAt — page.tsx broadcasts when SWR data lands.
  const [lastUpdatedAt, setLastUpdatedAt] = useState(0);

  const isInteractionPaused = visibleReasons.length > 0;
  const isPaused = !enabled || isInteractionPaused;
  const isRunning = !isPaused;
  const effectiveInterval = isRunning ? REFRESH_INTERVAL_MS : 0;

  const pauseReasons = useMemo(() => {
    const out: string[] = [];
    if (!enabled) out.push('Auto-refresh off');
    out.push(...visibleReasons);
    return out;
  }, [enabled, visibleReasons]);

  return {
    isRunning,
    isPaused,
    pauseReasons,
    enabled,
    setEnabled,
    effectiveInterval,
    register,
    unregister,
    manualRefresh,
    setMutate,
    setLastUpdatedAt,
    lastUpdatedAt,
  };
}

// ---------------------------------------------------------------------------
// Convenience: useRegisterPauseReason — fire-and-forget register/unregister
// based on a boolean flag (used by components that want declarative usage).
// ---------------------------------------------------------------------------
export function useRegisterPauseReason(reason: string, active: boolean): void {
  const { register, unregister } = useAutoRefreshControl();
  useEffect(() => {
    if (active) register(reason);
    else unregister(reason);
    return () => unregister(reason);
  }, [active, reason, register, unregister]);
}
