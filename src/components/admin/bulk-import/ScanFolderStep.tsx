/**
 * Component: Bulk Import - Folder Selection Step
 * Documentation: documentation/features/bulk-import.md
 *
 * Filesystem browser for selecting a root folder to scan for audiobooks.
 * Adapted from the manual import BrowsePhase patterns.
 * Any folder is selectable (not just audio-containing folders).
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  FolderIcon,
  FolderOpenIcon,
  FolderArrowDownIcon,
  InboxArrowDownIcon,
  HomeIcon,
  ChevronRightIcon,
  ArrowLeftIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { fetchWithAuth } from '@/lib/utils/api';
import { RootEntry, DirectoryEntry } from './types';

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 animate-pulse">
      <div className="w-5 h-5 bg-gray-200 dark:bg-gray-700 rounded" />
      <div className="flex-1 space-y-1.5">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-48" />
        <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-32" />
      </div>
    </div>
  );
}

interface ScanFolderStepProps {
  onFolderSelected: (rootPath: string) => void;
}

export function ScanFolderStep({ onFolderSelected }: ScanFolderStepProps) {
  const [roots, setRoots] = useState<RootEntry[]>([]);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoveredFolder, setHoveredFolder] = useState<string | null>(null);

  useEffect(() => {
    fetchRoots();
  }, []);

  const fetchRoots = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth('/api/admin/filesystem/browse');
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Failed to load' }));
        throw new Error(data.error || 'Failed to load directories');
      }
      const data = await res.json();
      setRoots(data.roots || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load directories');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchDirectory = useCallback(async (dirPath: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth(
        `/api/admin/filesystem/browse?path=${encodeURIComponent(dirPath)}`
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Failed to load' }));
        throw new Error(data.error || 'Failed to browse directory');
      }
      const data = await res.json();
      setEntries(data.entries || []);
      setCurrentPath(data.path || dirPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to browse directory');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const navigateInto = (dirPath: string) => {
    if (currentPath) {
      setPathHistory((prev) => [...prev, currentPath]);
    }
    fetchDirectory(dirPath);
  };

  const navigateBack = () => {
    if (pathHistory.length > 0) {
      const prevPath = pathHistory[pathHistory.length - 1];
      setPathHistory((prev) => prev.slice(0, -1));
      fetchDirectory(prevPath);
    } else {
      setCurrentPath(null);
      setEntries([]);
    }
  };

  const navigateToRoot = () => {
    setCurrentPath(null);
    setEntries([]);
    setPathHistory([]);
  };

  const navigateToBreadcrumb = (index: number) => {
    if (!currentPath) return;
    const allPaths = [...pathHistory, currentPath];
    const targetPath = allPaths[index];
    if (targetPath) {
      setPathHistory(allPaths.slice(0, index));
      fetchDirectory(targetPath);
    } else {
      navigateToRoot();
    }
  };

  // Build breadcrumb segments
  const breadcrumbs = (() => {
    if (!currentPath) return [];
    const allPaths = [...pathHistory, currentPath];
    return allPaths.map((p) => {
      const parts = p.replace(/\\/g, '/').split('/');
      return parts[parts.length - 1] || p;
    });
  })();

  const visibleBreadcrumbs = (() => {
    if (breadcrumbs.length <= 3) return breadcrumbs.map((b, i) => ({ label: b, index: i }));
    return [
      { label: breadcrumbs[0], index: 0 },
      { label: '...', index: -1 },
      { label: breadcrumbs[breadcrumbs.length - 1], index: breadcrumbs.length - 1 },
    ];
  })();

  // Count subfolders in current listing
  const totalSubfolders = entries.length;

  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb bar */}
      {currentPath && (
        <div className="flex items-center gap-1 px-5 py-2.5 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800 text-sm overflow-x-auto">
          <button
            onClick={navigateToRoot}
            className="flex-shrink-0 p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            <HomeIcon className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          </button>
          {visibleBreadcrumbs.map((crumb, i) => (
            <React.Fragment key={i}>
              <ChevronRightIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
              {crumb.index === -1 ? (
                <span className="text-gray-400 px-1">...</span>
              ) : i === visibleBreadcrumbs.length - 1 ? (
                <span className="font-medium text-gray-900 dark:text-gray-100 truncate">
                  {crumb.label}
                </span>
              ) : (
                <button
                  onClick={() => navigateToBreadcrumb(crumb.index)}
                  className="text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 truncate transition-colors"
                >
                  {crumb.label}
                </button>
              )}
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Listing */}
      <div className="flex-1 overflow-y-auto">
        {/* Loading */}
        {isLoading && (
          <div className="py-2">
            {[...Array(5)].map((_, i) => (
              <SkeletonRow key={i} />
            ))}
          </div>
        )}

        {/* Error */}
        {error && !isLoading && (
          <div className="flex flex-col items-center justify-center py-16 px-6">
            <ExclamationTriangleIcon className="w-10 h-10 text-red-400 mb-3" />
            <p className="text-gray-900 dark:text-gray-100 font-medium text-center">{error}</p>
            <button
              onClick={currentPath ? () => fetchDirectory(currentPath) : fetchRoots}
              className="mt-4 flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
            >
              <ArrowPathIcon className="w-4 h-4" />
              Try Again
            </button>
          </div>
        )}

        {/* Root view */}
        {!currentPath && !isLoading && !error && (
          <div className="p-5">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Select a folder to scan for audiobooks. All subfolders will be searched recursively.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {roots.map((root) => (
                <button
                  key={root.path}
                  onClick={() => navigateInto(root.path)}
                  className="flex flex-col items-center gap-3 p-6 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-all group"
                >
                  {root.icon === 'download' ? (
                    <FolderArrowDownIcon className="w-10 h-10 text-blue-500 group-hover:text-blue-600 transition-colors" />
                  ) : root.icon === 'bookdrop' ? (
                    <InboxArrowDownIcon className="w-10 h-10 text-amber-500 group-hover:text-amber-600 transition-colors" />
                  ) : (
                    <FolderIcon className="w-10 h-10 text-emerald-500 group-hover:text-emerald-600 transition-colors" />
                  )}
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {root.name}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate max-w-full">
                    {root.path}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Directory listing */}
        {currentPath && !isLoading && !error && entries.length > 0 && (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {entries.map((entry) => {
              const isHovered = hoveredFolder === entry.name;

              return (
                <button
                  key={`dir-${entry.name}`}
                  onClick={() => navigateInto(currentPath + '/' + entry.name)}
                  onMouseEnter={() => setHoveredFolder(entry.name)}
                  onMouseLeave={() => setHoveredFolder(null)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left transition-all duration-150 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                >
                  <div className="flex-shrink-0 w-5 h-5 text-gray-400 dark:text-gray-500 transition-all duration-150">
                    {isHovered ? (
                      <FolderOpenIcon className="w-5 h-5 text-blue-500" />
                    ) : (
                      <FolderIcon className="w-5 h-5" />
                    )}
                  </div>

                  <p className="flex-1 min-w-0 text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {entry.name}
                  </p>

                  <ChevronRightIcon className="w-4 h-4 text-gray-300 dark:text-gray-600 flex-shrink-0" />
                </button>
              );
            })}
          </div>
        )}

        {/* Empty state */}
        {currentPath && !isLoading && !error && entries.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <FolderOpenIcon className="w-10 h-10 text-gray-300 dark:text-gray-600 mb-3" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">This folder is empty</p>
            <button
              onClick={navigateBack}
              className="mt-4 flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              <ArrowLeftIcon className="w-4 h-4" />
              Go back
            </button>
          </div>
        )}
      </div>

      {/* Footer: Scan this folder */}
      {currentPath && !isLoading && (
        <div className="px-5 py-3.5 border-t border-gray-200 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/30 flex items-center justify-between gap-4">
          <div className="text-sm text-gray-600 dark:text-gray-400 min-w-0">
            <p className="font-mono text-xs text-gray-500 dark:text-gray-500 truncate">{currentPath}</p>
            {entries.length > 0 && (
              <p className="mt-0.5">
                {totalSubfolders} subfolder{totalSubfolders !== 1 ? 's' : ''}
              </p>
            )}
          </div>
          <button
            onClick={() => onFolderSelected(currentPath)}
            className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors"
          >
            <MagnifyingGlassIcon className="w-4 h-4" />
            Scan for Audiobooks
          </button>
        </div>
      )}
    </div>
  );
}
