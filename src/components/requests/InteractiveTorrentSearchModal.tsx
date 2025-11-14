/**
 * Component: Interactive Torrent Search Modal
 * Documentation: documentation/phase3/prowlarr.md
 */

'use client';

import React, { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { TorrentResult } from '@/lib/utils/ranking-algorithm';
import { useInteractiveSearch, useSelectTorrent } from '@/lib/hooks/useRequests';

interface InteractiveTorrentSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  requestId: string;
  audiobook: {
    title: string;
    author: string;
  };
}

export function InteractiveTorrentSearchModal({
  isOpen,
  onClose,
  requestId,
  audiobook,
}: InteractiveTorrentSearchModalProps) {
  const { searchTorrents, isLoading: isSearching, error: searchError } = useInteractiveSearch();
  const { selectTorrent, isLoading: isDownloading, error: downloadError } = useSelectTorrent();
  const [results, setResults] = useState<(TorrentResult & { rank: number; qualityScore?: number })[]>([]);
  const [confirmTorrent, setConfirmTorrent] = useState<TorrentResult | null>(null);

  const error = searchError || downloadError;

  // Perform search when modal opens
  React.useEffect(() => {
    if (isOpen && results.length === 0) {
      performSearch();
    }
  }, [isOpen]);

  const performSearch = async () => {
    try {
      const data = await searchTorrents(requestId);
      setResults(data || []);
    } catch (err) {
      // Error already handled by hook
      console.error('Search failed:', err);
    }
  };

  const handleDownloadClick = (torrent: TorrentResult) => {
    setConfirmTorrent(torrent);
  };

  const handleConfirmDownload = async () => {
    if (!confirmTorrent) return;

    try {
      await selectTorrent(requestId, confirmTorrent);
      // Close modals on success
      setConfirmTorrent(null);
      onClose();
      // Request list will auto-refresh via SWR
    } catch (err) {
      // Error already handled by hook
      console.error('Failed to download torrent:', err);
      setConfirmTorrent(null);
    }
  };

  const formatSize = (bytes: number) => {
    const gb = bytes / (1024 ** 3);
    const mb = bytes / (1024 ** 2);
    return gb >= 1 ? `${gb.toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
  };

  const getQualityBadgeColor = (score: number) => {
    if (score >= 90) return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
    if (score >= 70) return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
    if (score >= 50) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
    return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="Select Torrent" size="full">
        <div className="space-y-4">
          {/* Audiobook info */}
          <div className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">{audiobook.title}</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">By {audiobook.author}</p>
          </div>

          {/* Error message */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          {/* Loading state */}
          {isSearching && (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin w-8 h-8 border-4 border-gray-300 border-t-blue-600 rounded-full"></div>
              <span className="ml-3 text-gray-600 dark:text-gray-400">Searching for torrents...</span>
            </div>
          )}

          {/* No results */}
          {!isSearching && results.length === 0 && (
            <div className="text-center py-12">
              <p className="text-gray-500 dark:text-gray-400">No torrents found</p>
              <Button onClick={performSearch} variant="outline" className="mt-4">
                Try Again
              </Button>
            </div>
          )}

          {/* Results table */}
          {!isSearching && results.length > 0 && (
            <div className="overflow-x-auto -mx-6">
              <div className="inline-block min-w-full align-middle px-6">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-900">
                    <tr>
                      <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                        #
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                        Title
                      </th>
                      <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hidden sm:table-cell">
                        Size
                      </th>
                      <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                        Score
                      </th>
                      <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hidden md:table-cell">
                        Seeds
                      </th>
                      <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hidden lg:table-cell">
                        Indexer
                      </th>
                      <th className="px-2 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {results.map((result) => (
                      <tr key={result.guid} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="px-2 py-3 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
                          {result.rank}
                        </td>
                        <td className="px-3 py-3 text-sm text-gray-900 dark:text-gray-100">
                          <div className="max-w-xs lg:max-w-md truncate" title={result.title}>
                            {result.title}
                          </div>
                          <div className="flex gap-2 mt-1 flex-wrap">
                            {result.format && (
                              <span className="inline-block px-2 py-0.5 text-xs bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 rounded">
                                {result.format}
                              </span>
                            )}
                            <span className="sm:hidden inline-block px-2 py-0.5 text-xs bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 rounded">
                              {formatSize(result.size)}
                            </span>
                            <span className="md:hidden inline-block px-2 py-0.5 text-xs bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-400 rounded">
                              {result.seeders} seeds
                            </span>
                          </div>
                        </td>
                        <td className="px-2 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 hidden sm:table-cell">
                          {formatSize(result.size)}
                        </td>
                        <td className="px-2 py-3 whitespace-nowrap text-sm">
                          <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${getQualityBadgeColor(result.qualityScore || 0)}`}>
                            {result.qualityScore || 0}
                          </span>
                        </td>
                        <td className="px-2 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 hidden md:table-cell">
                          <span className="flex items-center gap-1">
                            <svg className="w-3 h-3 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v3.586L7.707 9.293a1 1 0 00-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 10.586V7z" clipRule="evenodd" />
                            </svg>
                            {result.seeders}
                          </span>
                        </td>
                        <td className="px-2 py-3 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400 hidden lg:table-cell">
                          {result.indexer}
                        </td>
                        <td className="px-2 py-3 whitespace-nowrap text-right text-sm">
                          <Button
                            onClick={() => handleDownloadClick(result)}
                            disabled={isDownloading}
                            size="sm"
                            variant="primary"
                          >
                            Download
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Footer with result count */}
          {!isSearching && results.length > 0 && (
            <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Found {results.length} torrent{results.length !== 1 ? 's' : ''}
              </p>
              <Button onClick={performSearch} variant="outline" size="sm">
                Refresh Results
              </Button>
            </div>
          )}
        </div>
      </Modal>

      {/* Confirmation Modal */}
      <ConfirmModal
        isOpen={!!confirmTorrent}
        onClose={() => setConfirmTorrent(null)}
        onConfirm={handleConfirmDownload}
        title="Download Torrent"
        message={`Download "${confirmTorrent?.title}"?`}
        confirmText="Download"
        isLoading={isDownloading}
        variant="primary"
      />
    </>
  );
}
