/**
 * Component: Paths Settings Tab
 * Documentation: documentation/settings-pages.md
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { usePathsSettings } from './usePathsSettings';
import type { PathsSettings } from '../../lib/types';
import { validateTemplate, generateMockPreviews, validateFilenameTemplate, generateMockFilenamePreviews } from '@/lib/utils/path-template.util';

interface PathsTabProps {
  paths: PathsSettings;
  onChange: (paths: PathsSettings) => void;
  onValidationChange: (isValid: boolean) => void;
}

interface TemplatePreview {
  isValid: boolean;
  error?: string;
  previewPaths?: string[];
}

interface FilenamePreview {
  isValid: boolean;
  error?: string;
  single?: string[];
  multi?: string[];
}

export function PathsTab({ paths, onChange, onValidationChange }: PathsTabProps) {
  const { testing, testResult, updatePath, testPaths } = usePathsSettings({
    paths,
    onChange,
    onValidationChange,
  });

  // Live preview state for audiobook template
  const [audiobookPreview, setAudiobookPreview] = useState<TemplatePreview | null>(null);

  // Live preview state for ebook template
  const [ebookPreview, setEbookPreview] = useState<TemplatePreview | null>(null);

  // Update audiobook live preview whenever template changes
  useEffect(() => {
    const template = paths.audiobookPathTemplate || '{author}/{title} {asin}';
    const validation = validateTemplate(template);

    if (validation.valid) {
      setAudiobookPreview({
        isValid: true,
        previewPaths: generateMockPreviews(template),
      });
    } else {
      setAudiobookPreview({
        isValid: false,
        error: validation.error,
      });
    }
  }, [paths.audiobookPathTemplate]);

  // Update ebook live preview whenever template changes
  useEffect(() => {
    const template = paths.ebookPathTemplate || '{author}/{title} {asin}';
    const validation = validateTemplate(template);

    if (validation.valid) {
      setEbookPreview({
        isValid: true,
        previewPaths: generateMockPreviews(template),
      });
    } else {
      setEbookPreview({
        isValid: false,
        error: validation.error,
      });
    }
  }, [paths.ebookPathTemplate]);

  // Live preview state for filename template
  const [filenamePreview, setFilenamePreview] = useState<FilenamePreview | null>(null);

  // Update filename live preview whenever template changes
  useEffect(() => {
    if (!paths.fileRenameEnabled) {
      setFilenamePreview(null);
      return;
    }

    const template = paths.fileRenameTemplate || '{title}';
    const validation = validateFilenameTemplate(template);

    if (validation.valid) {
      const previews = generateMockFilenamePreviews(template);
      setFilenamePreview({
        isValid: true,
        single: previews.single,
        multi: previews.multi,
      });
    } else {
      setFilenamePreview({
        isValid: false,
        error: validation.error,
      });
    }
  }, [paths.fileRenameTemplate, paths.fileRenameEnabled]);

  const audiobookTemplate = paths.audiobookPathTemplate || '{author}/{title} {asin}';
  const ebookTemplate = paths.ebookPathTemplate || '{author}/{title} {asin}';
  const ebookMatchesAudiobook = ebookTemplate === audiobookTemplate;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Directory Paths
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          Configure download and media directory paths.
        </p>
      </div>

      {/* Download Directory */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Download Directory
        </label>
        <Input
          type="text"
          value={paths.downloadDir}
          onChange={(e) => updatePath('downloadDir', e.target.value)}
          placeholder="/downloads"
          className="font-mono"
        />
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Temporary location for downloads before they are organized into the media library
        </p>
      </div>

      {/* Media Directory */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Media Directory
        </label>
        <Input
          type="text"
          value={paths.mediaDir}
          onChange={(e) => updatePath('mediaDir', e.target.value)}
          placeholder="/media/audiobooks"
          className="font-mono"
        />
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Final location for organized audiobook library (Your backend scans this directory)
        </p>
      </div>

      {/* Audiobook Organization Template */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Audiobook Organization Template
        </label>
        <Input
          type="text"
          value={paths.audiobookPathTemplate || '{author}/{title} {asin}'}
          onChange={(e) => updatePath('audiobookPathTemplate', e.target.value)}
          placeholder="{author}/{title} {asin}"
          className="font-mono"
        />
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Customize how audiobooks are organized within the media directory
        </p>

        {/* Audiobook Validation Error */}
        {audiobookPreview && !audiobookPreview.isValid && (
          <div className="mt-3 p-3 rounded-lg text-sm flex items-start gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200">
            <span className="flex-shrink-0 mt-0.5">✗</span>
            <div className="flex-1">
              <span>{audiobookPreview.error || 'Invalid template format'}</span>
            </div>
          </div>
        )}

        {/* Audiobook Preview Examples */}
        {audiobookPreview && audiobookPreview.isValid && audiobookPreview.previewPaths && (
          <div className="mt-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">
              Preview Examples
            </h4>
            <div className="space-y-1.5 text-sm font-mono text-gray-700 dark:text-gray-300">
              {audiobookPreview.previewPaths.map((preview, index) => (
                <div key={index} className="text-xs">
                  {paths.mediaDir || '/media/audiobooks'}/{preview}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Ebook Organization Template */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Ebook Organization Template
        </label>
        <div className="flex gap-2">
          <Input
            type="text"
            value={paths.ebookPathTemplate || '{author}/{title} {asin}'}
            onChange={(e) => updatePath('ebookPathTemplate', e.target.value)}
            placeholder="{author}/{title} {asin}"
            className="font-mono flex-1"
          />
          <Button
            variant="outline"
            onClick={() => updatePath('ebookPathTemplate', paths.audiobookPathTemplate || '{author}/{title} {asin}')}
            disabled={ebookMatchesAudiobook}
            className="whitespace-nowrap text-sm"
          >
            Match Audiobook
          </Button>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Customize how ebooks are organized within the media directory
        </p>

        {/* Ebook Validation Error */}
        {ebookPreview && !ebookPreview.isValid && (
          <div className="mt-3 p-3 rounded-lg text-sm flex items-start gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200">
            <span className="flex-shrink-0 mt-0.5">✗</span>
            <div className="flex-1">
              <span>{ebookPreview.error || 'Invalid template format'}</span>
            </div>
          </div>
        )}

        {/* Ebook Preview Examples */}
        {ebookPreview && ebookPreview.isValid && ebookPreview.previewPaths && (
          <div className="mt-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">
              Preview Examples
            </h4>
            <div className="space-y-1.5 text-sm font-mono text-gray-700 dark:text-gray-300">
              {ebookPreview.previewPaths.map((preview, index) => (
                <div key={index} className="text-xs">
                  {paths.mediaDir || '/media/audiobooks'}/{preview}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* File Rename Toggle */}
      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
        <div className="flex items-start gap-4">
          <input
            type="checkbox"
            id="file-rename-settings"
            checked={paths.fileRenameEnabled}
            onChange={(e) => updatePath('fileRenameEnabled', e.target.checked)}
            className="mt-1 h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <div className="flex-1">
            <label
              htmlFor="file-rename-settings"
              className="block text-sm font-medium text-gray-900 dark:text-gray-100 cursor-pointer"
            >
              Rename files during organization
            </label>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Rename audio and ebook files using a custom naming template when organizing into the media
              library. When multiple files exist (e.g. chapterized MP3s), an index number is appended.
            </p>
          </div>
        </div>

        {/* File Naming Template (shown when enabled) */}
        {paths.fileRenameEnabled && (
          <div className="mt-4 pl-9">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              File Naming Template
            </label>
            <Input
              type="text"
              value={paths.fileRenameTemplate || '{title}'}
              onChange={(e) => updatePath('fileRenameTemplate', e.target.value)}
              placeholder="{title}"
              className="font-mono"
            />
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Uses the same variables as the organization template. Do not include the file extension.
            </p>

            {/* Filename Validation Error */}
            {filenamePreview && !filenamePreview.isValid && (
              <div className="mt-3 p-3 rounded-lg text-sm flex items-start gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200">
                <span className="flex-shrink-0 mt-0.5">✗</span>
                <div className="flex-1">
                  <span>{filenamePreview.error || 'Invalid filename template'}</span>
                </div>
              </div>
            )}

            {/* Filename Preview */}
            {filenamePreview && filenamePreview.isValid && (
              <div className="mt-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">
                  Single File
                </h4>
                <div className="space-y-1.5 text-sm font-mono text-gray-700 dark:text-gray-300">
                  {filenamePreview.single?.map((preview, index) => (
                    <div key={index} className="text-xs">{preview}</div>
                  ))}
                </div>

                <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-3 mb-2">
                  Multiple Files (chapterized)
                </h4>
                <div className="space-y-1.5 text-sm font-mono text-gray-700 dark:text-gray-300">
                  {filenamePreview.multi?.map((preview, index) => (
                    <div key={index} className="text-xs">{preview}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Variable Reference Panel (shared for both templates) */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-3">
          Available Variables
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
          <div>
            <code className="text-blue-700 dark:text-blue-300 font-mono">{'{author}'}</code>
            <span className="text-gray-600 dark:text-gray-400 ml-2">- Book author</span>
          </div>
          <div>
            <code className="text-blue-700 dark:text-blue-300 font-mono">{'{title}'}</code>
            <span className="text-gray-600 dark:text-gray-400 ml-2">- Book title</span>
          </div>
          <div>
            <code className="text-blue-700 dark:text-blue-300 font-mono">{'{narrator}'}</code>
            <span className="text-gray-600 dark:text-gray-400 ml-2">- Narrator name</span>
          </div>
          <div>
            <code className="text-blue-700 dark:text-blue-300 font-mono">{'{year}'}</code>
            <span className="text-gray-600 dark:text-gray-400 ml-2">- Release year</span>
          </div>
          <div>
            <code className="text-blue-700 dark:text-blue-300 font-mono">{'{asin}'}</code>
            <span className="text-gray-600 dark:text-gray-400 ml-2">- Audible ASIN</span>
          </div>
          <div>
            <code className="text-blue-700 dark:text-blue-300 font-mono">{'{series}'}</code>
            <span className="text-gray-600 dark:text-gray-400 ml-2">- Book series name</span>
          </div>
          <div>
            <code className="text-blue-700 dark:text-blue-300 font-mono">{'{seriesPart}'}</code>
            <span className="text-gray-600 dark:text-gray-400 ml-2">- Series part/position</span>
          </div>
        </div>
      </div>

      {/* Conditional Syntax Help */}
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-100 mb-2">
          Conditional Syntax
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
          Wrap text around a variable in <code className="text-amber-700 dark:text-amber-300 font-mono">{'{ }'}</code> to
          include that text only when the variable has a value. If the variable is empty, the entire block is removed.
        </p>
        <div className="text-sm font-mono bg-white dark:bg-gray-900 rounded px-3 py-2 border border-amber-100 dark:border-amber-900">
          <div className="text-gray-700 dark:text-gray-300">
            <code className="text-amber-700 dark:text-amber-300">{'{Book seriesPart - }'}</code>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            With value: <span className="text-green-700 dark:text-green-400">Book 1 - </span>
            &nbsp;&bull;&nbsp;
            Without value: <span className="text-red-700 dark:text-red-400">(removed)</span>
          </div>
        </div>
      </div>

      {/* Metadata Tagging Toggle */}
      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
        <div className="flex items-start gap-4">
          <input
            type="checkbox"
            id="metadata-tagging-settings"
            checked={paths.metadataTaggingEnabled}
            onChange={(e) => updatePath('metadataTaggingEnabled', e.target.checked)}
            className="mt-1 h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <div className="flex-1">
            <label
              htmlFor="metadata-tagging-settings"
              className="block text-sm font-medium text-gray-900 dark:text-gray-100 cursor-pointer"
            >
              Auto-tag audio files with metadata
            </label>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Automatically write correct title, author, and narrator metadata to m4b and mp3 files
              during file organization. This significantly improves Plex matching accuracy for audiobooks
              with missing or incorrect metadata.
            </p>
          </div>
        </div>
      </div>

      {/* Chapter Merging Toggle */}
      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
        <div className="flex items-start gap-4">
          <input
            type="checkbox"
            id="chapter-merging-settings"
            checked={paths.chapterMergingEnabled}
            onChange={(e) => updatePath('chapterMergingEnabled', e.target.checked)}
            className="mt-1 h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <div className="flex-1">
            <label
              htmlFor="chapter-merging-settings"
              className="block text-sm font-medium text-gray-900 dark:text-gray-100 cursor-pointer"
            >
              Auto-merge chapters to M4B
            </label>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Automatically merge multi-file chapter downloads into a single M4B audiobook with chapter
              markers. Improves playback experience and library organization.
            </p>
          </div>
        </div>
      </div>

      {/* Test Paths Button */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
        <Button
          onClick={testPaths}
          loading={testing}
          disabled={!paths.downloadDir || !paths.mediaDir}
          variant="outline"
          className="w-full"
        >
          Test Paths
        </Button>
        {testResult && (
          <div className={`mt-3 p-3 rounded-lg text-sm ${
            testResult.success
              ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200'
              : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
          }`}>
            {testResult.message}
          </div>
        )}
      </div>
    </div>
  );
}
