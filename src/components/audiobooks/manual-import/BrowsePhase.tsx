/**
 * Component: Manual Import Browse Phase
 * Documentation: documentation/features/manual-import.md
 *
 * Directory listing with root tiles, breadcrumb navigation,
 * folder metadata, audio file badges, and selection state.
 */

'use client';

import React from 'react';
import {
  FolderIcon,
  FolderOpenIcon,
  FolderArrowDownIcon,
  InboxArrowDownIcon,
  HomeIcon,
  ChevronRightIcon,
  ArrowLeftIcon,
  MusicalNoteIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { RootEntry, DirectoryEntry, AudioFileEntry, formatBytes } from './types';

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

interface BrowsePhaseProps {
  roots: RootEntry[];
  currentPath: string | null;
  entries: DirectoryEntry[];
  currentAudioFiles: AudioFileEntry[];
  isLoading: boolean;
  error: string | null;
  hoveredFolder: string | null;
  breadcrumbs: Array<{ label: string; index: number }>;
  slideClass: string;
  onNavigateInto: (path: string) => void;
  onNavigateBack: () => void;
  onNavigateToRoot: () => void;
  onNavigateToBreadcrumb: (index: number) => void;
  onFolderClick: (entry: DirectoryEntry) => void;
  onSelectCurrentFolder: () => void;
  onHoverFolder: (name: string | null) => void;
  onRetry: () => void;
}

export function BrowsePhase({
  roots,
  currentPath,
  entries,
  currentAudioFiles,
  isLoading,
  error,
  hoveredFolder,
  breadcrumbs,
  slideClass,
  onNavigateInto,
  onNavigateBack,
  onNavigateToRoot,
  onNavigateToBreadcrumb,
  onFolderClick,
  onSelectCurrentFolder,
  onHoverFolder,
  onRetry,
}: BrowsePhaseProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb bar */}
      {currentPath && (
        <div className="flex items-center gap-1 px-5 py-2.5 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800 text-sm overflow-x-auto">
          <button
            onClick={onNavigateToRoot}
            className="flex-shrink-0 p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            <HomeIcon className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          </button>
          {breadcrumbs.map((crumb, i) => (
            <React.Fragment key={i}>
              <ChevronRightIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
              {crumb.index === -1 ? (
                <span className="text-gray-400 px-1">...</span>
              ) : i === breadcrumbs.length - 1 ? (
                <span className="font-medium text-gray-900 dark:text-gray-100 truncate">
                  {crumb.label}
                </span>
              ) : (
                <button
                  onClick={() => onNavigateToBreadcrumb(crumb.index)}
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
      <div className={`flex-1 overflow-y-auto ${slideClass}`}>
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
              onClick={onRetry}
              className="mt-4 flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
            >
              <ArrowPathIcon className="w-4 h-4" />
              Try Again
            </button>
          </div>
        )}

        {/* Root view */}
        {!currentPath && !isLoading && !error && (
          <div className="p-5 grid grid-cols-2 gap-3">
            {roots.map((root) => (
              <button
                key={root.path}
                onClick={() => onNavigateInto(root.path)}
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
        )}

        {/* Directory + audio file listing */}
        {currentPath && !isLoading && !error && (entries.length > 0 || currentAudioFiles.length > 0) && (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {/* Subdirectories */}
            {entries.map((entry) => {
              const hasAudio = entry.audioFileCount > 0;
              const isHovered = hoveredFolder === entry.name;

              return (
                <button
                  key={`dir-${entry.name}`}
                  onClick={() => onFolderClick(entry)}
                  onMouseEnter={() => onHoverFolder(entry.name)}
                  onMouseLeave={() => onHoverFolder(null)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left transition-all duration-150 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                >
                  <div className="flex-shrink-0 w-5 h-5 text-gray-400 dark:text-gray-500 transition-all duration-150">
                    {isHovered ? (
                      <FolderOpenIcon className="w-5 h-5 text-blue-500" />
                    ) : (
                      <FolderIcon className="w-5 h-5" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {entry.name}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {entry.subfolderCount > 0 && (
                        <span>{entry.subfolderCount} folder{entry.subfolderCount !== 1 ? 's' : ''}</span>
                      )}
                      {entry.subfolderCount > 0 && entry.audioFileCount > 0 && <span> &middot; </span>}
                      {entry.audioFileCount > 0 && (
                        <span>{entry.audioFileCount} audio file{entry.audioFileCount !== 1 ? 's' : ''}</span>
                      )}
                      {entry.totalSize > 0 && (
                        <span> &middot; {formatBytes(entry.totalSize)}</span>
                      )}
                      {entry.subfolderCount === 0 && entry.audioFileCount === 0 && (
                        <span className="italic">Empty</span>
                      )}
                    </p>
                  </div>

                  {hasAudio && (
                    <span className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-medium">
                      <MusicalNoteIcon className="w-3 h-3" />
                      {entry.audioFileCount}
                    </span>
                  )}

                  <ChevronRightIcon className="w-4 h-4 text-gray-300 dark:text-gray-600 flex-shrink-0" />
                </button>
              );
            })}

            {/* Audio files in current directory */}
            {currentAudioFiles.length > 0 && entries.length > 0 && (
              <div className="px-4 py-2 bg-gray-50/50 dark:bg-gray-800/20">
                <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                  Audio Files
                </p>
              </div>
            )}
            {currentAudioFiles.map((file) => (
              <div
                key={`file-${file.name}`}
                className="flex items-center gap-3 px-4 py-2.5"
              >
                <MusicalNoteIcon className="w-4 h-4 text-blue-500 dark:text-blue-400 flex-shrink-0" />
                <span className="flex-1 min-w-0 text-sm text-gray-700 dark:text-gray-300 truncate">
                  {file.name}
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
                  {formatBytes(file.size)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {currentPath && !isLoading && !error && entries.length === 0 && currentAudioFiles.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <FolderOpenIcon className="w-10 h-10 text-gray-300 dark:text-gray-600 mb-3" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">This folder is empty</p>
            <button
              onClick={onNavigateBack}
              className="mt-4 flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              <ArrowLeftIcon className="w-4 h-4" />
              Go back
            </button>
          </div>
        )}
      </div>

      {/* Footer: Select this folder */}
      {currentPath && !isLoading && currentAudioFiles.length > 0 && (
        <div className="px-5 py-3.5 border-t border-gray-200 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/30 flex items-center justify-between gap-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            <span className="font-medium text-gray-900 dark:text-gray-100">{currentAudioFiles.length}</span>
            {' '}audio file{currentAudioFiles.length !== 1 ? 's' : ''} in this folder
          </p>
          <button
            onClick={onSelectCurrentFolder}
            className="flex-shrink-0 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors"
          >
            Select This Folder &rarr;
          </button>
        </div>
      )}
    </div>
  );
}
