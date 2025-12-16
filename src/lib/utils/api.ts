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
    console.log('[refreshAccessToken] Already refreshing, returning existing promise');
    return refreshPromise;
  }

  isRefreshing = true;
  refreshPromise = (async () => {
    try {
      const refreshToken = localStorage.getItem('refreshToken');
      console.log('[refreshAccessToken] Has refresh token:', !!refreshToken);

      if (!refreshToken) {
        console.error('[refreshAccessToken] No refresh token found');
        return null;
      }

      // Check if refresh token is expired
      if (isTokenExpired(refreshToken)) {
        console.error('[refreshAccessToken] Refresh token is expired');
        return null;
      }

      console.log('[refreshAccessToken] Calling /api/auth/refresh');
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      console.log('[refreshAccessToken] Refresh response status:', response.status);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('[refreshAccessToken] Refresh failed:', errorData);
        return null;
      }

      const data = await response.json();
      const newAccessToken = data.accessToken;

      console.log('[refreshAccessToken] New access token received');

      // Update localStorage
      localStorage.setItem('accessToken', newAccessToken);

      return newAccessToken;
    } catch (error) {
      console.error('[refreshAccessToken] Token refresh failed:', error);
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

  console.log('[fetchWithAuth] Making request to:', url);
  console.log('[fetchWithAuth] Has token:', !!token);

  const headers = {
    ...options.headers,
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
  };

  // Make initial request
  let response = await fetch(url, {
    ...options,
    headers,
  });

  console.log('[fetchWithAuth] Initial response status:', response.status);

  // Handle 401 Unauthorized - attempt token refresh
  if (response.status === 401) {
    console.log('[fetchWithAuth] Got 401, attempting token refresh...');
    const newAccessToken = await refreshAccessToken();

    if (newAccessToken) {
      console.log('[fetchWithAuth] Token refreshed successfully, retrying request');
      // Retry request with new token
      const newHeaders = {
        ...options.headers,
        'Authorization': `Bearer ${newAccessToken}`,
      };

      response = await fetch(url, {
        ...options,
        headers: newHeaders,
      });

      console.log('[fetchWithAuth] Retry response status:', response.status);

      // If still 401, logout
      if (response.status === 401) {
        console.error('[fetchWithAuth] Still 401 after refresh, logging out');
        performLogout();
      }
    } else {
      // Refresh failed - logout
      console.error('[fetchWithAuth] Token refresh failed, logging out');
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
