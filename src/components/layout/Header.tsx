/**
 * Component: Header Navigation
 * Documentation: documentation/frontend/components.md
 */

'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/Button';

export function Header() {
  const { user, logout } = useAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showBookDate, setShowBookDate] = useState(false);

  // Check if BookDate is configured
  useEffect(() => {
    async function checkBookDate() {
      if (!user) {
        setShowBookDate(false);
        return;
      }

      try {
        const accessToken = localStorage.getItem('accessToken');
        if (!accessToken) {
          setShowBookDate(false);
          return;
        }

        const response = await fetch('/api/bookdate/config', {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        });

        const data = await response.json();
        // Show BookDate to any user with verified and enabled configuration
        setShowBookDate(
          data.config &&
          data.config.isVerified &&
          data.config.isEnabled
        );
      } catch (error) {
        console.error('Failed to check BookDate config:', error);
        setShowBookDate(false);
      }
    }

    checkBookDate();
  }, [user]);

  const handleLogin = async () => {
    try {
      const response = await fetch('/api/auth/plex/login', { method: 'POST' });
      const data = await response.json();

      if (data.success) {
        // Open Plex OAuth in popup
        window.open(data.authUrl, 'plex-auth', 'width=600,height=700');
      }
    } catch (error) {
      console.error('Login failed:', error);
    }
  };

  return (
    <header className="bg-white dark:bg-gray-800 shadow-sm sticky top-0 z-40">
      <div className="container mx-auto px-4 py-3 md:py-4 max-w-7xl">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <img
              src="/rmab_32x32.png"
              alt="ReadMeABook Logo"
              className="w-8 h-8"
            />
            <span className="text-lg md:text-xl font-bold text-gray-900 dark:text-gray-100">
              ReadMeABook
            </span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-6">
            <Link
              href="/"
              className="text-gray-700 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            >
              Home
            </Link>
            <Link
              href="/search"
              className="text-gray-700 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            >
              Search
            </Link>
            {showBookDate && (
              <Link
                href="/bookdate"
                className="text-gray-700 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              >
                BookDate
              </Link>
            )}
            {user && (
              <Link
                href="/requests"
                className="text-gray-700 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              >
                My Requests
              </Link>
            )}
            {user?.role === 'admin' && (
              <Link
                href="/admin"
                className="text-gray-700 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              >
                Admin
              </Link>
            )}
          </nav>

          {/* Mobile Menu Button & User Menu */}
          <div className="flex items-center gap-2 md:gap-4">
            {/* Search Button (visible on mobile) */}
            <Link
              href="/search"
              className="md:hidden p-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
              aria-label="Search"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </Link>

            {/* Mobile Menu Button */}
            <button
              onClick={() => setShowMobileMenu(!showMobileMenu)}
              className="md:hidden p-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
              aria-label="Toggle menu"
            >
              {showMobileMenu ? (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>

            {user ? (
              <div className="relative">
                <button
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="flex items-center gap-2 hover:opacity-80 transition-opacity"
                >
                  {user.avatarUrl ? (
                    <img
                      src={user.avatarUrl}
                      alt={user.username}
                      className="w-8 h-8 rounded-full"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white font-medium">
                      {user.username.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className="hidden md:inline text-gray-700 dark:text-gray-300">
                    {user.username}
                  </span>
                </button>

                {showUserMenu && (
                  <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg py-1 z-50">
                    <Link
                      href="/profile"
                      className="block px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                      onClick={() => setShowUserMenu(false)}
                    >
                      Profile
                    </Link>
                    <button
                      onClick={() => {
                        logout();
                        setShowUserMenu(false);
                      }}
                      className="w-full text-left px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      Logout
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Button onClick={handleLogin} variant="primary" size="sm">
                Login with Plex
              </Button>
            )}
          </div>
        </div>

        {/* Mobile Navigation Menu */}
        {showMobileMenu && (
          <div className="md:hidden border-t border-gray-200 dark:border-gray-700 mt-3 pt-3">
            <nav className="flex flex-col space-y-2">
              <Link
                href="/"
                onClick={() => setShowMobileMenu(false)}
                className="px-3 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
              >
                Home
              </Link>
              <Link
                href="/search"
                onClick={() => setShowMobileMenu(false)}
                className="px-3 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
              >
                Search
              </Link>
              {showBookDate && (
                <Link
                  href="/bookdate"
                  onClick={() => setShowMobileMenu(false)}
                  className="px-3 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
                >
                  BookDate
                </Link>
              )}
              {user && (
                <Link
                  href="/requests"
                  onClick={() => setShowMobileMenu(false)}
                  className="px-3 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
                >
                  My Requests
                </Link>
              )}
              {user?.role === 'admin' && (
                <Link
                  href="/admin"
                  onClick={() => setShowMobileMenu(false)}
                  className="px-3 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
                >
                  Admin
                </Link>
              )}
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}
