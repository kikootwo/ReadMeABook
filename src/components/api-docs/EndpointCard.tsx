/**
 * Component: API Docs Endpoint Card
 * Documentation: documentation/backend/services/api-tokens.md
 *
 * Expandable card for a single API endpoint with "Try it out" functionality.
 */

'use client';

import { useState, useCallback } from 'react';
import { fetchWithAuth } from '@/lib/utils/api';
import { ResponseViewer } from './ResponseViewer';
import type { EndpointDoc } from '@/lib/constants/api-tokens';

interface EndpointCardProps {
  endpoint: EndpointDoc;
  token: string;
  useSession: boolean;
}

const METHOD_STYLES: Record<string, string> = {
  GET: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  POST: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  PUT: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  DELETE: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
};

export function EndpointCard({ endpoint, token, useSession }: EndpointCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<number | null>(null);
  const [data, setData] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleTryIt = useCallback(async () => {
    setLoading(true);
    setError(null);
    setData(null);
    setStatus(null);
    setExpanded(true);

    try {
      let response: Response;

      if (useSession) {
        // Use session JWT via fetchWithAuth
        response = await fetchWithAuth(endpoint.path, { method: endpoint.method });
      } else {
        // Use custom API token
        if (!token.trim()) {
          setError('Please enter an API token');
          setLoading(false);
          return;
        }
        response = await fetch(endpoint.path, {
          method: endpoint.method,
          headers: {
            Authorization: `Bearer ${token.trim()}`,
          },
        });
      }

      setStatus(response.status);
      const text = await response.text();
      setData(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [endpoint, token, useSession]);

  const methodStyle = METHOD_STYLES[endpoint.method] || METHOD_STYLES.GET;

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700/50 bg-white dark:bg-gray-800 shadow-sm overflow-hidden transition-shadow hover:shadow-md">
      {/* Card header */}
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 mb-2">
              <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold tracking-wide ${methodStyle}`}>
                {endpoint.method}
              </span>
              <code className="text-sm font-mono font-medium text-gray-900 dark:text-gray-100 truncate">
                {endpoint.path}
              </code>
              {endpoint.requiresAdmin && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
                  Admin
                </span>
              )}
            </div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">
              {endpoint.title}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
              {endpoint.description}
            </p>
          </div>

          <button
            onClick={handleTryIt}
            disabled={loading}
            className="flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100 disabled:opacity-50 transition-all active:scale-[0.97]"
          >
            {loading ? (
              <>
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 dark:border-gray-900/30 border-t-white dark:border-t-gray-900" />
                Running
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                </svg>
                Try it
              </>
            )}
          </button>
        </div>

        {/* Expandable response area */}
        <div
          className={`transition-all duration-300 ease-in-out overflow-hidden ${
            expanded ? 'max-h-[600px] opacity-100 mt-1' : 'max-h-0 opacity-0'
          }`}
        >
          <ResponseViewer
            status={status}
            data={data}
            error={error}
            loading={loading}
          />

          {(data || error) && !loading && (
            <div className="flex justify-end mt-2">
              <button
                onClick={() => { setExpanded(false); setData(null); setStatus(null); setError(null); }}
                className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                Clear response
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Curl example (shown in collapsed footer) */}
      <div className="px-5 py-3 bg-gray-50 dark:bg-gray-900/30 border-t border-gray-100 dark:border-gray-700/50">
        <code className="text-xs text-gray-400 dark:text-gray-500 font-mono">
          curl -H &quot;Authorization: Bearer {'<token>'}&quot; {typeof window !== 'undefined' ? window.location.origin : ''}{endpoint.path}
        </code>
      </div>
    </div>
  );
}
