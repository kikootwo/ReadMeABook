/**
 * Component: Authentication Context Provider
 * Documentation: documentation/backend/services/auth.md
 */

'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useRef } from 'react';
import { isTokenExpired, getRefreshTimeMs } from '@/lib/utils/jwt-client';

interface UserPermissions {
  interactiveSearch: boolean;
  download: boolean;
}

interface User {
  id: string;
  plexId: string;
  username: string;
  email?: string;
  role: string;
  avatarUrl?: string;
  authProvider?: string | null; // 'plex' | 'oidc' | 'local' | null
  permissions?: UserPermissions;
}

interface AuthContextType {
  user: User | null;
  accessToken: string | null;
  isLoading: boolean;
  login: (pinId: number) => Promise<void>;
  logout: () => void;
  refreshToken: () => Promise<void>;
  setAuthData: (user: User, accessToken: string) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Clear any existing refresh timer
  const clearRefreshTimer = () => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  };

  // Schedule auto-refresh before token expires
  const scheduleTokenRefresh = (token: string) => {
    clearRefreshTimer();

    const refreshTimeMs = getRefreshTimeMs(token);
    if (refreshTimeMs === null || refreshTimeMs <= 0) {
      // Token is already expired or about to expire, refresh immediately
      refreshToken();
      return;
    }

    // Schedule refresh 5 mins before expiry
    refreshTimerRef.current = setTimeout(() => {
      refreshToken();
    }, refreshTimeMs);
  };

  // Load user from localStorage on mount
  useEffect(() => {
    const storedToken = localStorage.getItem('accessToken');
    const storedUser = localStorage.getItem('user');

    if (storedToken && storedUser) {
      // Validate token hasn't expired
      if (isTokenExpired(storedToken)) {
        // Token expired - try to refresh
        const storedRefreshToken = localStorage.getItem('refreshToken');
        if (storedRefreshToken && !isTokenExpired(storedRefreshToken)) {
          // Refresh token is still valid, attempt refresh
          refreshTokenInternal(storedRefreshToken).then(() => {
            // Fetch fresh user data from server to pick up role changes,
            // avatar updates, etc. - mirrors the non-expired path below.
            const currentToken = localStorage.getItem('accessToken');
            if (currentToken) {
              fetch('/api/auth/me', {
                headers: { 'Authorization': `Bearer ${currentToken}` },
              })
                .then((res) => res.json())
                .then((data) => {
                  if (data.user) {
                    setUser(data.user);
                    localStorage.setItem('user', JSON.stringify(data.user));
                  }
                })
                .catch((error) => {
                  console.error('Failed to fetch fresh user data:', error);
                });
            }
          }).finally(() => {
            setIsLoading(false);
          });
          return;
        } else {
          // Refresh token also expired - clear everything
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          localStorage.removeItem('user');
          setIsLoading(false);
          return;
        }
      }

      // Token is valid - restore session
      setAccessToken(storedToken);
      setUser(JSON.parse(storedUser));
      scheduleTokenRefresh(storedToken);

      // Fetch fresh user data from server to get latest fields (e.g., authProvider)
      fetch('/api/auth/me', {
        headers: {
          'Authorization': `Bearer ${storedToken}`,
        },
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.user) {
            // Update user with fresh data from server
            setUser(data.user);
            localStorage.setItem('user', JSON.stringify(data.user));
          }
        })
        .catch((error) => {
          console.error('Failed to fetch fresh user data:', error);
        });
    }

    setIsLoading(false);
  }, []);

  // Internal refresh function (used by mount effect and public refresh)
  const refreshTokenInternal = async (storedRefreshToken?: string) => {
    const refreshTokenToUse = storedRefreshToken || localStorage.getItem('refreshToken');

    if (!refreshTokenToUse) {
      logout();
      return;
    }

    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refreshTokenToUse }),
      });

      if (response.ok) {
        const data = await response.json();
        setAccessToken(data.accessToken);
        localStorage.setItem('accessToken', data.accessToken);

        // Restore user state from localStorage if not already in React state.
        // This is critical for the mount-time refresh path: when the access
        // token has expired but the refresh token is still valid, the mount
        // effect calls refreshTokenInternal without ever calling setUser,
        // leaving user as null and the app appearing logged-out.
        const storedUserData = localStorage.getItem('user');
        if (storedUserData) {
          setUser(JSON.parse(storedUserData));
        }

        // Schedule next refresh
        scheduleTokenRefresh(data.accessToken);
      } else {
        logout();
      }
    } catch (error) {
      console.error('Token refresh error:', error);
      logout();
    }
  };

  // Poll Plex OAuth callback during login
  const login = async (pinId: number) => {
    const maxAttempts = 60; // 2 minutes total
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        const response = await fetch(`/api/auth/plex/callback?pinId=${pinId}`);
        const data = await response.json();

        // Check for error responses (403 = access denied, 503 = server not configured, etc.)
        if (!response.ok) {
          // 202 means still waiting for user to authorize - continue polling
          if (response.status === 202) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            attempts++;
            continue;
          }

          // Any other error (403, 500, 503, etc.) - stop polling and show error
          const errorMessage = data.message || 'Authentication failed';
          throw new Error(errorMessage);
        }

        if (data.success && data.authorized) {
          // Check if profile selection is required (Plex Home accounts)
          if (data.requiresProfileSelection) {
            // Redirect to profile selection page
            // Note: Plex token is stored server-side for security, not in sessionStorage
            window.location.href = data.redirectUrl;
            return;
          }

          // Login successful (no profile selection needed)
          setAccessToken(data.accessToken);
          setUser(data.user);

          // Store in localStorage
          localStorage.setItem('accessToken', data.accessToken);
          localStorage.setItem('refreshToken', data.refreshToken);
          localStorage.setItem('user', JSON.stringify(data.user));

          // Schedule auto-refresh
          scheduleTokenRefresh(data.accessToken);

          return;
        }

        // Still waiting for authorization
        await new Promise(resolve => setTimeout(resolve, 2000));
        attempts++;
      } catch (error) {
        // If it's our custom error, re-throw it to display to user
        if (error instanceof Error) {
          throw error;
        }

        // Network error or other issue - log and retry
        console.error('Login polling error:', error);
        await new Promise(resolve => setTimeout(resolve, 2000));
        attempts++;
      }
    }

    throw new Error('Login timeout - please try again');
  };

  const logout = () => {
    clearRefreshTimer();
    setUser(null);
    setAccessToken(null);
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');

    // Call logout endpoint
    fetch('/api/auth/logout', { method: 'POST' });

    // Redirect to login page
    window.location.href = '/login';
  };

  const refreshToken = async () => {
    await refreshTokenInternal();
  };

  const setAuthData = (newUser: User, newAccessToken: string) => {
    setUser(newUser);
    setAccessToken(newAccessToken);
    scheduleTokenRefresh(newAccessToken);
  };

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      clearRefreshTimer();
    };
  }, []);

  // Listen for logout in other tabs (cross-tab sync)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      // If access token was removed in another tab, logout here too
      if (e.key === 'accessToken' && e.newValue === null) {
        clearRefreshTimer();
        setUser(null);
        setAccessToken(null);
        // Redirect to login when logged out in another tab
        window.location.href = '/login';
      }
      // If access token was added in another tab, sync it
      else if (e.key === 'accessToken' && e.newValue) {
        const storedUser = localStorage.getItem('user');
        if (storedUser) {
          setAccessToken(e.newValue);
          setUser(JSON.parse(storedUser));
          scheduleTokenRefresh(e.newValue);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, accessToken, isLoading, login, logout, refreshToken, setAuthData }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
