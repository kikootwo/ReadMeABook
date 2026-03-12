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

    fetch(`/api/auth/token/login?token=${encodeURIComponent(token)}`)
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

  return null;
}

export default function TokenLoginPage() {
  return (
    <Suspense>
      <TokenLoginContent />
    </Suspense>
  );
}
