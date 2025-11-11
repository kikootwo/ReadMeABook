/**
 * Component: Login Page
 * Documentation: documentation/frontend/pages/login.md
 */

'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/Button';

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, login, isLoading: authLoading } = useAuth();

  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Redirect if already logged in
  useEffect(() => {
    if (user && !authLoading) {
      const redirect = searchParams.get('redirect') || '/';
      router.push(redirect);
    }
  }, [user, authLoading, router, searchParams]);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    setError(null);

    try {
      // Request PIN from Plex
      const response = await fetch('/api/auth/plex/login', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to initiate login');
      }

      const { pinId, authUrl } = await response.json();

      // Open Plex OAuth in popup
      const authWindow = window.open(
        authUrl,
        'plex-auth',
        'width=600,height=700,scrollbars=yes,resizable=yes'
      );

      if (!authWindow) {
        setError('Popup was blocked. Please allow popups for this site and try again.');
        setIsLoggingIn(false);
        return;
      }

      // Poll for authorization
      await login(pinId);

      // Close popup
      authWindow.close();

      // Redirect to intended page or homepage
      const redirect = searchParams.get('redirect') || '/';
      router.push(redirect);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed. Please try again.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 relative overflow-hidden">
      {/* Floating audiobook covers background */}
      <div className="absolute inset-0 overflow-hidden">
        {/* Decorative floating elements */}
        <div className="absolute top-10 left-10 w-32 h-48 bg-blue-500/10 rounded-lg animate-float-slow" />
        <div className="absolute top-40 right-20 w-28 h-40 bg-purple-500/10 rounded-lg animate-float-medium" />
        <div className="absolute bottom-20 left-1/4 w-36 h-52 bg-indigo-500/10 rounded-lg animate-float-fast" />
        <div className="absolute top-1/3 right-1/3 w-24 h-36 bg-pink-500/10 rounded-lg animate-float-slow" />
        <div className="absolute bottom-40 right-10 w-30 h-44 bg-cyan-500/10 rounded-lg animate-float-medium" />
      </div>

      {/* Main content */}
      <main className="relative z-10 min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md w-full">
          {/* Login card */}
          <div className="bg-gray-900/80 backdrop-blur-md rounded-2xl shadow-2xl p-8 md:p-12 border border-gray-700/50">
            {/* Logo/Title */}
            <div className="text-center mb-8">
              <h1 className="text-4xl md:text-5xl font-bold text-white mb-3">
                ReadMeABook
              </h1>
              <p className="text-gray-300 text-lg">
                Your Personal Audiobook Library Manager
              </p>
            </div>

            {/* Description */}
            <div className="mb-8 text-center">
              <p className="text-gray-400">
                Request audiobooks and they'll automatically download and appear in your Plex library
              </p>
            </div>

            {/* Error message */}
            {error && (
              <div className="mb-6 p-4 bg-red-500/10 border border-red-500/50 rounded-lg">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            {/* Login button */}
            <Button
              onClick={handleLogin}
              disabled={isLoggingIn}
              loading={isLoggingIn}
              className="w-full text-lg py-4 bg-orange-600 hover:bg-orange-700 text-white font-semibold"
            >
              {isLoggingIn ? 'Connecting to Plex...' : 'Login with Plex'}
            </Button>

            {/* Info text */}
            <div className="mt-6 text-center text-sm text-gray-500">
              <p>You'll be redirected to Plex to authorize this application</p>
            </div>
          </div>

          {/* Footer info */}
          <div className="mt-8 text-center text-sm text-gray-500">
            <p>
              Powered by{' '}
              <a
                href="https://www.plex.tv"
                target="_blank"
                rel="noopener noreferrer"
                className="text-orange-400 hover:text-orange-300 transition-colors"
              >
                Plex
              </a>
              {' '}&{' '}
              <a
                href="https://www.audible.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-orange-400 hover:text-orange-300 transition-colors"
              >
                Audible
              </a>
            </p>
          </div>
        </div>
      </main>

      {/* CSS animations - add to globals.css or tailwind config */}
      <style jsx>{`
        @keyframes float-slow {
          0%, 100% {
            transform: translateY(0px) translateX(0px) rotate(0deg);
          }
          33% {
            transform: translateY(-30px) translateX(20px) rotate(3deg);
          }
          66% {
            transform: translateY(-15px) translateX(-10px) rotate(-2deg);
          }
        }

        @keyframes float-medium {
          0%, 100% {
            transform: translateY(0px) translateX(0px) rotate(0deg);
          }
          50% {
            transform: translateY(-25px) translateX(-15px) rotate(-4deg);
          }
        }

        @keyframes float-fast {
          0%, 100% {
            transform: translateY(0px) translateX(0px) rotate(0deg);
          }
          50% {
            transform: translateY(-20px) translateX(15px) rotate(5deg);
          }
        }

        .animate-float-slow {
          animation: float-slow 20s ease-in-out infinite;
        }

        .animate-float-medium {
          animation: float-medium 15s ease-in-out infinite;
        }

        .animate-float-fast {
          animation: float-fast 10s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="text-white">Loading...</div>
      </div>
    }>
      <LoginContent />
    </Suspense>
  );
}
