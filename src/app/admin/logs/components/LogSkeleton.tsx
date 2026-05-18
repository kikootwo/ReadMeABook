/**
 * Component: LogSkeleton
 * Documentation: documentation/admin-dashboard.md
 *
 * Shape-matched skeleton rows. Shown only on initial load (`!data`) or on
 * filter-key transition — never during auto-refresh (which preserves rows).
 *
 * Layout intentionally mirrors LogRow so swap is reflow-free.
 */

'use client';

interface LogSkeletonProps {
  /** How many skeleton rows to render. Default 6. */
  count?: number;
}

export function LogSkeleton({ count = 6 }: LogSkeletonProps) {
  const items = Array.from({ length: count }, (_, i) => i);
  return (
    <>
      {/* Mobile card skeletons */}
      <div className="space-y-3 sm:hidden" data-testid="log-skeleton-mobile">
        {items.map((i) => (
          <div
            key={i}
            className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 animate-pulse"
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="h-4 w-32 rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-5 w-20 rounded-full bg-gray-200 dark:bg-gray-700" />
            </div>
            <div className="h-3 w-48 rounded bg-gray-200 dark:bg-gray-700 mb-1.5" />
            <div className="h-3 w-36 rounded bg-gray-200 dark:bg-gray-700 mb-3" />
            <div className="flex gap-4">
              <div className="h-3 w-14 rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-3 w-20 rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-3 w-16 rounded bg-gray-200 dark:bg-gray-700" />
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table skeletons */}
      <div
        className="hidden sm:block bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden"
        data-testid="log-skeleton-desktop"
      >
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
            {items.map((i) => (
              <tr key={i} className="animate-pulse">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="h-4 w-24 rounded bg-gray-200 dark:bg-gray-700" />
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="h-4 w-32 rounded bg-gray-200 dark:bg-gray-700" />
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="h-5 w-20 rounded-full bg-gray-200 dark:bg-gray-700" />
                </td>
                <td className="px-6 py-4">
                  <div className="h-4 w-48 rounded bg-gray-200 dark:bg-gray-700 mb-1" />
                  <div className="h-3 w-32 rounded bg-gray-200 dark:bg-gray-700" />
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="h-3 w-12 rounded bg-gray-200 dark:bg-gray-700" />
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="h-3 w-10 rounded bg-gray-200 dark:bg-gray-700" />
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right">
                  <div className="h-8 w-8 rounded-lg bg-gray-200 dark:bg-gray-700 ml-auto" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
