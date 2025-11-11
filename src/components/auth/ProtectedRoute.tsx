/**
 * Component: Protected Route Wrapper
 * Documentation: documentation/frontend/routing-auth.md
 */

'use client';

import { ReactNode, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

interface ProtectedRouteProps {
  children: ReactNode;
  requireAdmin?: boolean;
}

export function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    // Wait for auth to finish loading
    if (isLoading) return;

    // Not authenticated - redirect to login with return URL
    if (!user) {
      const redirectUrl = encodeURIComponent(pathname);
      router.push(`/login?redirect=${redirectUrl}`);
      return;
    }

    // Admin required but user is not admin - redirect to homepage
    if (requireAdmin && user.role !== 'admin') {
      router.push('/');
      return;
    }
  }, [user, isLoading, requireAdmin, router, pathname]);

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  // Not authenticated or wrong role - don't render children
  // (redirect will happen in useEffect)
  if (!user || (requireAdmin && user.role !== 'admin')) {
    return null;
  }

  // User is authenticated and authorized - render children
  return <>{children}</>;
}
