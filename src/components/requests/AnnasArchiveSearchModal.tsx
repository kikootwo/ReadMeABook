/**
 * Component: Anna's Archive Search Modal
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Interactive search with structured fields against Anna's Archive.
 * Returns multiple results with cover thumbnails for user selection.
 */

'use client';

import { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { useSearchAnnasArchive, useSelectEbook } from '@/lib/hooks/useRequests';
import { useToast } from '@/components/ui/Toast';
import type { AnnasArchiveResult } from '@/lib/services/ebook-scraper';

interface AnnasArchiveSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  requestId: string;
  audiobook: { title: string; author: string; asin?: string | null };
  preferredFormat?: string;
  onSuccess?: () => void;
}

export function AnnasArchiveSearchModal({
  isOpen,
  onClose,
  requestId,
  audiobook,
  preferredFormat = 'epub',
  onSuccess,
}: AnnasArchiveSearchModalProps) {
  const toast = useToast();
  const { searchAnnasArchive, isLoading: isSearching } = useSearchAnnasArchive();
  const { selectEbook, isLoading: isDownloading } = useSelectEbook();

  // Form state
  const [title, setTitle] = useState(audiobook.title);
  const [author, setAuthor] = useState(audiobook.author);
  const [asinOrIsbn, setAsinOrIsbn] = useState(audiobook.asin || '');
  const [format, setFormat] = useState(preferredFormat);
  const [year, setYear] = useState('');
  const [freeTextQuery, setFreeTextQuery] = useState('');

  // Results state
  const [results, setResults] = useState<AnnasArchiveResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [confirmResult, setConfirmResult] = useState<AnnasArchiveResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset form when modal opens with new data
  useEffect(() => {
    if (isOpen) {
      setTitle(audiobook.title);
      setAuthor(audiobook.author);
      setAsinOrIsbn(audiobook.asin || '');
      setFormat(preferredFormat);
      setYear('');
      setFreeTextQuery('');
      setResults([]);
      setHasSearched(false);
      setConfirmResult(null);
      setError(null);
    }
  }, [isOpen, audiobook.title, audiobook.author, audiobook.asin, preferredFormat]);

  const handleSearch = async () => {
    setError(null);
    try {
      const data = await searchAnnasArchive(requestId, {
        title: title.trim() || undefined,
        author: author.trim() || undefined,
        asinOrIsbn: asinOrIsbn.trim() || undefined,
        format: format || undefined,
        year: year.trim() || undefined,
        freeTextQuery: freeTextQuery.trim() || undefined,
      });
      setResults(data);
      setHasSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    }
  };

  const handleConfirmDownload = async () => {
    if (!confirmResult) return;
    try {
      await selectEbook(requestId, {
        source: 'annas_archive',
        md5: confirmResult.md5,
        format: confirmResult.format?.toLowerCase() || preferredFormat,
        title: confirmResult.title,
        score: 0,
        guid: `annas-archive-${confirmResult.md5}`,
        indexer: "Anna's Archive",
        downloadUrl: '',
        downloadUrls: [],
      });
      toast.success(`Downloading "${confirmResult.title}"`);
      onSuccess?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Download failed');
      setConfirmResult(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isSearching) {
      e.preventDefault();
      handleSearch();
    }
  };

  const hasQuery = title.trim() || author.trim() || asinOrIsbn.trim() || freeTextQuery.trim();

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Search Anna's Archive" size="lg">
      <div className="space-y-4 relative">
        {/* Search Form */}
        <div className="space-y-3" onKeyDown={handleKeyDown}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={isSearching}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                placeholder="Book title"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Author</label>
              <input
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                disabled={isSearching}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                placeholder="Author name"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">ASIN / ISBN</label>
            <input
              type="text"
              value={asinOrIsbn}
              onChange={(e) => setAsinOrIsbn(e.target.value)}
              disabled={isSearching}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
              placeholder="ASIN or ISBN (optional)"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Format</label>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                disabled={isSearching}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
              >
                <option value="epub">EPUB</option>
                <option value="pdf">PDF</option>
                <option value="mobi">MOBI</option>
                <option value="azw3">AZW3</option>
                <option value="any">Any Format</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Year</label>
              <input
                type="text"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                disabled={isSearching}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                placeholder="e.g. 2021"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Free Text Query</label>
            <input
              type="text"
              value={freeTextQuery}
              onChange={(e) => setFreeTextQuery(e.target.value)}
              disabled={isSearching}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
              placeholder="Additional search terms (optional)"
            />
          </div>

          <button
            onClick={handleSearch}
            disabled={isSearching || !hasQuery}
            className="w-full px-4 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSearching ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Searching...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                Search
              </>
            )}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {/* Results */}
        {hasSearched && !isSearching && (
          <div>
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
              {results.length === 0 ? 'No results found' : `${results.length} result${results.length !== 1 ? 's' : ''} found`}
            </div>
            {results.length > 0 && (
              <div className="max-h-[40vh] overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700/50">
                {results.map((result, i) => (
                  <ResultRow key={result.md5} result={result} rank={i + 1} onSelect={() => setConfirmResult(result)} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Confirm Overlay */}
        {confirmResult && (
          <div
            className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-150 rounded-lg"
            onClick={() => !isDownloading && setConfirmResult(null)}
          >
            <div
              className="mx-5 w-full max-w-sm bg-white dark:bg-gray-800 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 pt-5 pb-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/10 dark:bg-blue-400/15 flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-[15px] font-semibold text-gray-900 dark:text-white">Download Ebook</h3>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">This will start the download</p>
                  </div>
                </div>

                <div className="bg-gray-50 dark:bg-white/[0.04] rounded-xl px-3.5 py-3 border border-gray-100 dark:border-gray-700/50">
                  <div className="flex gap-3">
                    {confirmResult.coverUrl && (
                      <img
                        src={confirmResult.coverUrl}
                        alt=""
                        className="w-10 h-14 rounded object-cover flex-shrink-0"
                        referrerPolicy="no-referrer"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white leading-snug line-clamp-2">
                        {confirmResult.title}
                      </p>
                      {confirmResult.author && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{confirmResult.author}</p>
                      )}
                      <div className="flex items-center gap-1.5 mt-1 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
                        {confirmResult.format && (
                          <span className="uppercase font-medium text-blue-600 dark:text-blue-400">{confirmResult.format}</span>
                        )}
                        {confirmResult.fileSize && (
                          <>
                            <span className="text-gray-300 dark:text-gray-600">&middot;</span>
                            <span>{confirmResult.fileSize}</span>
                          </>
                        )}
                        {confirmResult.source && (
                          <>
                            <span className="text-gray-300 dark:text-gray-600">&middot;</span>
                            <span>{confirmResult.source}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex border-t border-gray-200/80 dark:border-gray-700/50">
                <button
                  onClick={() => setConfirmResult(null)}
                  disabled={isDownloading}
                  className="flex-1 px-4 py-3 text-[15px] font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors disabled:opacity-40 border-r border-gray-200/80 dark:border-gray-700/50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmDownload}
                  disabled={isDownloading}
                  className="flex-1 px-4 py-3 text-[15px] font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors disabled:opacity-60"
                >
                  {isDownloading ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-blue-300 dark:border-blue-600 border-t-blue-600 dark:border-t-blue-400 rounded-full animate-spin" />
                      Downloading...
                    </span>
                  ) : (
                    'Download'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function ResultRow({ result, rank, onSelect }: { result: AnnasArchiveResult; rank: number; onSelect: () => void }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
      {/* Cover thumbnail */}
      <div className="w-10 h-14 rounded overflow-hidden bg-gray-100 dark:bg-gray-700 flex-shrink-0">
        {result.coverUrl ? (
          <img
            src={result.coverUrl}
            alt=""
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400 dark:text-gray-500">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900 dark:text-white leading-snug line-clamp-1">
          <span className="text-gray-400 dark:text-gray-500 text-xs mr-1.5">#{rank}</span>
          {result.title}
        </p>
        {result.author && (
          <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1 mt-0.5">{result.author}</p>
        )}
        <div className="flex items-center gap-1.5 mt-1 text-[11px] text-gray-400 dark:text-gray-500 flex-wrap">
          {result.format && (
            <span className="uppercase font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 px-1.5 py-0.5 rounded">
              {result.format}
            </span>
          )}
          {result.fileSize && <span>{result.fileSize}</span>}
          {result.year && (
            <>
              <span className="text-gray-300 dark:text-gray-600">&middot;</span>
              <span>{result.year}</span>
            </>
          )}
          {result.language && (
            <>
              <span className="text-gray-300 dark:text-gray-600">&middot;</span>
              <span>{result.language}</span>
            </>
          )}
          {result.source && (
            <>
              <span className="text-gray-300 dark:text-gray-600">&middot;</span>
              <span>{result.source}</span>
            </>
          )}
        </div>
      </div>

      {/* Get button */}
      <button
        onClick={onSelect}
        className="flex-shrink-0 px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 hover:bg-blue-100 dark:hover:bg-blue-500/20 rounded-lg transition-colors"
      >
        Get
      </button>
    </div>
  );
}
