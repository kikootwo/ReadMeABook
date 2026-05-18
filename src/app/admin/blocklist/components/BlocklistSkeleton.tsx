/**
 * Component: Blocklist Skeleton
 * Documentation: documentation/admin-features/release-blocklist.md
 */

export function BlocklistSkeleton() {
  return (
    <div className="space-y-2" data-testid="blocklist-skeleton">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 animate-pulse"
        >
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-2" />
          <div className="h-3 bg-gray-100 dark:bg-gray-700/60 rounded w-1/2" />
        </div>
      ))}
    </div>
  );
}
