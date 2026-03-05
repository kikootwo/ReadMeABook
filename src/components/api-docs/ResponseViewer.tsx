/**
 * Component: API Docs Response Viewer
 * Documentation: documentation/backend/services/api-tokens.md
 *
 * Displays API response with syntax highlighting, status badge, and copy functionality.
 */

'use client';

import { useState, useMemo } from 'react';

interface ResponseViewerProps {
  status: number | null;
  data: string | null;
  error: string | null;
  loading: boolean;
}

function statusColor(status: number): string {
  if (status >= 200 && status < 300) return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300';
  if (status >= 400 && status < 500) return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300';
  return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300';
}

/** Tokenize JSON string into typed segments for React rendering */
type JsonToken = { type: 'string' | 'number' | 'boolean' | 'null' | 'plain'; value: string };

function tokenizeJson(json: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  const regex = /("(?:[^"\\]|\\.)*")|(\b\d+\.?\d*\b)|(\btrue\b|\bfalse\b)|(\bnull\b)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(json)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'plain', value: json.slice(lastIndex, match.index) });
    }
    if (match[1] !== undefined) tokens.push({ type: 'string', value: match[1] });
    else if (match[2] !== undefined) tokens.push({ type: 'number', value: match[2] });
    else if (match[3] !== undefined) tokens.push({ type: 'boolean', value: match[3] });
    else if (match[4] !== undefined) tokens.push({ type: 'null', value: match[4] });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < json.length) {
    tokens.push({ type: 'plain', value: json.slice(lastIndex) });
  }
  return tokens;
}

const TOKEN_COLORS: Record<JsonToken['type'], string> = {
  string: 'text-emerald-400',
  number: 'text-blue-400',
  boolean: 'text-purple-400',
  null: 'text-purple-400',
  plain: 'text-gray-300',
};

export function ResponseViewer({ status, data, error, loading }: ResponseViewerProps) {
  const [copied, setCopied] = useState(false);

  const tokens = useMemo(() => {
    if (!data) return [];
    try {
      const formatted = JSON.stringify(JSON.parse(data), null, 2);
      return tokenizeJson(formatted);
    } catch {
      return [{ type: 'plain' as const, value: data }];
    }
  }, [data]);

  const handleCopy = async () => {
    if (!data) return;
    try {
      const formatted = JSON.stringify(JSON.parse(data), null, 2);
      await navigator.clipboard.writeText(formatted);
    } catch {
      await navigator.clipboard.writeText(data);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="mt-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-6">
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          <span className="text-sm text-gray-500 dark:text-gray-400">Sending request...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-3 rounded-xl border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-900/20 p-4">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-sm text-red-700 dark:text-red-300">{error}</span>
        </div>
      </div>
    );
  }

  if (!data || status === null) return null;

  return (
    <div className="mt-3 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Response
          </span>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold ${statusColor(status)}`}>
            {status}
          </span>
        </div>
        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        >
          {copied ? (
            <>
              <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Copy
            </>
          )}
        </button>
      </div>

      {/* JSON body */}
      <pre className="p-4 bg-[#0d1117] text-sm font-mono leading-relaxed overflow-x-auto max-h-[400px] overflow-y-auto">
        <code>{tokens.map((t, i) => (
          <span key={i} className={TOKEN_COLORS[t.type]}>{t.value}</span>
        ))}</code>
      </pre>
    </div>
  );
}
