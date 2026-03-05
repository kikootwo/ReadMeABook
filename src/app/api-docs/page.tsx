/**
 * Component: Interactive API Documentation Page
 * Documentation: documentation/backend/services/api-tokens.md
 *
 * Lists all API token-accessible endpoints with "Try it out" functionality.
 * Users can test with a custom API token or their current browser session.
 */

'use client';

import { useState } from 'react';
import { Header } from '@/components/layout/Header';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { TokenInput } from '@/components/api-docs/TokenInput';
import { EndpointCard } from '@/components/api-docs/EndpointCard';
import { API_TOKEN_ENDPOINT_DOCS } from '@/lib/constants/api-tokens';
import { useAuth } from '@/contexts/AuthContext';
import { getInstanceUrl } from '@/lib/utils/client-url';
import Link from 'next/link';

export default function ApiDocsPage() {
  const { user } = useAuth();
  const [token, setToken] = useState('');
  const [useSession, setUseSession] = useState(false);
  const isAdmin = user?.role === 'admin';

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <Header />

        <main className="max-w-4xl mx-auto px-4 sm:px-6 pt-8 pb-16">
          {/* Page header */}
          <div className="mb-8">
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-4">
              <Link
                href="/profile"
                className="hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              >
                Profile
              </Link>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <span className="text-gray-900 dark:text-white font-medium">API Documentation</span>
            </div>

            <h1 className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">
              API Reference
            </h1>
            <p className="mt-2 text-base text-gray-500 dark:text-gray-400 leading-relaxed max-w-2xl">
              Interact with ReadMeABook programmatically using API tokens. These endpoints are
              available for external integrations, dashboards, and automation tools.
            </p>

            {/* Quick links */}
            <div className="flex flex-wrap gap-3 mt-4">
              <Link
                href="/profile"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
                Manage your tokens
              </Link>
              {isAdmin && (
                <>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <Link
                    href="/admin/settings"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Admin token management
                  </Link>
                </>
              )}
            </div>
          </div>

          {/* Authentication section */}
          <div className="mb-8">
            <TokenInput
              token={token}
              onTokenChange={setToken}
              useSession={useSession}
              onUseSessionChange={setUseSession}
            />
          </div>

          {/* Usage instructions card */}
          <div className="mb-8 rounded-2xl border border-gray-200 dark:border-gray-700/50 bg-white dark:bg-gray-800 p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
              Quick Start
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
              Include your API token in the <code className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-900 rounded text-xs font-mono">Authorization</code> header as a Bearer token:
            </p>
            <pre className="text-xs bg-gray-900 dark:bg-black text-gray-100 p-4 rounded-xl overflow-x-auto font-mono leading-relaxed">
{`curl -H "Authorization: Bearer rmab_your_token_here" \\
  ${getInstanceUrl()}/api/requests`}
            </pre>
          </div>

          {/* Endpoints section header */}
          <div className="flex items-center gap-3 mb-5">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Available Endpoints
            </h2>
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
              {API_TOKEN_ENDPOINT_DOCS.length} endpoints
            </span>
          </div>

          {/* Endpoint cards */}
          <div className="space-y-4">
            {API_TOKEN_ENDPOINT_DOCS.map((endpoint) => (
              <EndpointCard
                key={`${endpoint.method}:${endpoint.path}`}
                endpoint={endpoint}
                token={token}
                useSession={useSession}
              />
            ))}
          </div>

          {/* Footer note */}
          <div className="mt-10 text-center">
            <p className="text-xs text-gray-400 dark:text-gray-500">
              API tokens are restricted to the endpoints listed above.
              JWT session authentication has access to all endpoints.
            </p>
          </div>
        </main>
      </div>
    </ProtectedRoute>
  );
}
