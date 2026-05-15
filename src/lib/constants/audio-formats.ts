/**
 * Component: Audio Format Constants
 * Documentation: documentation/phase3/file-organization.md
 *
 * Centralized audio format definitions used across the application.
 * Add new formats here to enable support in all subsystems.
 */

/**
 * All supported audio file extensions for audiobook detection and file organization.
 * Used by: file-organizer.ts, files-hash.ts
 */
export const AUDIO_EXTENSIONS = [
  '.m4b',
  '.m4a',
  '.mp3',
  '.mp4',
  '.aa',
  '.aax',
  '.flac',
  '.ogg',
] as const;

/**
 * Audio formats supported by the chapter merger (FFmpeg concat + M4B output).
 * Formats here can be detected, probed, ordered, and merged into a single M4B.
 * Note: .aa/.aax excluded (DRM-protected, cannot be decoded by FFmpeg without keys).
 * Note: .ogg excluded (FFmpeg concat demuxer does not support Ogg container).
 */
export const CHAPTER_MERGE_FORMATS = [
  '.mp3',
  '.m4a',
  '.m4b',
  '.mp4',
  '.aac',
  '.flac',
] as const;

/**
 * Audio formats supported by metadata tagging via FFmpeg.
 * Each format maps to a specific FFmpeg output format flag and tagging strategy.
 */
export const METADATA_TAG_FORMATS = [
  '.m4b',
  '.m4a',
  '.mp3',
  '.mp4',
  '.flac',
] as const;

/**
 * Formats that use MP4/M4A container tags (iTunes-style metadata).
 * These use `-f mp4` output format in FFmpeg.
 */
export const MP4_CONTAINER_FORMATS = ['.m4b', '.m4a', '.mp4'] as const;

/**
 * Audio format identifiers detectable in torrent/NZB titles.
 * Used by Prowlarr service for metadata extraction and ranking algorithm for scoring.
 */
export const TORRENT_TITLE_FORMATS = ['M4B', 'M4A', 'MP3', 'FLAC'] as const;

export type TorrentTitleFormat = (typeof TORRENT_TITLE_FORMATS)[number];

/**
 * Type helper for the format field on TorrentResult.
 * 'OTHER' is used when no recognized format is detected in the title.
 */
export type AudioFormat = TorrentTitleFormat | 'OTHER';

/**
 * Plex audiobook-library recognized extensions.
 * Used by Plex format coercion to determine which formats are silently passed through.
 * Research-grounded — see issue #166 for context on Plex's silent-failure behavior.
 * Note: includes formats not yet in `AUDIO_EXTENSIONS` (.aac/.wav/.alac) for future-proofing.
 */
export const PLEX_COMPATIBLE_EXTENSIONS = [
  '.m4b',
  '.m4a',
  '.mp3',
  '.flac',
  '.aac',
  '.wav',
  '.alac',
] as const;

/**
 * Unambiguous rename targets for Plex format coercion.
 * `.mp4` → `.m4b` always. `.m4a` → `.m4b` is conditional (single-file only) and handled in coercion logic.
 */
export const COERCION_RENAME_MAP: Record<string, string> = {
  '.mp4': '.m4b',
};

/**
 * DRM-protected formats that cannot be decoded without keys.
 * Plex format coercion logs a warning and skips these.
 */
export const DRM_EXTENSIONS = ['.aa', '.aax'] as const;

/**
 * Formats that would require a full transcode to become Plex-compatible.
 * Out of scope for v1 Plex format coercion — logs a warning and skips.
 */
export const TRANSCODE_REQUIRED_EXTENSIONS = ['.ogg', '.opus', '.wma'] as const;

/**
 * All supported ebook file extensions for ebook detection and file serving.
 */
export const EBOOK_EXTENSIONS = [
  '.epub',
  '.pdf',
  '.mobi',
  '.azw3',
  '.fb2',
  '.cbz',
  '.cbr',
] as const;
