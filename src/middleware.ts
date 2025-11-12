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
  try {
    const checkUrl = new URL('/api/setup/status', request.url);
    const response = await fetch(checkUrl, {
      method: 'GET',
      headers: {
        'x-middleware-request': 'true',
      },
    });

    if (response.ok) {
      const { setupComplete } = await response.json();

      if (!setupComplete && pathname !== '/setup') {
        // Setup not complete - redirect to /setup
        return NextResponse.redirect(new URL('/setup', request.url));
      }

      if (setupComplete && pathname === '/setup') {
        // Setup complete - block access to /setup
        return NextResponse.redirect(new URL('/', request.url));
      }
    }
  } catch (error) {
    // If check fails, allow request through to avoid breaking the app
    console.error('[Middleware] Setup check failed:', error);
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
