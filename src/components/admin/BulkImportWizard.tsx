/**
 * Component: Bulk Import Wizard
 * Documentation: documentation/features/bulk-import.md
 *
 * Multi-step modal wizard for bulk importing audiobooks from server folders.
 * Step 1: Select root folder to scan.
 * Step 2: Scanning/matching progress.
 * Step 3: Review matches and start import.
 */

'use client';

import React, { useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon, FolderArrowDownIcon } from '@heroicons/react/24/outline';
import { ScanFolderStep } from './bulk-import/ScanFolderStep';
import { ScanProgressStep } from './bulk-import/ScanProgressStep';
import { MatchReviewStep } from './bulk-import/MatchReviewStep';
import { WizardStep, ScannedBook, ScanProgressEvent, MatchingProgressEvent } from './bulk-import/types';
import { fetchWithAuth } from '@/lib/utils/api';

interface BulkImportWizardProps {
  isOpen: boolean;
  onClose: () => void;
}

const STEP_LABELS: Record<WizardStep, string> = {
  select_folder: 'Select Folder',
  scanning: 'Scanning',
  review: 'Review & Import',
};

const STEP_ORDER: WizardStep[] = ['select_folder', 'scanning', 'review'];

export function BulkImportWizard({ isOpen, onClose }: BulkImportWizardProps) {
  const [step, setStep] = useState<WizardStep>('select_folder');
  const [selectedRootPath, setSelectedRootPath] = useState<string | null>(null);

  // Scanning state
  const [scanProgress, setScanProgress] = useState<ScanProgressEvent | null>(null);
  const [matchingProgress, setMatchingProgress] = useState<MatchingProgressEvent | null>(null);
  const [scanPhase, setScanPhase] = useState<'discovering' | 'matching' | 'idle'>('idle');
  const abortRef = useRef<AbortController | null>(null);

  // Results state
  const [scannedBooks, setScannedBooks] = useState<ScannedBook[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);

  // Import state
  const [isImporting, setIsImporting] = useState(false);
  const [importResults, setImportResults] = useState<any>(null);

  const resetWizard = useCallback(() => {
    setStep('select_folder');
    setSelectedRootPath(null);
    setScanProgress(null);
    setMatchingProgress(null);
    setScanPhase('idle');
    setScannedBooks([]);
    setScanError(null);
    setIsImporting(false);
    setImportResults(null);
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const handleClose = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    resetWizard();
    onClose();
  }, [onClose, resetWizard]);

  const handleFolderSelected = useCallback(async (rootPath: string) => {
    setSelectedRootPath(rootPath);
    setStep('scanning');
    setScanPhase('discovering');
    setScanError(null);
    setScannedBooks([]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetchWithAuth('/api/admin/bulk-import/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rootPath }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: 'Scan failed' }));
        throw new Error(errData.error || 'Scan failed');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let buffer = '';
      let eventType = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ') && eventType) {
            try {
              const data = JSON.parse(line.slice(6));
              handleSSEEvent(eventType, data);
            } catch {
              /* ignore parse errors */
            }
            eventType = '';
          }
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setScanError(error instanceof Error ? error.message : 'Scan failed');
      setScanPhase('idle');
    }
  }, []);

  const handleSSEEvent = useCallback((event: string, data: any) => {
    switch (event) {
      case 'progress':
        setScanProgress(data);
        break;

      case 'discovery_complete':
        setScanPhase('matching');
        break;

      case 'matching':
        setMatchingProgress(data);
        break;

      case 'book_matched': {
        const book: ScannedBook = {
          ...data,
          skipped: data.inLibrary || data.hasActiveRequest || data.match === null,
        };
        setScannedBooks((prev) => [...prev, book]);
        break;
      }

      case 'complete':
        setScanPhase('idle');
        setStep('review');
        break;

      case 'error':
        setScanError(data.message || 'Scan failed');
        setScanPhase('idle');
        break;
    }
  }, []);

  const handleCancelScan = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setScanPhase('idle');
    setStep('select_folder');
  }, []);

  const handleToggleSkip = useCallback((index: number) => {
    setScannedBooks((prev) =>
      prev.map((book) =>
        book.index === index ? { ...book, skipped: !book.skipped } : book
      )
    );
  }, []);

  const handleStartImport = useCallback(async () => {
    const booksToImport = scannedBooks.filter(
      (b) => !b.skipped && b.match !== null
    );

    if (booksToImport.length === 0) return;

    setIsImporting(true);

    try {
      const response = await fetchWithAuth('/api/admin/bulk-import/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imports: booksToImport.map((b) => ({
            folderPath: b.folderPath,
            asin: b.match!.asin,
            audioFiles: b.audioFiles,
          })),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Import failed');
      }

      setImportResults(data);
    } catch (error) {
      setImportResults({
        success: false,
        error: error instanceof Error ? error.message : 'Import failed',
      });
    } finally {
      setIsImporting(false);
    }
  }, [scannedBooks]);

  const handleBackToFolderSelect = useCallback(() => {
    setStep('select_folder');
    setScanError(null);
    setScannedBooks([]);
    setScanPhase('idle');
  }, []);

  if (!isOpen) return null;

  const currentStepIndex = STEP_ORDER.indexOf(step);

  const modalContent = (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      style={{ height: '100dvh' }}
      onClick={handleClose}
    >
      <div
        className="relative w-full max-w-4xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ height: 'min(720px, 90vh)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700/50">
          <div className="flex items-center gap-2.5">
            <FolderArrowDownIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Bulk Import
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <XMarkIcon className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center justify-center gap-2 px-5 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700/50">
          {STEP_ORDER.map((s, i) => (
            <React.Fragment key={s}>
              {i > 0 && (
                <div
                  className={`w-8 h-px ${
                    i <= currentStepIndex
                      ? 'bg-blue-400 dark:bg-blue-500'
                      : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                />
              )}
              <div className="flex items-center gap-1.5">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                    i < currentStepIndex
                      ? 'bg-blue-600 text-white'
                      : i === currentStepIndex
                      ? 'bg-blue-600 text-white ring-2 ring-blue-200 dark:ring-blue-800'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {i < currentStepIndex ? (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </div>
                <span
                  className={`text-xs font-medium hidden sm:inline ${
                    i <= currentStepIndex
                      ? 'text-gray-900 dark:text-gray-100'
                      : 'text-gray-400 dark:text-gray-500'
                  }`}
                >
                  {STEP_LABELS[s]}
                </span>
              </div>
            </React.Fragment>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {step === 'select_folder' && (
            <ScanFolderStep onFolderSelected={handleFolderSelected} />
          )}

          {step === 'scanning' && (
            <ScanProgressStep
              scanProgress={scanProgress}
              matchingProgress={matchingProgress}
              scanPhase={scanPhase}
              error={scanError}
              booksFound={scannedBooks.length}
              onCancel={handleCancelScan}
              onRetry={() => selectedRootPath && handleFolderSelected(selectedRootPath)}
              onBack={handleBackToFolderSelect}
            />
          )}

          {step === 'review' && (
            <MatchReviewStep
              books={scannedBooks}
              onToggleSkip={handleToggleSkip}
              onStartImport={handleStartImport}
              isImporting={isImporting}
              importResults={importResults}
              onClose={handleClose}
              onBack={handleBackToFolderSelect}
            />
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
