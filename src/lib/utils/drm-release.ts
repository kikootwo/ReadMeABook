/**
 * Component: Audible DRM Release Detection
 * Documentation: documentation/phase3/ranking-algorithm.md
 *
 * Automatic search drops a release whose title marks the release itself as an
 * Audible DRM container (.aa/.aax/.aaxc). Those files are locked to the buying
 * Audible account, so the requester can't play them.
 */

import { DRM_EXTENSIONS } from '../constants/audio-formats';

// 'aaxc|aax|aa': longest first, so '.aaxc' is reported whole
const DRM_NAMES = DRM_EXTENSIONS
  .map((ext) => ext.slice(1))
  .sort((a, b) => b.length - a.length)
  .join('|');

// A file extension: '.aax' ending a word, not followed by another dotted word
// ('Pooh.AA.Milne' is a scene-style name, not a file)
const DRM_EXTENSION_RE = new RegExp(`\\.(?:${DRM_NAMES})(?![a-z0-9.])`, 'i');

// A bracketed format tag holding only the format: [AAX], (AA), {AAXC}, [.aax]
const DRM_TAG_RE = new RegExp(`[[({]\\s*\\.?(?:${DRM_NAMES})\\s*[\\])}]`, 'i');

// A playable format named anywhere means a converted release ('Dune [M4B] (from AAX)')
const PLAYABLE_FORMAT_RE = /(?:^|[^a-z0-9])(?:m4b|mp3|m4a|flac|opus|ogg)(?![a-z0-9])/i;

/**
 * The marker that makes a release title an Audible DRM release ('.aax', '[AAX]'),
 * or null. A bare 'AAX' word isn't a marker: converted releases name their source
 * that way ('ripped from Audible AAX').
 */
export function drmReleaseMarker(title: string): string | null {
  if (PLAYABLE_FORMAT_RE.test(title)) return null;
  const match = DRM_TAG_RE.exec(title) ?? DRM_EXTENSION_RE.exec(title);
  return match ? match[0] : null;
}
