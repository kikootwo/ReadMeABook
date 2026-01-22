/**
 * Component: Next Navigation Test Mock
 * Documentation: documentation/frontend/routing-auth.md
 */

import { vi } from 'vitest';

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
}));

let pathname = '/';
let searchParams = new URLSearchParams();

export const routerMock = router;

export const setMockPathname = (value: string) => {
  pathname = value;
};

export const setMockSearchParams = (value: string | URLSearchParams) => {
  searchParams = typeof value === 'string' ? new URLSearchParams(value) : value;
};

export const resetMockRouter = () => {
  router.push.mockReset();
  router.replace.mockReset();
  router.prefetch.mockReset();
  router.refresh.mockReset();
  router.back.mockReset();
  router.forward.mockReset();
  pathname = '/';
  searchParams = new URLSearchParams();
};

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => pathname,
  useSearchParams: () => searchParams,
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
