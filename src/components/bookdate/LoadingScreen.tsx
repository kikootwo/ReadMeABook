/**
 * Component: BookDate Loading Screen
 * Documentation: documentation/features/bookdate-prd.md
 */

'use client';

import { Header } from '@/components/layout/Header';

export function LoadingScreen() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header />

      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-80px)] px-4">
        {/* Animated book cards */}
        <div className="relative w-64 h-96 mb-8">
          {/* Card 1 */}
          <div
            className="absolute inset-0 rounded-2xl shadow-2xl animate-pulse"
            style={{
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              animationDelay: '0s',
            }}
          />

          {/* Card 2 */}
          <div
            className="absolute inset-0 rounded-2xl shadow-2xl animate-bounce"
            style={{
              background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
              animationDelay: '0.2s',
              opacity: 0.8,
            }}
          />

          {/* Card 3 */}
          <div
            className="absolute inset-0 rounded-2xl shadow-2xl animate-ping"
            style={{
              background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
              animationDelay: '0.4s',
              opacity: 0.6,
            }}
          />

          {/* Book icon */}
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <span className="text-6xl animate-pulse" style={{ animationDuration: '2s' }}>
              📚
            </span>
          </div>
        </div>

        {/* Loading text */}
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            Finding your next great listen...
          </h2>
          <p className="text-gray-600 dark:text-gray-400">
            Our AI is analyzing your preferences
          </p>
        </div>

        {/* Loading dots */}
        <div className="flex gap-2 mt-6">
          <div
            className="w-3 h-3 bg-blue-500 rounded-full animate-bounce"
            style={{ animationDelay: '0s' }}
          />
          <div
            className="w-3 h-3 bg-blue-500 rounded-full animate-bounce"
            style={{ animationDelay: '0.1s' }}
          />
          <div
            className="w-3 h-3 bg-blue-500 rounded-full animate-bounce"
            style={{ animationDelay: '0.2s' }}
          />
        </div>
      </div>
    </div>
  );
}
