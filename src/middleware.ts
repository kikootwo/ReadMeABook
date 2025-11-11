/**
 * Component: Next.js Middleware
 * Documentation: documentation/backend/middleware.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * Check if initial setup has been completed
 */
async function isSetupComplete(): Promise<boolean> {
  try {
    const config = await prisma.configuration.findUnique({
      where: { key: 'setup_completed' },
    });
    return config?.value === 'true';
  } catch (error) {
    // If database is not ready or table doesn't exist, setup is not complete
    return false;
  }
}

/**
 * Middleware to handle setup flow and authentication
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

  // Check if setup is complete
  const setupComplete = await isSetupComplete();

  if (!setupComplete) {
    // Setup not complete - redirect everything to /setup
    if (pathname !== '/setup') {
      return NextResponse.redirect(new URL('/setup', request.url));
    }
  } else {
    // Setup complete - block access to /setup
    if (pathname === '/setup') {
      return NextResponse.redirect(new URL('/', request.url));
    }
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
