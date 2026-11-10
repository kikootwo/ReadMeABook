/**
 * Component: Bulk Import - Match Review Step
 * Documentation: documentation/features/bulk-import.md
 *
 * Scrollable list of discovered audiobooks with Audible matches, skip toggles, library status
 * badges, Change match / Find match / Undo, and import controls. A skipped row dims its cover
 * and text only; the controls stay at full strength.
 */

'use client';

import React, { useCallback, useRef } from 'react';
import { ArrowLeftIcon, ExclamationTriangleIcon, MusicalNoteIcon } from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolid } from '@heroicons/react/24/solid';
import { SAME_BOOK_MARKER } from '@/lib/constants/bulk-import';
import { ScannedBook, MatchCandidate, ImportOutcome } from './types';
import {
  canChangeMatch, effectiveFlags, effectiveMatch, isSharedRow, matchLabel, sharedAsins, splitForImport,
} from './row-match';
import { ChangeMatchDialog } from './ChangeMatchDialog';
import { ImportResultsView } from './ImportResultsView';

interface MatchReviewStepProps {
  books: ScannedBook[];
  onToggleSkip: (index: number) => void;
  onStartImport: () => void;
  isImporting: boolean;
  importResults: ImportOutcome | null;
  onClose: () => void;
  onBack: () => void;
  /** The row whose match dialog is open, else null. */
  matchDialogFor: number | null;
  onOpenMatch: (index: number) => void;
  onCloseMatch: () => void;
  onChooseMatch: (index: number, candidate: MatchCandidate) => void;
  onUndoMatch: (index: number) => void;
}

const CONTROL_BUTTON =
  'inline-flex items-center px-3 min-h-[44px] sm:min-h-0 sm:py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

function BookRow({
  book,
  shared,
  isImporting,
  onToggleSkip,
  onOpenMatch,
  onUndo,
  changeButtonRef,
}: {
  book: ScannedBook;
  shared: boolean;
  isImporting: boolean;
  onToggleSkip: () => void;
  onOpenMatch: () => void;
  onUndo: () => void;
  changeButtonRef: (el: HTMLButtonElement | null) => void;
}) {
  const changeRef = useRef<HTMLButtonElement | null>(null);
  const match = effectiveMatch(book);
  const { inLibrary, hasActiveRequest } = effectiveFlags(book);
  const isDisabled = inLibrary || hasActiveRequest;
  const isSkipped = book.skipped;
  const showControl = canChangeMatch(book);
  // Low confidence when search term came from a filename or folder name fallback,
  // BUT not when an ASIN was extracted directly from the folder name (that's a
  // direct lookup and is as reliable as embedded metadata tags), nor for a picked book.
  const isLowConfidence =
    !book.chosen &&
    (book.metadataSource === 'file_name' || book.metadataSource === 'folder_name') &&
    !book.extractedAsin;

  return (
    <div className="flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1 px-4 py-3" data-testid="bulk-import-row">
      {/* Cover, text and badges: the only part a skipped row dims */}
      <div
        className={`order-1 flex items-center gap-3 flex-1 min-w-0 transition-opacity ${isSkipped ? 'opacity-40' : ''}`}
        data-testid="bulk-import-row-body"
      >
        <div className="flex-shrink-0 w-12 h-12 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800">
          {match?.coverArtUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={match.coverArtUrl}
              alt={match.title}
              className="w-12 h-12 object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).src = '/placeholder_cover.svg';
              }}
            />
          ) : (
            <div className="w-12 h-12 flex items-center justify-center">
              <MusicalNoteIcon className="w-6 h-6 text-gray-400 dark:text-gray-600" />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          {match ? (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{match.title}</p>
                {isLowConfidence && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 flex-shrink-0">
                    Low Confidence
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 truncate">
                {match.author}
                {match.narrator && (
                  <span className="text-gray-400 dark:text-gray-500">
                    {' '}&middot; {match.narrator}
                  </span>
                )}
              </p>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{book.folderName}</p>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 flex-shrink-0">
                  No Match
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 italic">Could not find this title on Audible</p>
            </>
          )}
          <p className="text-[11px] text-gray-400 dark:text-gray-500 font-mono truncate mt-0.5">{book.relativePath}</p>
          {shared && (
            <span className="inline-flex items-center mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300">
              {SAME_BOOK_MARKER}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-xs font-medium">
            <MusicalNoteIcon className="w-3 h-3" />
            {book.audioFileCount}
          </span>
          {inLibrary && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-xs font-medium">
              <CheckCircleSolid className="w-3 h-3" />
              In Library
            </span>
          )}
          {hasActiveRequest && !inLibrary && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-xs font-medium">
              Requested
            </span>
          )}
        </div>
      </div>

      {/* Change match / Find match and Undo: under the text on phones, before the toggle from sm */}
      {showControl && (
        <div className="order-3 sm:order-2 w-full sm:w-auto flex items-center gap-1 pl-[3.75rem] sm:pl-0 flex-shrink-0">
          {book.chosen && (
            <button
              type="button"
              onClick={() => {
                onUndo();
                changeRef.current?.focus();
              }}
              disabled={isImporting}
              aria-label={`Undo change for ${book.folderName}`}
              className={`${CONTROL_BUTTON} text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800`}
            >
              Undo
            </button>
          )}
          <button
            ref={(el) => {
              changeRef.current = el;
              changeButtonRef(el);
            }}
            type="button"
            onClick={onOpenMatch}
            disabled={isImporting}
            aria-label={`${matchLabel(book)} for ${book.folderName}`}
            className={`${CONTROL_BUTTON} text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20`}
          >
            {matchLabel(book)}
          </button>
        </div>
      )}

      {/* Skip Toggle */}
      <button
        onClick={onToggleSkip}
        disabled={isDisabled}
        className={`order-2 sm:order-3 flex-shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${
          isDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
        } ${isSkipped ? 'bg-gray-200 dark:bg-gray-700' : 'bg-blue-600'}`}
        title={
          isDisabled
            ? inLibrary
              ? 'Already in your library'
              : 'Already requested'
            : isSkipped
            ? 'Click to include in import'
            : 'Click to skip this book'
        }
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
            isSkipped ? 'translate-x-1' : 'translate-x-6'
          }`}
        />
      </button>
    </div>
  );
}

export function MatchReviewStep({
  books,
  onToggleSkip,
  onStartImport,
  isImporting,
  importResults,
  onClose,
  onBack,
  matchDialogFor,
  onOpenMatch,
  onCloseMatch,
  onChooseMatch,
  onUndoMatch,
}: MatchReviewStepProps) {
  // Rows marked "same book" are held back: not counted, not sent
  const toImport = splitForImport(books).send;
  const skippedCount = books.filter((b) => b.skipped).length;
  const inLibraryCount = books.filter((b) => effectiveFlags(b).inLibrary).length;
  const noMatchCount = books.filter((b) => effectiveMatch(b) === null).length;
  const matchedCount = books.length - noMatchCount;
  const shared = sharedAsins(books);
  const dialogBook = matchDialogFor === null ? undefined : books.find((b) => b.index === matchDialogFor);
  // Each row's Change match / Find match button, so focus returns to it when the dialog closes
  const changeButtons = useRef(new Map<number, HTMLButtonElement>());
  const setChangeButton = useCallback((index: number, el: HTMLButtonElement | null) => {
    if (el) changeButtons.current.set(index, el);
    else changeButtons.current.delete(index);
  }, []);

  if (importResults) {
    return <ImportResultsView outcome={importResults} onClose={onClose} />;
  }

  // Empty state (no audiobooks found)
  if (books.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 py-16">
        <ExclamationTriangleIcon className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">No Audiobooks Found</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center max-w-sm mb-6">
          The selected folder does not contain any folders with audio files. Try selecting a
          different folder.
        </p>
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-xl transition-colors"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          Select Different Folder
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Summary header */}
      <div className="px-5 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700/50">
        <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-xs">
          <span className="text-gray-500 dark:text-gray-400">
            <span className="font-semibold text-gray-900 dark:text-gray-100">{books.length}</span> discovered
          </span>
          <span className="text-gray-300 dark:text-gray-600">&middot;</span>
          <span className="text-gray-500 dark:text-gray-400">
            <span className="font-semibold text-blue-600 dark:text-blue-400">{matchedCount}</span> matched
          </span>
          {noMatchCount > 0 && (
            <>
              <span className="text-gray-300 dark:text-gray-600">&middot;</span>
              <span className="text-gray-500 dark:text-gray-400">
                <span className="font-semibold text-red-600 dark:text-red-400">{noMatchCount}</span> unmatched
              </span>
            </>
          )}
          {inLibraryCount > 0 && (
            <>
              <span className="text-gray-300 dark:text-gray-600">&middot;</span>
              <span className="text-gray-500 dark:text-gray-400">
                <span className="font-semibold text-green-600 dark:text-green-400">{inLibraryCount}</span> in library
              </span>
            </>
          )}
        </div>
      </div>

      {/* Scrollable book list */}
      <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
        {books.map((book) => (
          <BookRow
            key={book.index}
            book={book}
            shared={isSharedRow(book, shared)}
            isImporting={isImporting}
            onToggleSkip={() => onToggleSkip(book.index)}
            onOpenMatch={() => onOpenMatch(book.index)}
            onUndo={() => onUndoMatch(book.index)}
            changeButtonRef={(el) => setChangeButton(book.index, el)}
          />
        ))}
      </div>

      {/* Import footer */}
      <div className="px-5 py-3.5 border-t border-gray-200 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/30 flex items-center justify-between gap-4">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          Back
        </button>

        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600 dark:text-gray-400">
            <span className="font-semibold text-gray-900 dark:text-gray-100">{toImport.length}</span>{' '}
            book{toImport.length !== 1 ? 's' : ''} to import
            {skippedCount > 0 && (
              <span className="text-gray-400 dark:text-gray-500"> ({skippedCount} skipped)</span>
            )}
          </span>

          <button
            onClick={onStartImport}
            disabled={toImport.length === 0 || isImporting}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-colors"
          >
            {isImporting ? (
              <>
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Importing...
              </>
            ) : (
              <>Start Import</>
            )}
          </button>
        </div>
      </div>

      {dialogBook && (
        <ChangeMatchDialog
          key={dialogBook.index}
          book={dialogBook}
          onChoose={(candidate) => onChooseMatch(dialogBook.index, candidate)}
          onClose={onCloseMatch}
          restoreFocus={() => changeButtons.current.get(dialogBook.index)?.focus()}
        />
      )}
    </div>
  );
}
