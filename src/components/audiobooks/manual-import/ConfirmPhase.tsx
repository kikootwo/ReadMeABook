/**
 * Component: Manual Import Confirm Phase
 * Documentation: documentation/features/manual-import.md
 *
 * Shows book context, selected folder, pipeline steps summary,
 * and start import / back actions.
 */

'use client';

import React from 'react';
import Image from 'next/image';
import { ArrowLeftIcon, ExclamationCircleIcon, MusicalNoteIcon } from '@heroicons/react/24/outline';
import { AudioFileEntry, formatBytes } from './types';

interface ConfirmPhaseProps {
  audiobook: { asin: string; title: string; author: string; coverArtUrl?: string };
  selectedPath: string;
  audioFileCount: number;
  totalSize: number;
  audioFiles: AudioFileEntry[];
  isImporting: boolean;
  importError: string | null;
  slideClass: string;
  onBack: () => void;
  onStartImport: () => void;
}

export function ConfirmPhase({
  audiobook,
  selectedPath,
  audioFileCount,
  totalSize,
  audioFiles,
  isImporting,
  importError,
  slideClass,
  onBack,
  onStartImport,
}: ConfirmPhaseProps) {
  return (
    <div className={`flex flex-col h-full ${slideClass}`}>
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Book context */}
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 bg-gray-100 dark:bg-gray-800">
            {audiobook.coverArtUrl ? (
              <Image
                src={audiobook.coverArtUrl}
                alt=""
                width={64}
                height={64}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <MusicalNoteIcon className="w-6 h-6 text-gray-400" />
              </div>
            )}
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 truncate">
              {audiobook.title}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">{audiobook.author}</p>
          </div>
        </div>

        {/* Selected folder info */}
        <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
            Import from
          </p>
          <p className="text-sm font-mono text-gray-900 dark:text-gray-100 break-all">
            {selectedPath}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
            {audioFileCount} audio file{audioFileCount !== 1 ? 's' : ''}
            {totalSize > 0 ? ` \u00B7 ${formatBytes(totalSize)}` : ''}
          </p>
        </div>

        {/* Audio files to import */}
        <div>
          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
            Files to import
          </h4>
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
            {audioFiles.map((file) => (
              <div key={file.name} className="flex items-center gap-3 px-3.5 py-2.5">
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
        </div>
      </div>

      {/* Error display */}
      {importError && (
        <div className="mx-5 mb-2 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 flex items-start gap-2.5">
          <ExclamationCircleIcon className="w-5 h-5 text-red-500 dark:text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700 dark:text-red-300">{importError}</p>
        </div>
      )}

      {/* Footer */}
      <div className="px-5 py-3.5 border-t border-gray-200 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/30 flex items-center justify-between gap-3">
        <button
          onClick={onBack}
          disabled={isImporting}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors disabled:opacity-50"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          Back
        </button>
        <button
          onClick={onStartImport}
          disabled={isImporting}
          className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-70 flex items-center gap-2"
        >
          {isImporting ? (
            <>
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Importing...
            </>
          ) : (
            'Start Import'
          )}
        </button>
      </div>
    </div>
  );
}
