/**
 * Component: Authentication Context Provider
 * Documentation: documentation/backend/services/auth.md
 */

'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface User {
  id: string;
  plexId: string;
  username: string;
  email?: string;
  role: string;
  avatarUrl?: string;
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

  // Load user from localStorage on mount
  useEffect(() => {
    const storedToken = localStorage.getItem('accessToken');
    const storedUser = localStorage.getItem('user');

    if (storedToken && storedUser) {
      setAccessToken(storedToken);
      setUser(JSON.parse(storedUser));
    }

    setIsLoading(false);
  }, []);

  // Poll Plex OAuth callback during login
  const login = async (pinId: number) => {
    const maxAttempts = 60; // 2 minutes total
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        const response = await fetch(`/api/auth/plex/callback?pinId=${pinId}`);
        const data = await response.json();

        if (data.success && data.authorized) {
          // Login successful
          setAccessToken(data.accessToken);
          setUser(data.user);

          // Store in localStorage
          localStorage.setItem('accessToken', data.accessToken);
          localStorage.setItem('refreshToken', data.refreshToken);
          localStorage.setItem('user', JSON.stringify(data.user));

          return;
        }

        // Still waiting for authorization
        await new Promise(resolve => setTimeout(resolve, 2000));
        attempts++;
      } catch (error) {
        console.error('Login polling error:', error);
        await new Promise(resolve => setTimeout(resolve, 2000));
        attempts++;
      }
    }

    throw new Error('Login timeout - please try again');
  };

  const logout = () => {
    setUser(null);
    setAccessToken(null);
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');

    // Call logout endpoint
    fetch('/api/auth/logout', { method: 'POST' });
  };

  const refreshToken = async () => {
    const storedRefreshToken = localStorage.getItem('refreshToken');

    if (!storedRefreshToken) {
      logout();
      return;
    }

    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: storedRefreshToken }),
      });

      if (response.ok) {
        const data = await response.json();
        setAccessToken(data.accessToken);
        localStorage.setItem('accessToken', data.accessToken);
      } else {
        logout();
      }
    } catch (error) {
      console.error('Token refresh error:', error);
      logout();
    }
  };

  const setAuthData = (newUser: User, newAccessToken: string) => {
    setUser(newUser);
    setAccessToken(newAccessToken);
  };

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
