/**
 * Component: Paths Settings - Library Files (File placement + Metadata, Audiobookshelf mode)
 * Documentation: documentation/features/library-placement.md
 */

'use client';

import React from 'react';
import type { PathsSettings } from '../../lib/types';
import {
  FILE_PLACEMENTS,
  FILE_PLACEMENT_LABELS,
  METADATA_MODE_LABELS,
  isLinkPlacement,
  metadataModeOf,
  parseFilePlacement,
  type FilePlacement,
  type MetadataMode,
} from '@/lib/utils/library-placement';

interface LibraryFilesSectionProps {
  paths: PathsSettings;
  onUpdate: (patch: Partial<PathsSettings>) => void;
}

const METADATA_MODES: MetadataMode[] = ['tags', 'opf', 'none'];

const radioClass = 'mt-0.5 h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50';
const helpClass = 'text-sm text-gray-600 dark:text-gray-400 mt-2';

/** "Last book copied instead of linked: <title> (<reason>), <date>" */
function fallbackLine(note: NonNullable<PathsSettings['linkFallbackLast']>): string {
  const date = new Date(note.at);
  const when = Number.isNaN(date.getTime()) ? note.at : date.toLocaleDateString();
  return `Last book copied instead of linked: ${note.title} (${note.reason}), ${when}`;
}

/**
 * The two Audiobookshelf choices plus chapter merge, guarded both ways: the hard-link
 * values are disabled while Tags or merge is on, and Tags and merge are disabled while a
 * hard link is set. A stored combination the guards would not allow still shows as stored
 * (Tags wins over OPF), with the line saying what to change; the page won't save it.
 */
export function LibraryFilesSection({ paths, onUpdate }: LibraryFilesSectionProps) {
  const placement = parseFilePlacement(paths.filePlacement);
  const mode = metadataModeOf(paths.metadataTaggingEnabled, paths.metadataOpfEnabled === true);
  const linking = isLinkPlacement(placement);
  const linkBlocked = mode === 'tags' || paths.chapterMergingEnabled;

  const setMode = (next: MetadataMode) =>
    onUpdate({ metadataTaggingEnabled: next === 'tags', metadataOpfEnabled: next === 'opf' });

  return (
    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700 space-y-5" data-testid="library-files-section">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Library files</h3>

      <fieldset className="min-w-0">
        <legend className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">File placement</legend>
        <div className="space-y-2">
          {FILE_PLACEMENTS.map((value: FilePlacement) => (
            <label key={value} className="flex items-start gap-3 text-sm text-gray-800 dark:text-gray-200">
              <input
                type="radio"
                name="file-placement"
                value={value}
                checked={placement === value}
                disabled={isLinkPlacement(value) && linkBlocked && placement !== value}
                onChange={() => onUpdate({ filePlacement: value })}
                className={radioClass}
              />
              <span className="min-w-0">{FILE_PLACEMENT_LABELS[value]}</span>
            </label>
          ))}
        </div>
        <p className={helpClass}>
          A hard link shares one copy with the download, so seeding keeps working. The download and media folders must be on the same mount.
        </p>
        {linkBlocked && (
          <p className={`text-sm mt-2 ${linking ? 'text-red-700 dark:text-red-400' : 'text-gray-600 dark:text-gray-400'}`} role={linking ? 'alert' : undefined}>
            Needs Metadata: OPF file or None, and chapter merge off.
          </p>
        )}
        {linking && (
          <p className="text-sm mt-2 text-amber-800 dark:text-amber-300">
            Don&apos;t use Audiobookshelf&apos;s Embed Metadata on linked books: it changes the download too, and the download client may later undo it.
          </p>
        )}
        {linking && paths.linkFallbackLast && (
          <p className="text-sm mt-2 text-amber-800 dark:text-amber-300 break-words" data-testid="link-fallback-last">
            {fallbackLine(paths.linkFallbackLast)}
          </p>
        )}
      </fieldset>

      <fieldset className="min-w-0">
        <legend className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">Metadata</legend>
        <div className="space-y-2">
          {METADATA_MODES.map((value) => (
            <label key={value} className="flex items-start gap-3 text-sm text-gray-800 dark:text-gray-200">
              <input
                type="radio"
                name="metadata-mode"
                value={value}
                checked={mode === value}
                disabled={value === 'tags' && linking && mode !== 'tags'}
                onChange={() => setMode(value)}
                className={radioClass}
              />
              <span className="min-w-0">{METADATA_MODE_LABELS[value]}</span>
            </label>
          ))}
        </div>
        <p className={helpClass}>An OPF file leaves the audio files unchanged.</p>
      </fieldset>

      <div className="flex items-start gap-4">
        <input
          type="checkbox"
          id="chapter-merging-settings"
          checked={paths.chapterMergingEnabled}
          disabled={linking && !paths.chapterMergingEnabled}
          onChange={(e) => onUpdate({ chapterMergingEnabled: e.target.checked })}
          className="mt-1 h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
        />
        <div className="flex-1 min-w-0">
          <label htmlFor="chapter-merging-settings" className="block text-sm font-medium text-gray-900 dark:text-gray-100 cursor-pointer">
            Auto-merge chapters to M4B
          </label>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Automatically merge multi-file chapter downloads into a single M4B audiobook with chapter
            markers. Improves playback experience and library organization.
          </p>
        </div>
      </div>
    </div>
  );
}
