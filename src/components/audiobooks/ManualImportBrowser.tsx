/**
 * Component: Manual Import File Browser
 * Documentation: documentation/features/manual-import.md
 *
 * Two-phase modal for browsing server directories and importing audiobook files.
 * Phase 1 (BrowsePhase): Directory navigation with audio file detection.
 * Phase 2 (ConfirmPhase): Review and start import.
 *
 * Sub-components: manual-import/BrowsePhase.tsx, manual-import/ConfirmPhase.tsx
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { fetchWithAuth } from '@/lib/utils/api';
import { FolderArrowDownIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { RootEntry, DirectoryEntry, AudioFileEntry, SlideDirection } from './manual-import/types';
import { BrowsePhase } from './manual-import/BrowsePhase';
import { ConfirmPhase } from './manual-import/ConfirmPhase';

interface ManualImportBrowserProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  audiobook: {
    asin: string;
    title: string;
    author: string;
    coverArtUrl?: string;
  };
}

type Phase = 'browse' | 'confirm';

export function ManualImportBrowser({
  isOpen,
  onClose,
  onSuccess,
  audiobook,
}: ManualImportBrowserProps) {
  const [phase, setPhase] = useState<Phase>('browse');
  const [slideDirection, setSlideDirection] = useState<SlideDirection>('right');

  // Browse state
  const [roots, setRoots] = useState<RootEntry[]>([]);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedAudioCount, setSelectedAudioCount] = useState(0);
  const [selectedSize, setSelectedSize] = useState(0);
  const [selectedAudioFiles, setSelectedAudioFiles] = useState<AudioFileEntry[]>([]);
  const [currentAudioFiles, setCurrentAudioFiles] = useState<AudioFileEntry[]>([]);
  const [pathHistory, setPathHistory] = useState<string[]>([]);

  // Loading/error state
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Hover state for folder icon swap
  const [hoveredFolder, setHoveredFolder] = useState<string | null>(null);

  // Fetch roots on open
  useEffect(() => {
    if (!isOpen) return;
    setPhase('browse');
    setCurrentPath(null);
    setSelectedPath(null);
    setPathHistory([]);
    fetchRoots();
  }, [isOpen]);

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
      setCurrentAudioFiles(data.audioFiles || []);
      setCurrentPath(data.path || dirPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to browse directory');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const navigateInto = (dirPath: string) => {
    setSlideDirection('right');
    if (currentPath) {
      setPathHistory((prev) => [...prev, currentPath]);
    }
    setSelectedPath(null);
    fetchDirectory(dirPath);
  };

  const navigateBack = () => {
    setSlideDirection('left');
    setSelectedPath(null);
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
    setSlideDirection('left');
    setSelectedPath(null);
    setCurrentPath(null);
    setEntries([]);
    setCurrentAudioFiles([]);
    setPathHistory([]);
  };

  const navigateToBreadcrumb = (index: number) => {
    if (!currentPath) return;
    setSlideDirection('left');
    setSelectedPath(null);
    const allPaths = [...pathHistory, currentPath];
    const targetPath = allPaths[index];
    if (targetPath) {
      setPathHistory(allPaths.slice(0, index));
      fetchDirectory(targetPath);
    } else {
      navigateToRoot();
    }
  };

  const handleFolderClick = (entry: DirectoryEntry) => {
    const fullPath = currentPath + '/' + entry.name;
    navigateInto(fullPath);
  };

  const handleSelectCurrentFolder = () => {
    if (!currentPath || currentAudioFiles.length === 0) return;
    setSelectedPath(currentPath);
    setSelectedAudioCount(currentAudioFiles.length);
    setSelectedSize(currentAudioFiles.reduce((sum, f) => sum + f.size, 0));
    setSelectedAudioFiles(currentAudioFiles);
    setSlideDirection('right');
    setPhase('confirm');
  };

  const handleBackToBrowse = () => {
    setSlideDirection('left');
    setPhase('browse');
  };

  const handleStartImport = async () => {
    if (!selectedPath) return;
    setIsImporting(true);
    setImportError(null);
    try {
      const res = await fetchWithAuth('/api/admin/manual-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asin: audiobook.asin,
          folderPath: selectedPath,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Import failed');
      }
      onSuccess();
      onClose();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setIsImporting(false);
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

  if (!isOpen) return null;

  const slideClass =
    slideDirection === 'right'
      ? 'animate-[slideRight_200ms_ease-out]'
      : 'animate-[slideLeft_200ms_ease-out]';

  const modalContent = (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      style={{ height: '100dvh' }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ height: 'min(640px, 85vh)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700/50">
          <div className="flex items-center gap-2.5">
            <FolderArrowDownIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {phase === 'browse' ? 'Manual Import' : 'Confirm Import'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <XMarkIcon className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {phase === 'browse' ? (
            <BrowsePhase
              roots={roots}
              currentPath={currentPath}
              entries={entries}
              currentAudioFiles={currentAudioFiles}
              isLoading={isLoading}
              error={error}
              hoveredFolder={hoveredFolder}
              breadcrumbs={visibleBreadcrumbs}
              slideClass={slideClass}
              onNavigateInto={navigateInto}
              onNavigateBack={navigateBack}
              onNavigateToRoot={navigateToRoot}
              onNavigateToBreadcrumb={navigateToBreadcrumb}
              onFolderClick={handleFolderClick}
              onSelectCurrentFolder={handleSelectCurrentFolder}
              onHoverFolder={setHoveredFolder}
              onRetry={currentPath ? () => fetchDirectory(currentPath) : fetchRoots}
            />
          ) : (
            <ConfirmPhase
              audiobook={audiobook}
              selectedPath={selectedPath!}
              audioFileCount={selectedAudioCount}
              totalSize={selectedSize}
              audioFiles={selectedAudioFiles}
              isImporting={isImporting}
              importError={importError}
              slideClass={slideClass}
              onBack={handleBackToBrowse}
              onStartImport={handleStartImport}
            />
          )}
        </div>

      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
