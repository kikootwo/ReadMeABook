/**
 * Component: API Docs Token Input
 * Documentation: documentation/backend/services/api-tokens.md
 *
 * Token input field with toggle between custom API token and current session auth.
 */

'use client';

import { useState } from 'react';

interface TokenInputProps {
  token: string;
  onTokenChange: (token: string) => void;
  useSession: boolean;
  onUseSessionChange: (useSession: boolean) => void;
}

export function TokenInput({
  token,
  onTokenChange,
  useSession,
  onUseSessionChange,
}: TokenInputProps) {
  const [showToken, setShowToken] = useState(false);

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700/50 bg-white dark:bg-gray-800 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            Authentication
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Choose how to authenticate your test requests
          </p>
        </div>

        {/* Session toggle */}
        <button
          onClick={() => onUseSessionChange(!useSession)}
          className={`
            relative inline-flex h-7 w-[140px] items-center rounded-full transition-colors duration-200
            ${useSession
              ? 'bg-blue-600'
              : 'bg-gray-200 dark:bg-gray-700'
            }
          `}
        >
          <span
            className={`
              absolute inset-y-0.5 w-[68px] rounded-full bg-white dark:bg-gray-100 shadow-sm
              transition-transform duration-200 ease-in-out
              ${useSession ? 'translate-x-[70px]' : 'translate-x-0.5'}
            `}
          />
          <span
            className={`
              relative z-10 flex-1 text-center text-xs font-medium transition-colors duration-200
              ${!useSession ? 'text-gray-900 dark:text-gray-900' : 'text-white/70'}
            `}
          >
            API Token
          </span>
          <span
            className={`
              relative z-10 flex-1 text-center text-xs font-medium transition-colors duration-200
              ${useSession ? 'text-gray-900 dark:text-gray-900' : 'text-gray-500 dark:text-gray-400'}
            `}
          >
            Session
          </span>
        </button>
      </div>

      {useSession ? (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50">
          <svg className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <span className="text-sm text-blue-700 dark:text-blue-300">
            Using your current browser session for authentication
          </span>
        </div>
      ) : (
        <div className="relative">
          <input
            type={showToken ? 'text' : 'password'}
            value={token}
            onChange={(e) => onTokenChange(e.target.value)}
            placeholder="rmab_your_api_token_here"
            className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/50 px-4 py-2.5 pr-20 text-sm font-mono text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition-all"
          />
          <button
            onClick={() => setShowToken(!showToken)}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-2.5 py-1 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            {showToken ? 'Hide' : 'Show'}
          </button>
        </div>
      )}
    </div>
  );
}
