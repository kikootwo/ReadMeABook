/**
 * Component: Library Page (/library)
 * Documentation: documentation/features/library-view.md
 */

'use client';

import { Suspense } from 'react';
import { Header } from '@/components/layout/Header';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { ToastProvider } from '@/components/ui/Toast';
import { LibraryView } from '@/components/library/LibraryView';

export default function LibraryPage() {
  // useSearchParams (the query in the URL) needs a Suspense boundary for the static build
  return (
    <Suspense fallback={null}>
      <ProtectedRoute>
        <ToastProvider>
          <div className="min-h-screen">
            <Header />
            <LibraryView />
          </div>
        </ToastProvider>
      </ProtectedRoute>
    </Suspense>
  );
}
