/**
 * Component: Login Page
 * Documentation: documentation/frontend/pages/login.md
 */

'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/Button';
import Image from 'next/image';

interface BookCover {
  asin: string;
  title: string;
  author: string;
  coverUrl: string;
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, login, setAuthData, isLoading: authLoading } = useAuth();

  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [bookCovers, setBookCovers] = useState<BookCover[]>([]);
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile viewport
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Fetch random popular book covers
  useEffect(() => {
    const fetchCovers = async () => {
      try {
        const response = await fetch('/api/audiobooks/covers');
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.covers.length > 0) {
            setBookCovers(data.covers);
          }
        }
      } catch (err) {
        console.error('Failed to fetch book covers:', err);
        // Silently fail - page will show without covers
      }
    };

    fetchCovers();
  }, []);

  // Redirect if already logged in
  useEffect(() => {
    if (user && !authLoading) {
      const redirect = searchParams.get('redirect') || '/';
      router.push(redirect);
    }
  }, [user, authLoading, router, searchParams]);

  // Handle Plex OAuth callback (mobile redirect with cookies)
  useEffect(() => {
    const authSuccess = searchParams.get('auth');

    if (authSuccess === 'success' && !user && !authLoading) {
      // Tokens are already set in cookies by the callback route
      // Read them and store in localStorage for the auth context
      const getCookie = (name: string) => {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop()?.split(';').shift();
        return null;
      };

      const accessToken = getCookie('accessToken');
      const userDataStr = getCookie('userData');

      if (accessToken && userDataStr) {
        try {
          const userData = JSON.parse(decodeURIComponent(userDataStr));

          // Store in localStorage for AuthContext
          localStorage.setItem('accessToken', accessToken);
          const refreshToken = getCookie('refreshToken');
          if (refreshToken) {
            localStorage.setItem('refreshToken', refreshToken);
          }
          localStorage.setItem('user', JSON.stringify(userData));

          // Update auth context
          setAuthData(userData, accessToken);

          // Redirect to home
          const redirect = searchParams.get('redirect') || '/';
          router.push(redirect);
        } catch (err) {
          console.error('Failed to parse auth data from cookies:', err);
          setError('Login failed. Please try again.');
        }
      }
    }
  }, [searchParams, user, authLoading, setAuthData, router]);

  const handlePlexLogin = async () => {
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

      // On mobile, redirect to Plex OAuth instead of using popup
      // The callback route will set cookies and redirect back to /login?auth=success
      if (isMobile) {
        window.location.href = authUrl;
        return;
      }

      // Desktop: Open Plex OAuth in popup
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

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: adminUsername,
          password: adminPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Login failed');
      }

      // Store tokens
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      localStorage.setItem('user', JSON.stringify(data.user));

      // Update auth context immediately
      setAuthData(data.user, data.accessToken);

      // Redirect to intended page or homepage
      const redirect = searchParams.get('redirect') || '/';
      router.push(redirect);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Admin login failed. Please try again.');
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

  // Generate random positions for covers
  const generateCoverPosition = (index: number, total: number) => {
    // Create a seeded random for consistent positions per index
    const random = (seed: number) => {
      const x = Math.sin(seed) * 10000;
      return x - Math.floor(x);
    };

    // Different animation types
    const animations = ['animate-float-slow', 'animate-float-medium', 'animate-float-fast'];
    const animation = animations[index % 3];

    // Random size between 80-160px
    const size = 80 + random(index * 7) * 80;

    // Random position (0-100% for both axes)
    const top = random(index * 13) * 100;
    const left = random(index * 17) * 100;

    // Random opacity (0.15-0.35 for subtle layering)
    const opacity = 0.15 + random(index * 23) * 0.2;

    // Random delay (0-10s)
    const delay = random(index * 29) * 10;

    // Layer depth (z-index) - some in front, some behind
    const zIndex = Math.floor(random(index * 31) * 20);

    return {
      top: `${top}%`,
      left: `${left}%`,
      size: Math.floor(size),
      animation,
      delay: `${delay.toFixed(1)}s`,
      opacity: parseFloat(opacity.toFixed(2)),
      zIndex,
    };
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 relative overflow-hidden">
      {/* Floating audiobook covers background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {bookCovers.length > 0 ? (
          <>
            {/* Floating real book covers - use fewer on mobile (30) vs desktop (100) for better performance */}
            {bookCovers.slice(0, isMobile ? 30 : 100).map((book, index) => {
              const pos = generateCoverPosition(index, bookCovers.length);
              const style: React.CSSProperties = {
                animationDelay: pos.delay,
                opacity: pos.opacity,
                zIndex: pos.zIndex,
              };

              return (
                <div
                  key={book.asin}
                  className={`absolute ${pos.animation}`}
                  style={{
                    ...style,
                    top: pos.top,
                    left: pos.left,
                    width: `${pos.size}px`,
                    height: `${pos.size * 1.5}px`,
                  }}
                >
                  <div className="relative w-full h-full rounded-lg shadow-2xl overflow-hidden transform hover:scale-105 transition-transform duration-300">
                    <Image
                      src={book.coverUrl}
                      alt={book.title}
                      fill
                      className="object-cover"
                      sizes={`${pos.size}px`}
                      quality={70}
                      priority={index < 10}
                      loading={index < 10 ? 'eager' : 'lazy'}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                  </div>
                </div>
              );
            })}
          </>
        ) : (
          <>
            {/* Fallback decorative floating elements if covers don't load */}
            <div className="absolute top-10 left-10 w-32 h-48 bg-blue-500/10 rounded-lg animate-float-slow" />
            <div className="absolute top-40 right-20 w-28 h-40 bg-purple-500/10 rounded-lg animate-float-medium" />
            <div className="absolute bottom-20 left-1/4 w-36 h-52 bg-indigo-500/10 rounded-lg animate-float-fast" />
            <div className="absolute top-1/3 right-1/3 w-24 h-36 bg-pink-500/10 rounded-lg animate-float-slow" />
            <div className="absolute bottom-40 right-10 w-30 h-44 bg-cyan-500/10 rounded-lg animate-float-medium" />
          </>
        )}
      </div>

      {/* Main content - high z-index to appear above all floating covers */}
      <main className="relative z-50 min-h-screen flex items-center justify-center px-4 py-8">
        <div className="max-w-md w-full">
          {/* Login card */}
          <div className="bg-gray-900/80 backdrop-blur-md rounded-2xl shadow-2xl p-6 sm:p-8 md:p-12 border border-gray-700/50">
            {/* Logo/Title */}
            <div className="text-center mb-6 sm:mb-8">
              <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white mb-2 sm:mb-3">
                ReadMeABook
              </h1>
              <p className="text-gray-300 text-base sm:text-lg">
                Your Personal Audiobook Library Manager
              </p>
            </div>

            {/* Description */}
            <div className="mb-6 sm:mb-8 text-center">
              <p className="text-gray-400 text-sm sm:text-base">
                Request audiobooks and they'll automatically download and appear in your Plex library
              </p>
            </div>

            {/* Error message */}
            {error && (
              <div className="mb-6 p-4 bg-red-500/10 border border-red-500/50 rounded-lg">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            {/* Plex Login button */}
            <Button
              onClick={handlePlexLogin}
              disabled={isLoggingIn}
              loading={isLoggingIn}
              className="w-full text-base sm:text-lg py-3 sm:py-4 bg-orange-600 hover:bg-orange-700 text-white font-semibold"
            >
              {isLoggingIn ? 'Connecting to Plex...' : 'Login with Plex'}
            </Button>

            {/* Info text */}
            <div className="mt-4 sm:mt-6 text-center text-xs sm:text-sm text-gray-500">
              <p>You'll be redirected to Plex to authorize this application</p>
            </div>

            {/* Divider */}
            <div className="relative my-6 sm:my-8">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-700"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-4 bg-gray-900/80 text-gray-400">or</span>
              </div>
            </div>

            {/* Admin Login Toggle */}
            <button
              onClick={() => setShowAdminLogin(!showAdminLogin)}
              className="w-full text-sm text-gray-400 hover:text-gray-300 transition-colors py-2 flex items-center justify-center gap-2"
            >
              {showAdminLogin ? (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                  </svg>
                  Hide Admin Login
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                  Admin Login
                </>
              )}
            </button>

            {/* Admin Login Form */}
            {showAdminLogin && (
              <form onSubmit={handleAdminLogin} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="admin-username" className="block text-sm font-medium text-gray-300 mb-2">
                    Username
                  </label>
                  <input
                    type="text"
                    id="admin-username"
                    value={adminUsername}
                    onChange={(e) => setAdminUsername(e.target.value)}
                    className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    placeholder="admin"
                    required
                    autoComplete="username"
                  />
                </div>
                <div>
                  <label htmlFor="admin-password" className="block text-sm font-medium text-gray-300 mb-2">
                    Password
                  </label>
                  <input
                    type="password"
                    id="admin-password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    placeholder="••••••••"
                    required
                    autoComplete="current-password"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={isLoggingIn}
                  loading={isLoggingIn}
                  className="w-full bg-gray-700 hover:bg-gray-600 text-white font-semibold"
                >
                  {isLoggingIn ? 'Logging in...' : 'Login as Admin'}
                </Button>
              </form>
            )}
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

      {/* CSS animations for floating book covers */}
      <style jsx>{`
        @keyframes float-slow {
          0%, 100% {
            transform: translateY(0px) translateX(0px) rotate(0deg) scale(1);
          }
          25% {
            transform: translateY(-25px) translateX(15px) rotate(2deg) scale(1.03);
          }
          50% {
            transform: translateY(-35px) translateX(25px) rotate(4deg) scale(1.05);
          }
          75% {
            transform: translateY(-20px) translateX(-10px) rotate(-2deg) scale(1.02);
          }
        }

        @keyframes float-medium {
          0%, 100% {
            transform: translateY(0px) translateX(0px) rotate(0deg) scale(1);
          }
          33% {
            transform: translateY(-30px) translateX(-20px) rotate(-3deg) scale(1.04);
          }
          66% {
            transform: translateY(-15px) translateX(10px) rotate(3deg) scale(1.02);
          }
        }

        @keyframes float-fast {
          0%, 100% {
            transform: translateY(0px) translateX(0px) rotate(0deg) scale(1);
          }
          50% {
            transform: translateY(-28px) translateX(18px) rotate(5deg) scale(1.06);
          }
        }

        .animate-float-slow {
          animation: float-slow 22s ease-in-out infinite;
          filter: blur(0px);
          transition: filter 0.3s ease, transform 0.3s ease;
        }

        .animate-float-medium {
          animation: float-medium 16s ease-in-out infinite;
          filter: blur(0px);
          transition: filter 0.3s ease, transform 0.3s ease;
        }

        .animate-float-fast {
          animation: float-fast 12s ease-in-out infinite;
          filter: blur(0px);
          transition: filter 0.3s ease, transform 0.3s ease;
        }

        .animate-float-slow:hover,
        .animate-float-medium:hover,
        .animate-float-fast:hover {
          animation-play-state: paused;
          filter: blur(0px);
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
