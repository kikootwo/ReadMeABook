/**
 * Component: Next.js Middleware
 * Documentation: documentation/backend/middleware.md
 *
 * Note: Edge Runtime compatible - no Node.js APIs or Prisma
 */

import { NextRequest, NextResponse } from 'next/server';

/**
 * Middleware to handle setup flow
 *
 * We check setup status via a lightweight API call instead of Prisma
 * since middleware runs in Edge Runtime which doesn't support Node.js APIs
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow API routes, static files, and _next internal routes
  if (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/static/') ||
    pathname.includes('.')  // Files with extensions (images, css, etc.)
  ) {
    return NextResponse.next();
  }

  // Check setup status via API endpoint
  const requestUrl = request.url;
  const internalBaseUrl = process.env.SETUP_CHECK_BASE_URL?.trim();
  const defaultPort = process.env.PORT || '3030';
  const fallbackOrigin = `http://127.0.0.1:${defaultPort}`;
  const candidateOrigins = [internalBaseUrl, request.nextUrl.origin, fallbackOrigin]
    .filter((origin, index, list): origin is string => Boolean(origin) && list.indexOf(origin) === index);

  let lastError: unknown = null;
  for (const origin of candidateOrigins) {
    try {
      const checkUrl = new URL('/api/setup/status', origin);
      const response = await fetch(checkUrl, {
        method: 'GET',
        headers: {
          'x-middleware-request': 'true',
        },
        // Avoid caching to ensure we read latest setup status
        cache: 'no-store',
      });

      if (response.ok) {
        const { setupComplete } = await response.json();

        if (!setupComplete && pathname !== '/setup') {
          // Setup not complete - redirect to /setup
          return NextResponse.redirect(new URL('/setup', requestUrl));
        }

        if (setupComplete && pathname === '/setup') {
          // Setup complete - block access to /setup
          return NextResponse.redirect(new URL('/', requestUrl));
        }
      }

      // Successful request (even if response not ok) means no need to try other origins
      return NextResponse.next();
    } catch (error) {
      lastError = error;
      continue;
    }
  }

  if (lastError) {
    // If all checks fail, allow request through but log the failure once per request
    console.error('[Middleware] Setup check failed:', lastError, { candidateOrigins });
  }

  return NextResponse.next();
}

/**
 * Configure which routes the middleware should run on
 */
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api routes (handled separately)
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
