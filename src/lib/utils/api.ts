/**
 * Component: API Utility Functions
 * Documentation: documentation/frontend/utilities.md
 */

import { isTokenExpired } from './jwt-client';

let isRefreshing = false;
let refreshPromise: Promise<string | null> | null = null;

/**
 * Refresh the access token using the refresh token
 */
async function refreshAccessToken(): Promise<string | null> {
  // If already refreshing, return the existing promise
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }

  isRefreshing = true;
  refreshPromise = (async () => {
    try {
      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) {
        return null;
      }

      // Check if refresh token is expired
      if (isTokenExpired(refreshToken)) {
        return null;
      }

      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      const newAccessToken = data.accessToken;

      // Update localStorage
      localStorage.setItem('accessToken', newAccessToken);

      return newAccessToken;
    } catch (error) {
      console.error('Token refresh failed:', error);
      return null;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * Logout user by clearing tokens and redirecting
 */
function performLogout() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');

  // Redirect to login if not already there
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname)}`;
  }
}

/**
 * Make an authenticated API request with JWT token
 * Automatically handles 401 errors by refreshing token and retrying
 */
export async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const token = localStorage.getItem('accessToken');

  const headers = {
    ...options.headers,
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
  };

  // Make initial request
  let response = await fetch(url, {
    ...options,
    headers,
  });

  // Handle 401 Unauthorized - attempt token refresh
  if (response.status === 401) {
    const newAccessToken = await refreshAccessToken();

    if (newAccessToken) {
      // Retry request with new token
      const newHeaders = {
        ...options.headers,
        'Authorization': `Bearer ${newAccessToken}`,
      };

      response = await fetch(url, {
        ...options,
        headers: newHeaders,
      });

      // If still 401, logout
      if (response.status === 401) {
        performLogout();
      }
    } else {
      // Refresh failed - logout
      performLogout();
    }
  }

  return response;
}

/**
 * Fetch JSON data with authentication
 */
export async function fetchJSON<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetchWithAuth(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * SWR fetcher with authentication
 */
export const authenticatedFetcher = (url: string) => fetchJSON(url);
