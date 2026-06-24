/**
 * Component: E-book Settings Tab
 * Documentation: documentation/settings-pages.md
 *
 * Three-section layout:
 * 1. Anna's Archive - Direct HTTP downloads from Anna's Archive
 * 2. Indexer Search - Search via Prowlarr indexers (future feature)
 * 3. General Settings - Shared settings like preferred format
 */

'use client';

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { fetchWithAuth } from '@/lib/utils/api';
import { useEbookSettings } from './useEbookSettings';
import type { EbookSettings, ABSLibrary } from '../../lib/types';

interface EbookTabProps {
  ebook: EbookSettings;
  backendMode: 'plex' | 'audiobookshelf';
  onChange: (ebook: EbookSettings) => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  markAsSaved: () => void;
}

export function EbookTab({ ebook, backendMode, onChange, onSuccess, onError, markAsSaved }: EbookTabProps) {
  const {
    saving,
    testingFlaresolverr,
    flaresolverrTestResult,
    checkingPath,
    pathCheckResult,
    checkDestinationPath,
    updateEbook,
    testFlaresolverrConnection,
    saveSettings,
    isAnySourceEnabled,
  } = useEbookSettings({ ebook, onChange, onSuccess, onError, markAsSaved });

  const isABS = backendMode === 'audiobookshelf';

  // Load ABS libraries for the "library" ebook destination option (ABS mode only)
  const [absLibraries, setAbsLibraries] = useState<ABSLibrary[]>([]);
  useEffect(() => {
    if (!isABS) return;
    let cancelled = false;
    fetchWithAuth('/api/admin/settings/audiobookshelf/libraries')
      .then((res) => (res.ok ? res.json() : { libraries: [] }))
      .then((data) => { if (!cancelled) setAbsLibraries(data.libraries || []); })
      .catch(() => { if (!cancelled) setAbsLibraries([]); });
    return () => { cancelled = true; };
  }, [isABS]);

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
          E-book Sidecar
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          Automatically download e-books to accompany your audiobooks.
          E-books are placed in the same folder as the audiobook files.
        </p>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 1: ANNA'S ARCHIVE
          ═══════════════════════════════════════════════════════════════════════ */}
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <div className="bg-gray-50 dark:bg-gray-800 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wider">
            Anna's Archive
          </h3>
        </div>
        <div className="p-4 space-y-4">
          {/* Enable Toggle */}
          <div className="flex items-start gap-4">
            <input
              type="checkbox"
              id="annas-archive-enabled"
              checked={ebook.annasArchiveEnabled || false}
              onChange={(e) => updateEbook('annasArchiveEnabled', e.target.checked)}
              className="mt-1 h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div className="flex-1">
              <label
                htmlFor="annas-archive-enabled"
                className="block text-sm font-medium text-gray-900 dark:text-gray-100 cursor-pointer"
              >
                Enable Anna's Archive downloads
              </label>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                Download e-books directly from Anna's Archive using ASIN or title matching.
              </p>
            </div>
          </div>

          {/* Anna's Archive specific settings - only shown when enabled */}
          {ebook.annasArchiveEnabled && (
            <>
              {/* Base URL */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Base URL
                </label>
                <Input
                  type="text"
                  value={ebook.baseUrl || 'https://annas-archive.gl'}
                  onChange={(e) => updateEbook('baseUrl', e.target.value)}
                  placeholder="https://annas-archive.gl"
                  className="font-mono"
                />
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Change this if the primary Anna's Archive mirror is unavailable.
                </p>
              </div>

              {/* FlareSolverr URL */}
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    FlareSolverr URL (Optional)
                  </label>
                  <div className="flex gap-2">
                    <Input
                      type="text"
                      value={ebook.flaresolverrUrl || ''}
                      onChange={(e) => updateEbook('flaresolverrUrl', e.target.value)}
                      placeholder="http://localhost:8191"
                      className="font-mono flex-1"
                    />
                    <Button
                      onClick={testFlaresolverrConnection}
                      loading={testingFlaresolverr}
                      variant="secondary"
                      className="whitespace-nowrap"
                    >
                      Test
                    </Button>
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    FlareSolverr helps bypass Cloudflare protection.
                  </p>
                  {flaresolverrTestResult && (
                    <div
                      className={`mt-2 p-3 rounded-lg text-sm ${
                        flaresolverrTestResult.success
                          ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-800'
                          : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800'
                      }`}
                    >
                      {flaresolverrTestResult.success ? '✓ ' : '✗ '}
                      {flaresolverrTestResult.message}
                    </div>
                  )}
                </div>
                {!ebook.flaresolverrUrl && (
                  <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                    <p className="text-sm text-amber-800 dark:text-amber-200">
                      <strong>Note:</strong> Without FlareSolverr, e-book downloads may fail if Anna's Archive
                      has Cloudflare protection enabled.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 2: INDEXER SEARCH
          ═══════════════════════════════════════════════════════════════════════ */}
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <div className="bg-gray-50 dark:bg-gray-800 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wider">
            Indexer Search
          </h3>
        </div>
        <div className="p-4 space-y-4">
          {/* Enable Toggle */}
          <div className="flex items-start gap-4">
            <input
              type="checkbox"
              id="indexer-search-enabled"
              checked={ebook.indexerSearchEnabled || false}
              onChange={(e) => updateEbook('indexerSearchEnabled', e.target.checked)}
              className="mt-1 h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div className="flex-1">
              <label
                htmlFor="indexer-search-enabled"
                className="block text-sm font-medium text-gray-900 dark:text-gray-100 cursor-pointer"
              >
                Enable Indexer Search
              </label>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                Search for e-books via Prowlarr indexers (torrent/NZB sources).
              </p>
            </div>
          </div>

          {/* Info hint about indexer settings */}
          {ebook.indexerSearchEnabled && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                <strong>Configure Categories:</strong> E-book category settings are configured per-indexer
                in the <span className="font-medium">Indexers</span> tab. Look for the "EBook" tab when
                editing an indexer.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 3: GENERAL SETTINGS
          ═══════════════════════════════════════════════════════════════════════ */}
      {isAnySourceEnabled && (
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <div className="bg-gray-50 dark:bg-gray-800 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wider">
              General Settings
            </h3>
          </div>
          <div className="p-4 space-y-4">
            {/* Preferred Format */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Preferred Format
              </label>
              <select
                value={ebook.preferredFormat || 'epub'}
                onChange={(e) => updateEbook('preferredFormat', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                         bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                         focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="epub">EPUB (Recommended)</option>
                <option value="pdf">PDF</option>
                <option value="mobi">MOBI</option>
                <option value="azw3">AZW3</option>
                <option value="any">Any format</option>
              </select>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                EPUB is recommended for most e-readers. "Any format" accepts the first available.
              </p>
            </div>

            {/* Auto Grab Toggle */}
            <div className="flex items-start gap-4 pt-2">
              <input
                type="checkbox"
                id="auto-grab-enabled"
                checked={ebook.autoGrabEnabled ?? true}
                onChange={(e) => updateEbook('autoGrabEnabled', e.target.checked)}
                className="mt-1 h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <div className="flex-1">
                <label
                  htmlFor="auto-grab-enabled"
                  className="block text-sm font-medium text-gray-900 dark:text-gray-100 cursor-pointer"
                >
                  Automatically fetch ebooks
                </label>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  When enabled, ebook requests are created automatically after audiobook downloads complete.
                  When disabled, use the "Fetch Ebook" button on completed requests.
                </p>
              </div>
            </div>

            {/* Kindle Fix Toggle - Only shown when EPUB is selected */}
            {(ebook.preferredFormat === 'epub' || !ebook.preferredFormat) && (
              <div className="flex items-start gap-4 pt-2 border-t border-gray-200 dark:border-gray-700 mt-4">
                <input
                  type="checkbox"
                  id="kindle-fix-enabled"
                  checked={ebook.kindleFixEnabled ?? false}
                  onChange={(e) => updateEbook('kindleFixEnabled', e.target.checked)}
                  className="mt-1 h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <div className="flex-1">
                  <label
                    htmlFor="kindle-fix-enabled"
                    className="block text-sm font-medium text-gray-900 dark:text-gray-100 cursor-pointer"
                  >
                    Fix EPUB for Kindle import
                  </label>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    Apply compatibility fixes before organizing EPUB files. Fixes encoding declarations,
                    broken hyperlinks, invalid language tags, and orphaned image elements that can
                    cause Kindle import failures.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* How it works - only show when Anna's Archive is enabled */}
      {ebook.annasArchiveEnabled && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-2">
            How Anna's Archive works
          </h3>
          <ul className="space-y-1 text-sm text-blue-800 dark:text-blue-200">
            <li>• Searches by ASIN first (exact match), then title + author</li>
            <li>• Downloads matching e-book in your preferred format</li>
            <li>• Places e-book file in the same folder as the audiobook</li>
            <li>• If no match is found, audiobook download continues normally</li>
          </ul>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 4: EBOOK DESTINATION
          ═══════════════════════════════════════════════════════════════════════ */}
      {isAnySourceEnabled && (
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <div className="bg-gray-50 dark:bg-gray-800 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wider">
              Ebook Destination
            </h3>
          </div>
          <div className="p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Where to save ebooks
              </label>
              <select
                value={ebook.ebookDestinationMode || 'same'}
                onChange={(e) => updateEbook('ebookDestinationMode', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                         bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                         focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="same">Same folder as the audiobook</option>
                {isABS && <option value="library">Existing Audiobookshelf library</option>}
                <option value="custom">Custom path</option>
              </select>
            </div>

            {ebook.ebookDestinationMode === 'library' && isABS && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Audiobookshelf library
                </label>
                <select
                  value={ebook.ebookDestinationLibraryId || ''}
                  onChange={(e) => updateEbook('ebookDestinationLibraryId', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                           bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                           focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Select a library…</option>
                  {absLibraries.map((lib) => (
                    <option key={lib.id} value={lib.id}>{lib.name}</option>
                  ))}
                </select>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Ebooks are organized into this library's folder instead of the audiobook folder.
                </p>
              </div>
            )}

            {ebook.ebookDestinationMode === 'custom' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Custom path
                </label>
                <Input
                  type="text"
                  value={ebook.ebookDestinationPath || ''}
                  onChange={(e) => updateEbook('ebookDestinationPath', e.target.value)}
                  onBlur={checkDestinationPath}
                  placeholder="/media/ebooks"
                  className="font-mono"
                />
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Absolute path inside the container. Ensure it is also scanned by Audiobookshelf if you use e-reader delivery.
                </p>
                {checkingPath && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                    Checking path…
                  </p>
                )}
                {!checkingPath && pathCheckResult && !pathCheckResult.reachable && (
                  <div className="mt-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                    <p className="text-sm text-amber-800 dark:text-amber-200">
                      <strong>⚠ Path not reachable:</strong> {pathCheckResult.message} Ebooks will
                      fall back to the default media directory until this is fixed.
                    </p>
                  </div>
                )}
                {!checkingPath && pathCheckResult?.reachable && (
                  <p className="mt-2 text-sm text-green-700 dark:text-green-300">
                    ✓ {pathCheckResult.message}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 5: E-READER DELIVERY (ABS only)
          ═══════════════════════════════════════════════════════════════════════ */}
      {isAnySourceEnabled && isABS && (
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <div className="bg-gray-50 dark:bg-gray-800 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wider">
              E-Reader Delivery
            </h3>
          </div>
          <div className="p-4 space-y-4">
            <div className="flex items-start gap-4">
              <input
                type="checkbox"
                id="ereader-auto-send-enabled"
                checked={ebook.ereaderAutoSendEnabled || false}
                onChange={(e) => updateEbook('ereaderAutoSendEnabled', e.target.checked)}
                className="mt-1 h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <div className="flex-1">
                <label
                  htmlFor="ereader-auto-send-enabled"
                  className="block text-sm font-medium text-gray-900 dark:text-gray-100 cursor-pointer"
                >
                  Automatically send ebooks to e-readers
                </label>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  When an ebook is downloaded, email it to the e-reader device(s) of every user who
                  requested that book, via Audiobookshelf. Assign devices per user in
                  Admin → Users. Requires email + e-reader devices configured in Audiobookshelf.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Save Button */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
        <Button
          onClick={saveSettings}
          loading={saving}
          className="w-full bg-blue-600 hover:bg-blue-700"
        >
          Save E-book Sidecar Settings
        </Button>
      </div>
    </div>
  );
}
