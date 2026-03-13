/**
 * Component: Token Login Page
 * Documentation: documentation/backend/services/auth.md
 */

'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

function TokenLoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setAuthData } = useAuth();

  useEffect(() => {
    const token = searchParams.get('token');

    if (!token) {
      router.replace('/login');
      return;
    }

    fetch('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          router.replace('/login');
          return;
        }

        localStorage.setItem('accessToken', data.accessToken);
        localStorage.setItem('refreshToken', data.refreshToken);
        localStorage.setItem('user', JSON.stringify(data.user));

        setAuthData(data.user, data.accessToken);
        window.location.href = '/';
      })
      .catch(() => {
        router.replace('/login');
      });
  }, [searchParams, router, setAuthData]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto mb-4"></div>
        <p className="text-gray-400 text-sm">Authenticating...</p>
      </div>
    </div>
  );
}

export default function TokenLoginPage() {
  return (
    <Suspense>
      <TokenLoginContent />
    </Suspense>
  );
}
